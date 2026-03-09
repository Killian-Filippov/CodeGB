import type { KnowledgeGraph } from '../types/graph';
import type { FileExtraction, MethodRef } from './symbol-processor';

interface ImportScope {
  explicitTypes: Set<string>;
  wildcardPackages: Set<string>;
  staticMemberOwnersByName: Map<string, Set<string>>;
  staticWildcardOwners: Set<string>;
}

interface ResolutionResult {
  callee: MethodRef;
  confidence: number;
  strategy: string;
}

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

const buildQualifiedIndex = (files: FileExtraction[]): Map<string, MethodRef[]> => {
  const index = new Map<string, MethodRef[]>();
  for (const file of files) {
    for (const method of file.methods) {
      const list = index.get(method.qualifiedName) ?? [];
      list.push(method);
      index.set(method.qualifiedName, list);
    }
  }
  return index;
};

const parseImportScope = (imports: string[]): ImportScope => {
  const explicitTypes = new Set<string>();
  const wildcardPackages = new Set<string>();
  const staticMemberOwnersByName = new Map<string, Set<string>>();
  const staticWildcardOwners = new Set<string>();

  for (const imp of imports) {
    if (imp.startsWith('static ')) {
      const target = imp.slice('static '.length).trim();
      if (target.endsWith('.*')) {
        const owner = target.slice(0, -2).trim();
        if (owner) {
          staticWildcardOwners.add(owner);
        }
        continue;
      }
      const splitIndex = target.lastIndexOf('.');
      if (splitIndex <= 0) {
        continue;
      }
      const owner = target.slice(0, splitIndex).trim();
      const member = target.slice(splitIndex + 1).trim();
      if (owner && member) {
        const owners = staticMemberOwnersByName.get(member) ?? new Set<string>();
        owners.add(owner);
        staticMemberOwnersByName.set(member, owners);
      }
      continue;
    }

    if (imp.endsWith('.*')) {
      wildcardPackages.add(imp.slice(0, -2));
      continue;
    }

    explicitTypes.add(imp);
  }

  return {
    explicitTypes,
    wildcardPackages,
    staticMemberOwnersByName,
    staticWildcardOwners,
  };
};

const ownerTypeOfCandidate = (candidate: MethodRef): string => {
  return candidate.qualifiedName.split('.').slice(0, -1).join('.');
};

const getStaticImportArityCandidates = (
  candidates: MethodRef[],
  call: FileExtraction['pendingCalls'][number],
  scope: ImportScope,
): MethodRef[] => {
  const explicitOwners = scope.staticMemberOwnersByName.get(call.simpleName) ?? new Set<string>();
  const allowedOwners = new Set<string>([...scope.staticWildcardOwners, ...explicitOwners]);
  if (allowedOwners.size === 0) {
    return [];
  }

  return candidates.filter((candidate) => {
    if (candidate.parameterCount !== call.argCount) {
      return false;
    }
    return allowedOwners.has(ownerTypeOfCandidate(candidate));
  });
};

const hasStaticImportOwnerCandidate = (
  candidates: MethodRef[],
  call: FileExtraction['pendingCalls'][number],
  scope: ImportScope,
): boolean => {
  return getStaticImportArityCandidates(candidates, call, scope).length > 0;
};

const resolveStaticImportCall = (
  candidates: MethodRef[],
  call: FileExtraction['pendingCalls'][number],
  scope: ImportScope,
): ResolutionResult | undefined => {
  const filtered = getStaticImportArityCandidates(candidates, call, scope);
  if (filtered.length !== 1) {
    return undefined;
  }

  return {
    callee: filtered[0] as MethodRef,
    confidence: 0.9,
    strategy: 'static-import-owner-arity-exact',
  };
};

const isInImportScope = (candidate: MethodRef, call: FileExtraction['pendingCalls'][number], scope: ImportScope): boolean => {
  if (candidate.packageName === call.callerPackageName) {
    return true;
  }

  const typeName = candidate.qualifiedName.split('.').slice(0, -1).join('.');
  if (scope.explicitTypes.has(typeName)) {
    return true;
  }

  return scope.wildcardPackages.has(candidate.packageName);
};

const pickByClassFileScope = (
  candidates: MethodRef[],
  call: FileExtraction['pendingCalls'][number],
  scope: ImportScope,
): MethodRef | undefined => {
  const sameClass = candidates.find((candidate) => candidate.className === call.callerClassName);
  if (sameClass) {
    return sameClass;
  }

  const sameFile = candidates.find((candidate) => candidate.filePath === call.callerFilePath);
  if (sameFile) {
    return sameFile;
  }

  const inScope = candidates.find((candidate) => isInImportScope(candidate, call, scope));
  if (inScope) {
    return inScope;
  }

  return candidates[0];
};

