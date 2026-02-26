const SEARCHABLE_LABELS = new Set(['Class', 'Interface', 'Method', 'Constructor', 'Field', 'Enum', 'Annotation']);
const tokenize = (value) => {
    return value
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .map((token) => token.trim())
        .filter(Boolean);
};
const toDocumentText = (node) => {
    return [
        node.properties.name,
        node.properties.qualifiedName,
        node.properties.packageName,
        node.properties.className,
        node.properties.returnType,
        node.properties.type,
        node.properties.filePath,
    ]
        .filter(Boolean)
        .join(' ');
};
const buildIndex = (graph) => {
    const docs = graph.nodes
        .filter((node) => SEARCHABLE_LABELS.has(node.label))
        .map((node) => {
        const tokens = tokenize(toDocumentText(node));
        const tf = new Map();
        for (const token of tokens) {
            tf.set(token, (tf.get(token) ?? 0) + 1);
        }
        return {
            node,
            tf,
            length: tokens.length || 1,
        };
    });
    const avgLength = docs.length === 0 ? 1 : docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
    const df = new Map();
    for (const doc of docs) {
        for (const token of doc.tf.keys()) {
            df.set(token, (df.get(token) ?? 0) + 1);
        }
    }
    const idf = new Map();
    for (const [token, count] of df) {
        const numerator = docs.length - count + 0.5;
        const denominator = count + 0.5;
        idf.set(token, Math.log(1 + numerator / denominator));
    }
    return { docs, idf, avgLength };
};
export const searchByKeyword = (graph, query, limit = 10) => {
    const tokens = tokenize(query);
    if (tokens.length === 0) {
        return [];
    }
    const { docs, idf, avgLength } = buildIndex(graph);
    const k1 = 1.2;
    const b = 0.75;
    const scored = docs
        .map((doc) => {
        let score = 0;
        for (const token of tokens) {
            const tf = doc.tf.get(token) ?? 0;
            if (tf === 0) {
                continue;
            }
            const tokenIdf = idf.get(token) ?? 0;
            const denominator = tf + k1 * (1 - b + (b * doc.length) / avgLength);
            score += tokenIdf * ((tf * (k1 + 1)) / denominator);
        }
        return {
            node: doc.node,
            score,
        };
    })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    return scored;
};
//# sourceMappingURL=keyword-search.js.map