import type { KnowledgeGraph } from '../types/graph';
interface ContextEdge {
    type: string;
    from: string;
    to: string;
}
export declare const buildSymbolContext: (graph: KnowledgeGraph, symbol: string) => {
    symbol: null;
    candidates: {
        id: string;
        label: import("../types/graph").JavaNodeLabel;
        name: string;
        qualifiedName: string | undefined;
        filePath: string;
    }[];
    incoming: never[];
    outgoing: never[];
} | {
    symbol: {
        id: string;
        label: import("../types/graph").JavaNodeLabel;
        name: string;
        qualifiedName: string | undefined;
        filePath: string;
    };
    candidates: never[];
    incoming: ContextEdge[];
    outgoing: ContextEdge[];
};
export {};
//# sourceMappingURL=context-builder.d.ts.map