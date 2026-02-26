export interface ParserRuntime {
    engine: 'tree-sitter' | 'regex';
    available: boolean;
}
export declare const loadJavaParserRuntime: () => Promise<ParserRuntime>;
//# sourceMappingURL=parser-loader.d.ts.map