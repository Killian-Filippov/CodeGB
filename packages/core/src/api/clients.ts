export interface EmbeddingClient {
  health: () => Promise<{ ok: boolean }>;
}

export const createEmbeddingClient = (): EmbeddingClient => ({
  async health() {
    return { ok: false };
  },
});
