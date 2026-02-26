export interface EmbeddingClient {
    health: () => Promise<{
        ok: boolean;
    }>;
}
export declare const createEmbeddingClient: () => EmbeddingClient;
//# sourceMappingURL=clients.d.ts.map