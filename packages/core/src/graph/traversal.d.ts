import type { KnowledgeGraph } from '../types/graph';
export interface ImpactArgs {
    target: string;
    direction: 'upstream' | 'downstream';
    maxDepth: number;
}
export interface ImpactItem {
    id: string;
    name: string;
    label: string;
    depth: number;
    via: string;
}
export declare const traverseImpact: (graph: KnowledgeGraph, args: ImpactArgs) => ImpactItem[];
//# sourceMappingURL=traversal.d.ts.map