let cached = null;
export const loadJavaParserRuntime = async () => {
    if (cached) {
        return cached;
    }
    // Phase 1 fallback: if tree-sitter packages are not installed, keep parser functional.
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