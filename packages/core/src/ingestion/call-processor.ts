import type { KnowledgeGraph } from '../types/graph';
import type { FileExtraction, MethodRef } from './symbol-processor';

const buildMethodIndex = (files: FileExtraction[]): Map<string, MethodRef[]> => {
  const index = new Map<string, MethodRef[]>();
  for (const file of files) {
    for (const method of file.methods) {
      const list = index.get(method.name) ?? [];
      list.push(method);
      index.set(method.name, list);
    }
  }
  return index;
};

const pickCallee = (candidates: MethodRef[], callerClassName: string): MethodRef => {
  const sameClass = candidates.find((candidate) => candidate.className === callerClassName);
  if (sameClass) {
    return sameClass;
  }
  return candidates[0] as MethodRef;
};

export const processCalls = (graph: KnowledgeGraph, files: FileExtraction[]): void => {
  const methodIndex = buildMethodIndex(files);

  for (const file of files) {
    for (const call of file.pendingCalls) {
      const candidates = methodIndex.get(call.calleeName);
      if (!candidates || candidates.length === 0) {
        continue;
      }

      const callee = pickCallee(candidates, call.callerClassName);
      if (call.callerMethodId === callee.id) {
        continue;
      }

      graph.addRelationship({
        id: `${call.callerMethodId}->${callee.id}:CALLS:${call.calleeName}:${call.line}`,
        sourceId: call.callerMethodId,
        targetId: callee.id,
        type: 'CALLS',
        confidence: 0.9,
        reason: 'name-resolution',
        line: call.line,
      });
    }
  }
};
