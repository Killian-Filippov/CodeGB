import type {
  JavaGraphNode,
  JavaGraphRelationship,
  KnowledgeGraph,
} from '../types/graph';

export const createKnowledgeGraph = (): KnowledgeGraph => {
  const nodeMap = new Map<string, JavaGraphNode>();
  const relationshipMap = new Map<string, JavaGraphRelationship>();

  const addNode = (node: JavaGraphNode): void => {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, node);
    }
  };

  const addRelationship = (rel: JavaGraphRelationship): void => {
    if (!relationshipMap.has(rel.id)) {
      relationshipMap.set(rel.id, rel);
    }
  };

  const getNode = (nodeId: string): JavaGraphNode | undefined => nodeMap.get(nodeId);

  const findNodesByName = (name: string): JavaGraphNode[] => {
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
