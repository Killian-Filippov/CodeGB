export interface TreeSitterPoint {
  row: number;
  column: number;
}

export interface TreeSitterSyntaxNode {
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  parent: TreeSitterSyntaxNode | null;
  namedChildren: TreeSitterSyntaxNode[];
  childForFieldName: (name: string) => TreeSitterSyntaxNode | null;
}

export interface TreeSitterTree {
  rootNode: TreeSitterSyntaxNode;
}

export interface TreeSitterParser {
  setLanguage: (language: unknown) => void;
  parse: (text: string) => TreeSitterTree;
}

export interface TreeSitterQueryCapture {
  name: string;
  node: TreeSitterSyntaxNode;
}

export interface TreeSitterQuery {
  captures: (node: TreeSitterSyntaxNode, options?: Record<string, unknown>) => TreeSitterQueryCapture[];
}

export interface TreeSitterParserRuntime {
  engine: 'tree-sitter';
  available: true;
  createParser: () => TreeSitterParser;
  createQuery: (source: string | Buffer) => TreeSitterQuery;
  language: unknown;
}

export interface RegexParserRuntime {
  engine: 'regex';
  available: true;
}

export type ParserRuntime = TreeSitterParserRuntime | RegexParserRuntime;

let cached: ParserRuntime | null = null;

export const __resetJavaParserRuntimeForTests = (): void => {
  cached = null;
};

export const __setJavaParserRuntimeForTests = (runtime: ParserRuntime | null): void => {
  cached = runtime;
};

export const loadJavaParserRuntime = async (): Promise<ParserRuntime> => {
  if (cached) {
    return cached;
  }

  try {
    const [parserModule, javaModule] = await Promise.all([import('tree-sitter'), import('tree-sitter-java')]);
    const ParserCtor = ((parserModule.default ?? parserModule) as unknown) as {
      new (): TreeSitterParser;
      Query: new (language: unknown, source: string | Buffer) => TreeSitterQuery;
    };
    const javaLanguage = (javaModule.default ?? javaModule) as unknown;
    const queryCache = new Map<string, TreeSitterQuery>();

    cached = {
      engine: 'tree-sitter',
      available: true,
      language: javaLanguage,
      createParser: () => {
        const parser = new ParserCtor();
        parser.setLanguage(javaLanguage);
        return parser;
      },
      createQuery: (source: string | Buffer) => {
        const key = Buffer.isBuffer(source) ? source.toString('utf8') : source;
        const existing = queryCache.get(key);
        if (existing) {
          return existing;
        }
        const query = new ParserCtor.Query(javaLanguage, source);
        queryCache.set(key, query);
        return query;
      },
    };
  } catch {
    cached = { engine: 'regex', available: true };
  }

  return cached;
};
