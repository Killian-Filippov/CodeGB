import type {
  ParsedJavaCallSite,
  ParsedJavaField,
  ParsedJavaFile,
  ParsedJavaMethod,
  ParsedJavaType,
} from '../types/graph';
import { JAVA_QUERIES } from './java-queries';
import {
  loadJavaParserRuntime,
  type TreeSitterQueryCapture,
  type TreeSitterSyntaxNode,
} from './parser-loader';

type TSNode = TreeSitterSyntaxNode;

const TYPE_CAPTURE_NAMES = new Set([
  'definition.class',
  'definition.interface',
  'definition.enum',
  'definition.annotation',
]);
const METHOD_CAPTURE_NAMES = new Set(['definition.method', 'definition.constructor']);
const CALL_CAPTURE_NAMES = new Set(['call', 'call.constructor', 'call.constructor.explicit']);

const textOf = (source: string, node: TSNode | null | undefined): string => {
  if (!node) {
    return '';
  }
  return source.slice(node.startIndex, node.endIndex);
};

const splitModifiers = (value: string): string[] => {
  return value
    .trim()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const nodeKey = (node: TSNode): string => {
  return `${node.type}:${node.startIndex}:${node.endIndex}`;
};

const dedupeNodes = (nodes: TSNode[]): TSNode[] => {
  const seen = new Set<string>();
  const unique: TSNode[] = [];

  for (const node of nodes) {
    const key = nodeKey(node);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(node);
  }

  return unique.sort((left, right) => left.startIndex - right.startIndex);
};

const isWithin = (parent: TSNode, child: TSNode): boolean => {
  return child.startIndex >= parent.startIndex && child.endIndex <= parent.endIndex;
};

const parseImportDecl = (source: string, node: TSNode): string | undefined => {
  const text = textOf(source, node).trim();
  const match = text.match(/^import\s+(static\s+)?([^;]+);$/);
  if (!match) {
    return undefined;
  }
  const staticPrefix = match[1] ? 'static ' : '';
  const target = (match[2] ?? '').trim();
  if (!target) {
    return undefined;
  }
  return `${staticPrefix}${target}`;
};

const parseParameterList = (source: string, paramsNode: TSNode | null): string[] => {
  const raw = textOf(source, paramsNode).trim();
  if (!raw.startsWith('(') || !raw.endsWith(')')) {
    return [];
  }
  const inner = raw.slice(1, -1).trim();
  if (!inner) {
    return [];
  }
  return inner
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const argCountOf = (argsNode: TSNode | null): number => {
  if (!argsNode) {
    return 0;
  }
  return argsNode.namedChildren.length;
};

const cleanTypeName = (raw: string): string => {
  return raw
    .trim()
    .replace(/<[^<>]*>/g, '')
    .replace(/\[\]$/g, '')
    .replace(/[?].*$/g, '')
    .trim();
};

const toSimpleTypeName = (raw: string): string => {
  const cleaned = cleanTypeName(raw);
  const parts = cleaned.split('.');
  return (parts[parts.length - 1] ?? cleaned).trim();
};

const toQualifiedTypeNameOrUndefined = (raw: string): string | undefined => {
  const cleaned = cleanTypeName(raw);
  if (!cleaned || !cleaned.includes('.')) {
    return undefined;
  }
  return cleaned;
};

const findClosestTypeNode = (node: TSNode | null): TSNode | null => {
  let cursor = node?.parent ?? null;
  while (cursor) {
    if (
      cursor.type === 'class_declaration' ||
      cursor.type === 'interface_declaration' ||
      cursor.type === 'enum_declaration' ||
      cursor.type === 'annotation_type_declaration'
    ) {
      return cursor;
    }
    cursor = cursor.parent;
  }
  return null;
};

const groupTypeScopedNodes = (
  captures: TreeSitterQueryCapture[],
  captureNames: Set<string>,
): Map<string, TSNode[]> => {
  const scoped = new Map<string, TSNode[]>();

  for (const capture of captures) {
    if (!captureNames.has(capture.name)) {
      continue;
    }
    const owner = findClosestTypeNode(capture.node);
    if (!owner) {
      continue;
    }
    const key = nodeKey(owner);
    const bucket = scoped.get(key) ?? [];
    bucket.push(capture.node);
    scoped.set(key, bucket);
  }

  for (const [key, nodes] of scoped) {
    scoped.set(key, dedupeNodes(nodes));
  }

  return scoped;
};

const parseFieldDecl = (source: string, node: TSNode): ParsedJavaField[] => {
  const fields: ParsedJavaField[] = [];
  const modifiers = splitModifiers(textOf(source, node.childForFieldName('modifiers')));
  const typeNode = node.childForFieldName('type');
  const typeName = textOf(source, typeNode).trim() || 'Object';

  for (const child of node.namedChildren) {
    if (child.type !== 'variable_declarator') {
      continue;
    }
    const nameNode = child.childForFieldName('name');
    const name = textOf(source, nameNode).trim();
    if (!name) {
      continue;
    }
    fields.push({
      name,
      type: typeName,
      modifiers,
      startLine: child.startPosition.row + 1,
      endLine: child.endPosition.row + 1,
    });
  }

  return fields;
};

const parseCallSite = (
  source: string,
  node: TSNode,
  currentTypeName: string,
  currentTypeQualifiedName: string,
  superClassRaw?: string,
): ParsedJavaCallSite | undefined => {
  if (node.type === 'method_invocation') {
    const nameNode = node.childForFieldName('name');
    const objectNode = node.childForFieldName('object');
    const argsNode = node.childForFieldName('arguments');
    const simpleName = textOf(source, nameNode).trim();
    if (!simpleName) {
      return undefined;
    }
    const qualifier = textOf(source, objectNode).trim() || undefined;
    const isQualified = Boolean(qualifier);
    return {
      rawCallee: qualifier ? `${qualifier}.${simpleName}` : simpleName,
      simpleName,
      qualifier,
      argCount: argCountOf(argsNode),
      line: (nameNode ?? node).startPosition.row + 1,
      isQualified,
    };
  }

  if (node.type === 'object_creation_expression') {
    const typeNode = node.childForFieldName('type');
    const argsNode = node.childForFieldName('arguments');
    const typeName = textOf(source, typeNode).trim();
    const simpleName = toSimpleTypeName(typeName);
    const qualifiedTypeName = toQualifiedTypeNameOrUndefined(typeName);
    if (!simpleName) {
      return undefined;
    }
    return {
      rawCallee: typeName ? `${typeName}.${simpleName}` : simpleName,
      simpleName,
      qualifier: qualifiedTypeName ?? (typeName || undefined),
      argCount: argCountOf(argsNode),
      line: node.startPosition.row + 1,
      isQualified: Boolean(qualifiedTypeName ?? typeName),
    };
  }

  if (node.type === 'explicit_constructor_invocation') {
    const argsNode = node.childForFieldName('arguments');
    const raw = textOf(source, node).trim();
    const isThis = raw.startsWith('this');
    const superSimpleName = superClassRaw ? toSimpleTypeName(superClassRaw) : '';
    const superQualifiedName = superClassRaw ? toQualifiedTypeNameOrUndefined(superClassRaw) : undefined;
    const simpleName = isThis ? currentTypeName : superSimpleName || 'super';
    const qualifier = isThis ? currentTypeQualifiedName : superQualifiedName;
    return {
      rawCallee: qualifier ? `${qualifier}.${simpleName}` : simpleName,
      simpleName,
      qualifier,
      argCount: argCountOf(argsNode),
      line: node.startPosition.row + 1,
      isQualified: Boolean(qualifier),
    };
  }

  return undefined;
};

const parseMethodDecl = (
  source: string,
  className: string,
  classQualifiedName: string,
  superClassRaw: string | undefined,
  node: TSNode,
  callNodes: TSNode[],
): ParsedJavaMethod | undefined => {
  if (node.type !== 'method_declaration' && node.type !== 'constructor_declaration') {
    return undefined;
  }

  const nameNode = node.childForFieldName('name');
  const paramsNode = node.childForFieldName('parameters');
  const typeNode = node.childForFieldName('type');
  const bodyNode = node.childForFieldName('body');
  const name = textOf(source, nameNode).trim();
  if (!name) {
    return undefined;
  }

  const calls = bodyNode
    ? dedupeNodes(callNodes.filter((callNode) => isWithin(bodyNode, callNode)))
        .map((callNode) =>
          parseCallSite(source, callNode, className, classQualifiedName, superClassRaw),
        )
        .filter((entry): entry is ParsedJavaCallSite => Boolean(entry))
    : [];

  return {
    name,
    returnType: textOf(source, typeNode).trim() || undefined,
    parameters: parseParameterList(source, paramsNode),
    modifiers: splitModifiers(textOf(source, node.childForFieldName('modifiers'))),
    isConstructor: node.type === 'constructor_declaration' || name === className,
    calls,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
};

const parseTypeDecl = (
  source: string,
  packageName: string,
  node: TSNode,
  fieldNodes: TSNode[],
  methodNodes: TSNode[],
  callNodes: TSNode[],
): ParsedJavaType | undefined => {
  const nameNode = node.childForFieldName('name');
  const name = textOf(source, nameNode).trim();
  if (!name) {
    return undefined;
  }

  const kind: ParsedJavaType['kind'] =
    node.type === 'interface_declaration'
      ? 'Interface'
      : node.type === 'enum_declaration'
        ? 'Enum'
        : node.type === 'annotation_type_declaration'
          ? 'Annotation'
          : 'Class';

  const superClassNode = node.childForFieldName('superclass');
  const interfacesNode =
    node.childForFieldName('interfaces') ??
    node.childForFieldName('extends_interfaces') ??
    node.childForFieldName('extends');
  const superClass = textOf(source, superClassNode).replace(/^extends\s+/, '').trim() || undefined;
  const interfacesText = textOf(source, interfacesNode)
    .replace(/^(implements|extends)\s+/, '')
    .trim();
  const interfaces = interfacesText
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const classQualifiedName = packageName ? `${packageName}.${name}` : name;
  const fields = dedupeNodes(fieldNodes)
    .map((fieldNode) => parseFieldDecl(source, fieldNode))
    .flat();
  const methods = dedupeNodes(methodNodes)
    .map((methodNode) =>
      parseMethodDecl(source, name, classQualifiedName, superClass, methodNode, callNodes),
    )
    .filter((entry): entry is ParsedJavaMethod => Boolean(entry));

  return {
    kind,
    name,
    qualifiedName: classQualifiedName,
    modifiers: splitModifiers(textOf(source, node.childForFieldName('modifiers'))),
    superClass,
    interfaces,
    fields,
    methods,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
};

export const parseJavaSourceWithTreeSitter = async (
  source: string,
  filePath: string,
): Promise<ParsedJavaFile> => {
  const runtime = await loadJavaParserRuntime();
  if (runtime.engine !== 'tree-sitter') {
    throw new Error('tree-sitter runtime unavailable');
  }

  const parser = runtime.createParser();
  const query = runtime.createQuery(JAVA_QUERIES);
  const tree = parser.parse(source);
  const root = tree.rootNode;
  const captures = query.captures(root);
  const typeNodes = dedupeNodes(
    captures
      .filter((capture) => TYPE_CAPTURE_NAMES.has(capture.name))
      .map((capture) => capture.node),
  );
  const scopedFieldNodes = groupTypeScopedNodes(captures, new Set(['definition.field']));
  const scopedMethodNodes = groupTypeScopedNodes(captures, METHOD_CAPTURE_NAMES);
  const scopedCallNodes = groupTypeScopedNodes(captures, CALL_CAPTURE_NAMES);

  const packageDecl = root.namedChildren.find((node) => node.type === 'package_declaration');
  const packageText = textOf(source, packageDecl).trim();
  const packageName = packageText.replace(/^package\s+/, '').replace(/;$/, '').trim();
  const imports = dedupeNodes(
    captures.filter((capture) => capture.name === 'import').map((capture) => capture.node),
  )
    .map((node) => parseImportDecl(source, node))
    .filter((entry): entry is string => Boolean(entry));
  const types = typeNodes
    .map((node) =>
      parseTypeDecl(
        source,
        packageName,
        node,
        scopedFieldNodes.get(nodeKey(node)) ?? [],
        scopedMethodNodes.get(nodeKey(node)) ?? [],
        scopedCallNodes.get(nodeKey(node)) ?? [],
      ),
    )
    .filter((entry): entry is ParsedJavaType => Boolean(entry));

  return {
    filePath,
    packageName,
    imports,
    types,
  };
};
