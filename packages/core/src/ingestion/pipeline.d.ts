import type { KnowledgeGraph } from '../types/graph';
export interface PipelineOptions {
    repoPath: string;
    storagePath: string;
    projectName?: string;
}
export interface PipelineResult {
    graph: KnowledgeGraph;
    repoPath: string;
    filesIndexed: number;
    persisted: boolean;
}
export declare const runPipelineFromRepo: (options: PipelineOptions) => Promise<PipelineResult>;
//# sourceMappingURL=pipeline.d.ts.map