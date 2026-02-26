import type { KnowledgeGraph, ParsedJavaFile, ParsedJavaType } from '../types/graph';
export interface TypeRef {
    id: string;
    name: string;
    kind: ParsedJavaType['kind'];
    packageName: string;
    filePath: string;
}
export interface MethodRef {
    id: string;
    name: string;
    className: string;
    typeId: string;
    filePath: string;
}
export interface PendingCall {
    callerMethodId: string;
    callerClassName: string;
    calleeName: string;
    line: number;
}
export interface PendingInheritance {
    sourceTypeId: string;
    superClass?: string;
    interfaces: string[];
}
export interface FileExtraction {
    fileNodeId: string;
    filePath: string;
    packageName: string;
    imports: string[];
    types: TypeRef[];
    methods: MethodRef[];
    pendingCalls: PendingCall[];
    pendingInheritance: PendingInheritance[];
}
export declare const processSymbolsForFile: (graph: KnowledgeGraph, parsed: ParsedJavaFile, repoPath: string, projectNodeId: string) => FileExtraction;
//# sourceMappingURL=symbol-processor.d.ts.map