const resolveCall = (
  candidates: MethodRef[],
  qualifiedCandidates: MethodRef[] | undefined,
  call: FileExtraction['pendingCalls'][number],
  scope: ImportScope,
): ResolutionResult | undefined => {
  if (qualifiedCandidates && qualifiedCandidates.length > 0) {
    const exactArity = qualifiedCandidates.filter((candidate) => candidate.parameterCount === call.argCount);
    if (exactArity.length > 0) {
      const picked = pickByClassFileScope(exactArity, call, scope);
      if (picked) {
        return {
          callee: picked,
          confidence: 0.95,
          strategy: 'qualifiedName-exact',
        };
      }
    }

    const picked = pickByClassFileScope(qualifiedCandidates, call, scope);
    if (picked) {
      return {
        callee: picked,
        confidence: 0.6,
        strategy: 'qualifiedName-exact-no-arity',
      };
    }
  }

  const arityCandidates = candidates.filter((candidate) => candidate.parameterCount === call.argCount);
  if (arityCandidates.length > 0) {
    const sameClass = arityCandidates.find((candidate) => candidate.className === call.callerClassName);
    if (sameClass) {
      return {
        callee: sameClass,
        confidence: 0.85,
        strategy: 'name-arity-same-class',
      };
    }

    const sameFile = arityCandidates.find((candidate) => candidate.filePath === call.callerFilePath);
    if (sameFile) {
      return {
        callee: sameFile,
        confidence: 0.8,
        strategy: 'name-arity-same-file',
      };
    }

    const inScope = arityCandidates.find((candidate) => isInImportScope(candidate, call, scope));
    if (inScope) {
      return {
        callee: inScope,
        confidence: 0.75,
        strategy: 'name-arity-import-scope',
      };
    }

    return {
      callee: arityCandidates[0] as MethodRef,
      confidence: 0.4,
      strategy: 'fallback-first-candidate',
    };
  }

  const sameClassNoArity = candidates.find((candidate) => candidate.className === call.callerClassName);
  if (sameClassNoArity) {
    return {
      callee: sameClassNoArity,
      confidence: 0.6,
      strategy: 'name-same-class-no-arity',
    };
  }

  if (candidates.length === 0) {
    return undefined;
  }

  return {
    callee: candidates[0] as MethodRef,
    confidence: 0.4,
    strategy: 'fallback-first-candidate',
  };
};

export const processCalls = (graph: KnowledgeGraph, files: FileExtraction[]): void => {
  const methodIndex = buildMethodIndex(files);
  const qualifiedIndex = buildQualifiedIndex(files);

  for (const file of files) {
    const scope = parseImportScope(file.imports);
    for (const call of file.pendingCalls) {
      if (call.unsupportedReason) {
        continue;
      }

      const candidates = methodIndex.get(call.simpleName);
      if (!candidates || candidates.length === 0) {
        continue;
      }

      const qualifiedCandidates = call.qualifiedNameHint ? qualifiedIndex.get(call.qualifiedNameHint) : undefined;
      const hasStaticImportForCall =
        !call.qualifiedNameHint &&
        (scope.staticWildcardOwners.size > 0 || scope.staticMemberOwnersByName.has(call.simpleName));
      const staticResolved = hasStaticImportForCall
        ? resolveStaticImportCall(candidates, call, scope)
        : undefined;
      const shouldFallbackFromStatic =
        !staticResolved &&
        hasStaticImportForCall &&
        !hasStaticImportOwnerCandidate(candidates, call, scope);
      const resolved =
        staticResolved ??
        (hasStaticImportForCall && !shouldFallbackFromStatic
          ? undefined
          : resolveCall(candidates, qualifiedCandidates, call, scope));
      if (!resolved) {
        continue;
      }

      const callee = resolved.callee;
      if (call.callerMethodId === callee.id) {
        continue;
      }

      graph.addRelationship({
        id: `${call.callerMethodId}->${callee.id}:CALLS:${call.simpleName}:${call.line}`,
        sourceId: call.callerMethodId,
        targetId: callee.id,
        type: 'CALLS',
        confidence: resolved.confidence,
        reason: `strategy=${resolved.strategy};source=${call.source}`,
        line: call.line,
      });
    }
  }
};
