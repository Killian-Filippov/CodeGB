let cached = null;
export const loadJavaParserRuntime = async () => {
    if (cached) {
        return cached;
    }
    try {
        await import('tree-sitter');
        await import('tree-sitter-java');
        cached = { engine: 'tree-sitter', available: true };
    }
    catch {
        cached = { engine: 'regex', available: true };
    }
    return cached;
};
//# sourceMappingURL=parser-loader.js.map