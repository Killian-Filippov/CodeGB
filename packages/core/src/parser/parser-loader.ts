export interface ParserRuntime {
  engine: 'tree-sitter' | 'regex';
  available: boolean;
}

let cached: ParserRuntime | null = null;

export const loadJavaParserRuntime = async (): Promise<ParserRuntime> => {
  if (cached) {
    return cached;
  }

  // Phase 1 fallback: if tree-sitter packages are not installed, keep parser functional.
  try {
    await import('tree-sitter');
    await import('tree-sitter-java');
    cached = { engine: 'tree-sitter', available: true };
  } catch {
    cached = { engine: 'regex', available: true };
  }

  return cached;
};
