export interface ToolDefinition {
    name: 'query' | 'context' | 'impact' | 'cypher' | 'list_repos';
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            default?: unknown;
        }>;
        required: string[];
    };
}
export declare const JAVA_KG_TOOLS: ToolDefinition[];
//# sourceMappingURL=tools.d.ts.map