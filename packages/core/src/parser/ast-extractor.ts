import type {
  ParsedJavaFile,
  ParsedJavaMethod,
  ParsedJavaType,
  ParsedJavaField,
} from '../types/graph';

const TYPE_REGEX = /((?:public|protected|private|abstract|final|static|sealed|non-sealed|\s)*)\b(class|interface|enum|@interface)\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z0-9_$.<>]+))?(?:\s+implements\s+([^\{]+))?\s*\{/g;

const METHOD_REGEX =
  /(?:^|\n)\s*(?:@\w+(?:\([^)]*\))?\s*)*((?:(?:public|protected|private|static|final|abstract|synchronized|native|strictfp)\s+)*)((?:[A-Za-z_][\w<>\[\].?]*\s+)?)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;

const FIELD_REGEX =
  /^\s*((?:(?:public|protected|private|static|final|volatile|transient)\s+)*)((?:[A-Za-z_][\w<>\[\].?]*))\s+([A-Za-z_]\w*)\s*(?:=[^;]+)?;\s*$/;

const CALL_REGEX = /\b([A-Za-z_]\w*)\s*\(/g;
const JAVA_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'new',
  'super',
  'this',
  'throw',
  'try',
  'synchronized',
]);

const toLine = (source: string, index: number): number => {
  let lines = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      lines += 1;
    }
  }
  return lines;
};

const splitModifiers = (value: string): string[] => {
  return value
    .trim()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const findMatchingBrace = (source: string, openIndex: number): number => {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return source.length - 1;
};

const extractCalls = (body: string): string[] => {
  const calls = new Set<string>();
  let match = CALL_REGEX.exec(body);

  while (match) {
    const name = match[1];
    if (name && !JAVA_KEYWORDS.has(name)) {
      calls.add(name);
    }
    match = CALL_REGEX.exec(body);
  }

  CALL_REGEX.lastIndex = 0;
  return Array.from(calls);
};

const extractFields = (classBody: string, classStartLine: number): ParsedJavaField[] => {
  const fields: ParsedJavaField[] = [];
  const lines = classBody.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line || line.includes('(') || line.startsWith('@')) {
      continue;
    }
    const fieldMatch = line.match(FIELD_REGEX);
    if (!fieldMatch) {
      continue;
    }

    const modifiers = splitModifiers(fieldMatch[1] ?? '');
    const fieldType = fieldMatch[2] ?? 'Object';
    const fieldName = fieldMatch[3] ?? 'unknown';
    const lineNo = classStartLine + index;

    fields.push({
      name: fieldName,
      type: fieldType,
      modifiers,
      startLine: lineNo,
      endLine: lineNo,
    });
  }

  return fields;
};

const extractMethods = (className: string, classBody: string, absoluteStart: number, fullSource: string): ParsedJavaMethod[] => {
  const methods: ParsedJavaMethod[] = [];
  let match = METHOD_REGEX.exec(classBody);

  while (match) {
    const all = match[0] ?? '';
    const modifiers = splitModifiers(match[1] ?? '');
    const returnTypeRaw = (match[2] ?? '').trim();
    const name = match[3] ?? '';
    const parameters = (match[4] ?? '')
      .split(',')
      .map((param) => param.trim())
      .filter(Boolean);

    if (!name || JAVA_KEYWORDS.has(name)) {
      match = METHOD_REGEX.exec(classBody);
      continue;
    }

    const methodStartInClass = (match.index ?? 0) + all.lastIndexOf('{');
    const openIndex = absoluteStart + methodStartInClass;
    const closeIndex = findMatchingBrace(fullSource, openIndex);
    const methodBody = fullSource.slice(openIndex + 1, closeIndex);
    const startLine = toLine(fullSource, openIndex);
    const endLine = toLine(fullSource, closeIndex);

    methods.push({
      name,
      returnType: returnTypeRaw || undefined,
      parameters,
      modifiers,
      isConstructor: name === className,
      calls: extractCalls(methodBody),
      startLine,
      endLine,
    });

    METHOD_REGEX.lastIndex = (match.index ?? 0) + all.length;
    match = METHOD_REGEX.exec(classBody);
  }

  METHOD_REGEX.lastIndex = 0;
  return methods;
};

export const parseJavaSource = (source: string, filePath: string): ParsedJavaFile => {
  const packageMatch = source.match(/^[\t ]*package\s+([A-Za-z0-9_.]+)\s*;/m);
  const packageName = packageMatch?.[1] ?? '';

  const imports: string[] = [];
  const importRegex = /^[\t ]*import\s+([A-Za-z0-9_.*]+)\s*;/gm;
  let importMatch = importRegex.exec(source);
  while (importMatch) {
    const value = importMatch[1];
    if (value) {
      imports.push(value);
    }
    importMatch = importRegex.exec(source);
  }

  const types: ParsedJavaType[] = [];
  let typeMatch = TYPE_REGEX.exec(source);

  while (typeMatch) {
    const kindToken = typeMatch[2] ?? 'class';
    const kind: ParsedJavaType['kind'] =
      kindToken === 'interface'
        ? 'Interface'
        : kindToken === 'enum'
          ? 'Enum'
          : kindToken === '@interface'
            ? 'Annotation'
            : 'Class';

    const name = typeMatch[3] ?? 'Anonymous';
    const modifiers = splitModifiers(typeMatch[1] ?? '');
    const superClass = typeMatch[4]?.trim();
    const interfaces = (typeMatch[5] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const typePrefix = typeMatch[0] ?? '';
    const openIndex = (typeMatch.index ?? 0) + typePrefix.lastIndexOf('{');
    const closeIndex = findMatchingBrace(source, openIndex);
    const startLine = toLine(source, openIndex);
    const endLine = toLine(source, closeIndex);
    const classBody = source.slice(openIndex + 1, closeIndex);
    const classQualifiedName = packageName ? `${packageName}.${name}` : name;

    types.push({
      kind,
      name,
      qualifiedName: classQualifiedName,
      modifiers,
      superClass,
      interfaces,
      fields: extractFields(classBody, startLine + 1),
      methods: extractMethods(name, classBody, openIndex + 1, source),
      startLine,
      endLine,
    });

    TYPE_REGEX.lastIndex = closeIndex + 1;
    typeMatch = TYPE_REGEX.exec(source);
  }

  TYPE_REGEX.lastIndex = 0;

  return {
    filePath,
    packageName,
    imports,
    types,
  };
};
