import type { KnowledgeGraph } from '../types/graph.ts';
import { JAVA_KG_TOOLS } from './tools.ts';
interface ServerConfig {
    graph: KnowledgeGraph;
    repoName: string;
    repoPath: string;
}
type ToolArgs = Record<string, unknown>;
export interface JavaMCPServer {
    listTools: () => typeof JAVA_KG_TOOLS;
    callTool: (name: string, args: ToolArgs) => Promise<Record<string, unknown>>;
}
export declare const createJavaMCPServer: (config: ServerConfig) => JavaMCPServer;
export {};
//# sourceMappingURL=server.d.ts.map