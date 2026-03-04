import path from 'node:path';

import type { KnowledgeGraph, ParsedJavaFile, ParsedJavaType } from '../types/graph';

export interface TypeRef {
  id: string;
  name: string;
  kind: ParsedJavaType['kind'];
  packageName: string;
  filePath: string;
}

export interface MethodRef {
  id: string;
  name: string;
  className: string;
  typeId: string;
  filePath: string;
  packageName: string;
  qualifiedName: string;
  signature: string;
  parameterCount: number;
}

export interface PendingCall {
  callerMethodId: string;
  callerClassName: string;
  callerFilePath: string;
  callerPackageName: string;
  simpleName: string;
  qualifiedNameHint?: string;
  argCount: number;
  imports: string[];
  source: 'tree-sitter' | 'regex-fallback';
  line: number;
  unsupportedReason?: string;
}

export interface PendingInheritance {
  sourceTypeId: string;
  superClass?: string;
  interfaces: string[];
}

export interface FileExtraction {
  fileNodeId: string;
  filePath: string;
  packageName: string;
  imports: string[];
  types: TypeRef[];
  methods: MethodRef[];
  pendingCalls: PendingCall[];
  pendingInheritance: PendingInheritance[];
}

const toRelPath = (repoPath: string, filePath: string): string => {
  const rel = path.relative(repoPath, filePath);
  return rel || path.basename(filePath);
};

const typeToLabel = (kind: ParsedJavaType['kind']): 'Class' | 'Interface' | 'Enum' | 'Annotation' => {
  return kind;
};

const buildTypeId = (type: ParsedJavaType): string => {
  return `${type.kind.toLowerCase()}:${type.qualifiedName}`;
};

const parseParameterTypes = (parameters: string[]): string[] => {
  return parameters
    .map((param) => param.split(/\s+/)[0] ?? '')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const processSymbolsForFile = (
  graph: KnowledgeGraph,
  parsed: ParsedJavaFile,
  repoPath: string,
  projectNodeId: string,
  parserSource: 'tree-sitter' | 'regex-fallback' = 'regex-fallback',
): FileExtraction => {
  const relFilePath = toRelPath(repoPath, parsed.filePath);
  const packageName = parsed.packageName || 'default';

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
    id: `${projectNodeId}->${packageNodeId}:CONTAINS`,
    sourceId: projectNodeId,
    targetId: packageNodeId,
    type: 'CONTAINS',
    confidence: 1,
    reason: 'file-package',
  });

  const fileNodeId = `file:${relFilePath}`;
  graph.addNode({
    id: fileNodeId,
    label: 'File',
    properties: {
      name: path.basename(relFilePath),
      qualifiedName: relFilePath,
      packageName,
      filePath: relFilePath,
    },
  });

  graph.addRelationship({
    id: `${packageNodeId}->${fileNodeId}:CONTAINS`,
    sourceId: packageNodeId,
    targetId: fileNodeId,
    type: 'CONTAINS',
    confidence: 1,
    reason: 'package-file',
  });

  const typeRefs: TypeRef[] = [];
  const methodRefs: MethodRef[] = [];
  const pendingCalls: PendingCall[] = [];
  const pendingInheritance: PendingInheritance[] = [];

  for (const type of parsed.types) {
    const typeNodeId = buildTypeId(type);
    typeRefs.push({
      id: typeNodeId,
      name: type.name,
      kind: type.kind,
      packageName,
      filePath: relFilePath,
    });

    graph.addNode({
      id: typeNodeId,
      label: typeToLabel(type.kind),
      properties: {
        name: type.name,
        qualifiedName: type.qualifiedName,
        packageName,
        filePath: relFilePath,
        startLine: type.startLine,
        endLine: type.endLine,
        modifiers: type.modifiers,
        superClass: type.superClass,
        interfaces: type.interfaces,
      },
    });

    graph.addRelationship({
      id: `${fileNodeId}->${typeNodeId}:CONTAINS`,
      sourceId: fileNodeId,
      targetId: typeNodeId,
      type: 'CONTAINS',
      confidence: 1,
      reason: 'file-type',
    });

    pendingInheritance.push({
      sourceTypeId: typeNodeId,
      superClass: type.superClass,
      interfaces: type.interfaces,
    });

    for (const field of type.fields) {
      const fieldId = `field:${type.qualifiedName}.${field.name}`;
      graph.addNode({
        id: fieldId,
        label: 'Field',
        properties: {
          name: field.name,
          qualifiedName: `${type.qualifiedName}.${field.name}`,
          packageName,
          className: type.name,
          filePath: relFilePath,
          startLine: field.startLine,
          endLine: field.endLine,
          modifiers: field.modifiers,
          type: field.type,
          isStatic: field.modifiers.includes('static'),
        },
      });

      graph.addRelationship({
        id: `${typeNodeId}->${fieldId}:CONTAINS`,
        sourceId: typeNodeId,
        targetId: fieldId,
        type: 'CONTAINS',
        confidence: 1,
        reason: 'type-field',
      });
    }

    for (const method of type.methods) {
      const signature = `${method.name}(${parseParameterTypes(method.parameters).join(',')})`;
      const methodId = `method:${type.qualifiedName}.${signature}`;
      methodRefs.push({
        id: methodId,
        name: method.name,
        className: type.name,
        typeId: typeNodeId,
        filePath: relFilePath,
        packageName,
        qualifiedName: `${type.qualifiedName}.${method.name}`,
        signature,
        parameterCount: method.parameters.length,
      });

      graph.addNode({
        id: methodId,
        label: method.isConstructor ? 'Constructor' : 'Method',
        properties: {
          name: method.name,
          qualifiedName: `${type.qualifiedName}.${signature}`,
          signature,
          packageName,
          className: type.name,
          filePath: relFilePath,
          startLine: method.startLine,
          endLine: method.endLine,
          modifiers: method.modifiers,
          returnType: method.returnType,
          parameters: method.parameters,
          isStatic: method.modifiers.includes('static'),
        },
      });

      graph.addRelationship({
        id: `${typeNodeId}->${methodId}:CONTAINS`,
        sourceId: typeNodeId,
        targetId: methodId,
        type: 'CONTAINS',
        confidence: 1,
        reason: 'type-method',
      });

      for (const callSite of method.calls) {
        const canUseQualifiedHint =
          Boolean(callSite.qualifier) && Boolean(callSite.qualifier?.includes('.')) && !callSite.qualifier?.includes('(');

        pendingCalls.push({
          callerMethodId: methodId,
          callerClassName: type.name,
          callerFilePath: relFilePath,
          callerPackageName: packageName,
          simpleName: callSite.simpleName,
          qualifiedNameHint: canUseQualifiedHint ? `${callSite.qualifier}.${callSite.simpleName}` : undefined,
          argCount: callSite.argCount,
          imports: parsed.imports,
          source: parserSource,
          line: callSite.line,
          unsupportedReason: callSite.unsupportedReason,
        });
      }
    }
  }

  return {
    fileNodeId,
    filePath: relFilePath,
    packageName,
    imports: parsed.imports,
    types: typeRefs,
    methods: methodRefs,
    pendingCalls,
    pendingInheritance,
  };
};
