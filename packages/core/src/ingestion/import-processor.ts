import type { KnowledgeGraph } from '../types/graph';
import type { FileExtraction } from './symbol-processor';

const toImportPackage = (value: string): string => {
  if (value.endsWith('.*')) {
    return value.slice(0, -2);
  }
  const parts = value.split('.');
  if (parts.length <= 1) {
    return value;
  }
  const last = parts[parts.length - 1] ?? '';
  const looksLikeType = /^[A-Z]/.test(last);
  if (looksLikeType) {
    return parts.slice(0, -1).join('.');
  }
  return value;
};

export const processImports = (graph: KnowledgeGraph, files: FileExtraction[]): void => {
  for (const file of files) {
    for (const imp of file.imports) {
      const packageName = toImportPackage(imp);
      const packageNodeId = `package:${packageName}`;
      graph.addNode({
        id: packageNodeId,
        label: 'Package',
        properties: {
          name: packageName,
          qualifiedName: packageName,
          packageName,
          filePath: '',
        },
      });

      graph.addRelationship({
        id: `${file.fileNodeId}->${packageNodeId}:IMPORTS`,
        sourceId: file.fileNodeId,
        targetId: packageNodeId,
        type: 'IMPORTS',
        confidence: 1,
        reason: imp,
      });
    }
  }
};
