export const traverseImpact = (graph, args) => {
    const startNodes = graph.nodes.filter((node) => node.properties.name === args.target);
    if (startNodes.length === 0) {
        return [];
    }
    const startIds = new Set(startNodes.map((node) => node.id));
    const queue = startNodes.map((node) => ({ node, depth: 0 }));
    const bestDepth = new Map();
    const result = [];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }
        if (current.depth >= args.maxDepth) {
            continue;
        }
        for (const rel of graph.relationships) {
            const isDownstream = args.direction === 'downstream' && rel.sourceId === current.node.id;
            const isUpstream = args.direction === 'upstream' && rel.targetId === current.node.id;
            if (!isDownstream && !isUpstream) {
                continue;
            }
            const nextId = args.direction === 'downstream' ? rel.targetId : rel.sourceId;
            if (startIds.has(nextId)) {
                continue;
            }
            const nextNode = graph.getNode(nextId);
            if (!nextNode) {
                continue;
            }
            const depth = current.depth + 1;
            const seenDepth = bestDepth.get(nextId);
            if (seenDepth !== undefined && seenDepth <= depth) {
                continue;
            }
            bestDepth.set(nextId, depth);
            result.push({
                id: nextNode.id,
                name: nextNode.properties.name,
                label: nextNode.label,
                depth,
                via: rel.type,
            });
            queue.push({ node: nextNode, depth });
        }
    }
    return result.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
};
//# sourceMappingURL=traversal.js.map