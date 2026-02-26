import { KuzuAdapter } from '../../../core/src/storage/kuzu-adapter.ts';
import { searchByKeyword } from '../../../core/src/search/keyword-search.ts';
export const runQueryCommand = async (args) => {
    const adapter = new KuzuAdapter(args.storagePath);
    const graph = await adapter.loadGraph();
    const results = searchByKeyword(graph, args.query, args.limit);
    if (results.length === 0) {
        return 'No results.';
    }
    return results
        .map((item, index) => {
        const name = item.node.properties.name;
        const label = item.node.label;
        const filePath = item.node.properties.filePath;
        return `${index + 1}. ${name} [${label}] ${filePath} score=${item.score.toFixed(4)}`;
    })
        .join('\n');
};
//# sourceMappingURL=query.js.map