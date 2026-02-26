const toSymbolView = (node) => ({
    id: node.id,
    label: node.label,
    name: node.properties.name,
    qualifiedName: node.properties.qualifiedName,
    filePath: node.properties.filePath,
});
export const buildSymbolContext = (graph, symbol) => {
    const matches = graph.nodes.filter((node) => node.properties.name === symbol || node.properties.qualifiedName === symbol);
    if (matches.length === 0) {
        return {
            symbol: null,
            candidates: [],
            incoming: [],
            outgoing: [],
        };
    }
    if (matches.length > 1) {
        return {
            symbol: null,
            candidates: matches.map(toSymbolView),
            incoming: [],
            outgoing: [],
        };
    }
    const selected = matches[0];
    const incoming = [];
    const outgoing = [];
    for (const rel of graph.relationships) {
        if (rel.targetId === selected.id) {
            const from = graph.getNode(rel.sourceId);
            if (from) {
                incoming.push({ type: rel.type, from: from.properties.name, to: selected.properties.name });
            }
        }
        if (rel.sourceId === selected.id) {
            const to = graph.getNode(rel.targetId);
            if (to) {
                outgoing.push({ type: rel.type, from: selected.properties.name, to: to.properties.name });
            }
        }
    }
    return {
        symbol: toSymbolView(selected),
        candidates: [],
        incoming,
        outgoing,
    };
};
//# sourceMappingURL=context-builder.js.map