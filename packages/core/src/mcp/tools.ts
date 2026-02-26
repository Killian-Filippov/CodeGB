export interface ToolDefinition {
  name: 'query' | 'context' | 'impact' | 'cypher' | 'list_repos';
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; default?: unknown }>;
    required: string[];
  };
}

export const JAVA_KG_TOOLS: ToolDefinition[] = [
  {
    name: 'query',
    description: '混合搜索入口（Phase 1 为关键词检索），按相关性返回类/方法/字段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '查询词' },
        limit: { type: 'number', description: '返回数量，默认 10', default: 10 },
        repo: { type: 'string', description: '仓库名（多仓库场景）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'context',
    description: '符号 360 度视图：入边、出边、文件位置。',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '符号名或 qualifiedName' },
        repo: { type: 'string', description: '仓库名（多仓库场景）' },
        include_calls: { type: 'boolean', description: '是否返回调用边（默认 true)', default: true },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'impact',
    description: '影响分析：上游/下游依赖扩散。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '目标符号名' },
        direction: { type: 'string', description: 'upstream 或 downstream' },
        maxDepth: { type: 'number', description: '最大深度，默认 3', default: 3 },
        repo: { type: 'string', description: '仓库名（多仓库场景）' },
      },
      required: ['target', 'direction'],
    },
  },
  {
    name: 'cypher',
    description: '执行 Cypher 查询（Phase 1 支持常用 MATCH 模式）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Cypher 查询语句' },
        repo: { type: 'string', description: '仓库名（多仓库场景）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_repos',
    description: '列出当前可用的已索引仓库。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];
