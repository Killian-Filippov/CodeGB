export const createKnowledgeGraph = () => {
    const nodeMap = new Map();
    const relationshipMap = new Map();
    const addNode = (node) => {
        if (!nodeMap.has(node.id)) {
            nodeMap.set(node.id, node);
        }
    };
    const addRelationship = (rel) => {
        if (!relationshipMap.has(rel.id)) {
            relationshipMap.set(rel.id, rel);
        }
    };
    const getNode = (nodeId) => nodeMap.get(nodeId);
    const findNodesByName = (name) => {
        return Array.from(nodeMap.values()).filter((node) => node.properties.name === name);
    };
    return {
        get nodes() {
            return Array.from(nodeMap.values());
        },
        get relationships() {
            return Array.from(relationshipMap.values());
        },
        get nodeCount() {
            return nodeMap.size;
        },
        get relationshipCount() {
            return relationshipMap.size;
        },
        addNode,
        addRelationship,
        getNode,
        findNodesByName,
    };
};
//# sourceMappingURL=graph.js.map