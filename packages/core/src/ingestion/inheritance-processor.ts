import type { KnowledgeGraph } from '../types/graph';
import type { FileExtraction } from './symbol-processor';

interface TypeIndexValue {
  id: string;
  kind: 'Class' | 'Interface' | 'Enum' | 'Annotation';
}

const buildTypeIndex = (files: FileExtraction[]): Map<string, TypeIndexValue[]> => {
  const index = new Map<string, TypeIndexValue[]>();

  for (const file of files) {
    for (const type of file.types) {
      const list = index.get(type.name) ?? [];
      list.push({ id: type.id, kind: type.kind });
      index.set(type.name, list);
    }
  }

  return index;
};

const pickTarget = (index: Map<string, TypeIndexValue[]>, name: string, fallbackKind: 'Class' | 'Interface'): TypeIndexValue => {
  const matches = index.get(name);
  if (matches && matches.length > 0) {
    return matches[0] as TypeIndexValue;
  }

  return {
    id: `${fallbackKind.toLowerCase()}:external.${name}`,
    kind: fallbackKind,
  };
};

export const processInheritance = (graph: KnowledgeGraph, files: FileExtraction[]): void => {
  const typeIndex = buildTypeIndex(files);

  for (const file of files) {
    for (const pending of file.pendingInheritance) {
      if (pending.superClass) {
        const target = pickTarget(typeIndex, pending.superClass, 'Class');

        if (!graph.getNode(target.id)) {
          graph.addNode({
            id: target.id,
            label: target.kind,
            properties: {
              name: pending.superClass,
              qualifiedName: pending.superClass,
              filePath: '',
            },
          });
        }

        graph.addRelationship({
          id: `${pending.sourceTypeId}->${target.id}:EXTENDS`,
          sourceId: pending.sourceTypeId,
          targetId: target.id,
          type: 'EXTENDS',
          confidence: 1,
          reason: 'class-extends',
        });
      }

      for (const iface of pending.interfaces) {
        const target = pickTarget(typeIndex, iface, 'Interface');

        if (!graph.getNode(target.id)) {
          graph.addNode({
            id: target.id,
            label: 'Interface',
            properties: {
              name: iface,
              qualifiedName: iface,
              filePath: '',
            },
          });
        }

        graph.addRelationship({
          id: `${pending.sourceTypeId}->${target.id}:IMPLEMENTS:${iface}`,
          sourceId: pending.sourceTypeId,
          targetId: target.id,
          type: 'IMPLEMENTS',
          confidence: 1,
          reason: 'class-implements',
        });
      }
    }
  }
};
