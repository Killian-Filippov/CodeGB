import type {
  ParsedJavaCallSite,
  ParsedJavaField,
  ParsedJavaFile,
  ParsedJavaMethod,
  ParsedJavaType,
} from '../types/graph';

type TSPoint = { row: number; column: number };

interface TSNode {
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: TSPoint;
  endPosition: TSPoint;
  namedChildren: TSNode[];
  childForFieldName: (name: string) => TSNode | null;
}

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

const collectCallSites = (source: string, bodyNode: TSNode): ParsedJavaCallSite[] => {
  const sites: ParsedJavaCallSite[] = [];
  const stack = [bodyNode];

  while (stack.length > 0) {
    const node = stack.pop() as TSNode;
    for (const child of node.namedChildren) {
      stack.push(child);
    }

    if (node.type === 'method_invocation') {
      const nameNode = node.childForFieldName('name');
      const objectNode = node.childForFieldName('object');
      const argsNode = node.childForFieldName('arguments');
      const simpleName = textOf(source, nameNode).trim();
      if (!simpleName) {
        continue;
      }
      const qualifier = textOf(source, objectNode).trim() || undefined;
      const isQualified = Boolean(qualifier);
      const rawCallee = qualifier ? `${qualifier}.${simpleName}` : simpleName;
      sites.push({
        rawCallee,
        simpleName,
        qualifier,
        argCount: argCountOf(argsNode),
        line: (nameNode ?? node).startPosition.row + 1,
        isQualified,
      });
      continue;
    }

    if (node.type === 'object_creation_expression') {
      // TODO(parser-tree-sitter): support constructor call-edge binding from `new` expressions instead of skipping downstream.
      const typeNode = node.childForFieldName('type');
      const argsNode = node.childForFieldName('arguments');
      const typeName = textOf(source, typeNode).trim() || 'new';
      sites.push({
        rawCallee: `new ${typeName}`,
        simpleName: 'new',
        qualifier: typeName,
        argCount: argCountOf(argsNode),
        line: node.startPosition.row + 1,
        isQualified: true,
        unsupportedReason: 'constructor-call',
      });
      continue;
    }

    if (node.type === 'explicit_constructor_invocation') {
      // TODO(parser-tree-sitter): support `super(...)` / `this(...)` constructor edge binding with inheritance-aware resolution.
      const argsNode = node.childForFieldName('arguments');
      const raw = textOf(source, node).trim();
      const simpleName = raw.startsWith('this') ? 'this' : 'super';
      sites.push({
        rawCallee: simpleName,
        simpleName,
        argCount: argCountOf(argsNode),
        line: node.startPosition.row + 1,
        isQualified: false,
        unsupportedReason: 'super-this-constructor-call',
      });
    }
  }

  return sites;
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

const parseMethodDecl = (source: string, className: string, node: TSNode): ParsedJavaMethod | undefined => {
  if (node.type !== 'method_declaration' && node.type !== 'constructor_declaration') {
    return undefined;
  }

  const nameNode = node.childForFieldName('name');
  const paramsNode = node.childForFieldName('parameters');
  const bodyNode = node.childForFieldName('body');
  const typeNode = node.childForFieldName('type');
  const name = textOf(source, nameNode).trim();
  if (!name) {
    return undefined;
  }

  return {
    name,
    returnType: textOf(source, typeNode).trim() || undefined,
    parameters: parseParameterList(source, paramsNode),
    modifiers: splitModifiers(textOf(source, node.childForFieldName('modifiers'))),
    isConstructor: node.type === 'constructor_declaration' || name === className,
    calls: bodyNode ? collectCallSites(source, bodyNode) : [],
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
};

const collectNamedTypeNodes = (root: TSNode): TSNode[] => {
  const types = new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'annotation_type_declaration']);
  const queue = [...root.namedChildren];
  const result: TSNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift() as TSNode;
    if (types.has(node.type)) {
      result.push(node);
      continue;
    }
    for (const child of node.namedChildren) {
      queue.push(child);
    }
  }

  return result;
};

const parseTypeDecl = (source: string, packageName: string, node: TSNode): ParsedJavaType | undefined => {
  const nameNode = node.childForFieldName('name');
  const bodyNode = node.childForFieldName('body');
  const name = textOf(source, nameNode).trim();
  if (!name || !bodyNode) {
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
  const interfacesNode = node.childForFieldName('interfaces');
  const superClass = textOf(source, superClassNode).replace(/^extends\s+/, '').trim() || undefined;
  const interfacesText = textOf(source, interfacesNode)
    .replace(/^(implements|extends)\s+/, '')
    .trim();
  const interfaces = interfacesText
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const methods: ParsedJavaMethod[] = [];
  const fields: ParsedJavaField[] = [];
  for (const child of bodyNode.namedChildren) {
    if (child.type === 'field_declaration') {
      fields.push(...parseFieldDecl(source, child));
      continue;
    }
    const method = parseMethodDecl(source, name, child);
    if (method) {
      methods.push(method);
    }
  }

  return {
    kind,
    name,
    qualifiedName: packageName ? `${packageName}.${name}` : name,
    modifiers: splitModifiers(textOf(source, node.childForFieldName('modifiers'))),
    superClass,
    interfaces,
    fields,
    methods,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
};

export const parseJavaSourceWithTreeSitter = async (source: string, filePath: string): Promise<ParsedJavaFile> => {
  const [parserModule, javaModule] = await Promise.all([import('tree-sitter'), import('tree-sitter-java')]);
  const ParserCtor = (parserModule.default ?? parserModule) as {
    new (): { setLanguage: (language: unknown) => void; parse: (text: string) => { rootNode: TSNode } };
  };
  const javaLanguage = (javaModule.default ?? javaModule) as unknown;
  const parser = new ParserCtor();
  parser.setLanguage(javaLanguage);

  const tree = parser.parse(source);
  const root = tree.rootNode;
  const packageDecl = root.namedChildren.find((node) => node.type === 'package_declaration');
  const packageText = textOf(source, packageDecl).trim();
  const packageName = packageText.replace(/^package\s+/, '').replace(/;$/, '').trim();

  const imports = root.namedChildren
    .filter((node) => node.type === 'import_declaration')
    .map((node) => parseImportDecl(source, node))
    .filter((entry): entry is string => Boolean(entry));

  const types = collectNamedTypeNodes(root)
    .map((node) => parseTypeDecl(source, packageName, node))
    .filter((entry): entry is ParsedJavaType => Boolean(entry));

  return {
    filePath,
    packageName,
    imports,
    types,
  };
};
