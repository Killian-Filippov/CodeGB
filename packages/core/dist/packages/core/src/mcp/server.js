import { traverseImpact } from '../graph/traversal.ts';
import { executeCypherInMemory } from '../storage/kuzu-adapter.ts';
import { buildSymbolContext } from '../search/context-builder.ts';
import { searchByKeyword } from '../search/keyword-search.ts';
import { JAVA_KG_TOOLS } from './tools.ts';
export const createJavaMCPServer = (config) => {
    const listTools = () => JAVA_KG_TOOLS;
    const callTool = async (name, args) => {
        switch (name) {
            case 'query': {
                const query = String(args.query ?? '').trim();
                const limit = Number(args.limit ?? 10);
                const results = searchByKeyword(config.graph, query, limit).map((item) => ({
                    id: item.node.id,
                    label: item.node.label,
                    name: item.node.properties.name,
                    qualifiedName: item.node.properties.qualifiedName,
                    filePath: item.node.properties.filePath,
                    score: Number(item.score.toFixed(4)),
                }));
                return { results };
            }
            case 'context': {
                const symbol = String(args.symbol ?? '');
                return buildSymbolContext(config.graph, symbol);
            }
            case 'impact': {
                const target = String(args.target ?? '');
                const direction = String(args.direction ?? 'upstream');
                const maxDepth = Number(args.maxDepth ?? 3);
                const affected = traverseImpact(config.graph, {
                    target,
                    direction,
                    maxDepth,
                });
                return { target, direction, maxDepth, affected };
            }
            case 'cypher': {
                const query = String(args.query ?? '').trim();
                const rows = executeCypherInMemory(config.graph, query);
                return { rows };
            }
            case 'list_repos': {
                return {
                    repos: [
                        {
                            name: config.repoName,
                            path: config.repoPath,
                        },
                    ],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    };
    return {
        listTools,
        callTool,
    };
};
//# sourceMappingURL=server.js.map