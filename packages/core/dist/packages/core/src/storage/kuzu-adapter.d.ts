import type { JavaGraphNode, JavaGraphRelationship, KnowledgeGraph } from '../types/graph.ts';
export interface RepoRecord {
    name: string;
    path: string;
}
export interface PersistedGraph {
    nodes: JavaGraphNode[];
    relationships: JavaGraphRelationship[];
}
export declare class KuzuAdapter {
    private readonly storagePath;
    constructor(storagePath: string);
    init(): Promise<void>;
    persistGraph(graph: KnowledgeGraph): Promise<void>;
    loadGraph(): Promise<KnowledgeGraph>;
    saveRepository(repo: RepoRecord): Promise<void>;
    listRepositories(): Promise<RepoRecord[]>;
    executeCypher(query: string, graph?: KnowledgeGraph): Promise<Array<Record<string, unknown>>>;
}
export declare const executeCypherInMemory: (graph: KnowledgeGraph, query: string) => Array<Record<string, unknown>>;
//# sourceMappingURL=kuzu-adapter.d.ts.map