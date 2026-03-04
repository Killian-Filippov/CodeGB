export type JavaNodeLabel =
  | 'Project'
  | 'Package'
  | 'File'
  | 'Class'
  | 'Interface'
  | 'Enum'
  | 'Annotation'
  | 'Method'
  | 'Constructor'
  | 'Field'
  | 'LocalVariable';

export type JavaRelType =
  | 'CONTAINS'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'CALLS'
  | 'ACCESSES'
  | 'IMPORTS'
  | 'OVERRIDES'
  | 'TYPE_OF';

export interface JavaNodeProperties {
  name: string;
  qualifiedName?: string;
  packageName?: string;
  className?: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  modifiers?: string[];
  superClass?: string;
  interfaces?: string[];
  annotations?: string[];
  signature?: string;
  returnType?: string;
  parameters?: string[];
  type?: string;
  isStatic?: boolean;
}

export interface JavaGraphNode {
  id: string;
  label: JavaNodeLabel;
  properties: JavaNodeProperties;
}

export interface JavaGraphRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: JavaRelType;
  confidence: number;
  reason: string;
  line?: number;
}

export interface KnowledgeGraph {
  readonly nodes: JavaGraphNode[];
  readonly relationships: JavaGraphRelationship[];
  readonly nodeCount: number;
  readonly relationshipCount: number;
  addNode: (node: JavaGraphNode) => void;
  addRelationship: (rel: JavaGraphRelationship) => void;
  getNode: (nodeId: string) => JavaGraphNode | undefined;
  findNodesByName: (name: string) => JavaGraphNode[];
}

export interface ParsedJavaField {
  name: string;
  type: string;
  modifiers: string[];
  startLine: number;
  endLine: number;
}

export interface ParsedJavaMethod {
  name: string;
  returnType?: string;
  parameters: string[];
  modifiers: string[];
  isConstructor: boolean;
  calls: ParsedJavaCallSite[];
  startLine: number;
  endLine: number;
}

export interface ParsedJavaCallSite {
  rawCallee: string;
  simpleName: string;
  qualifier?: string;
  argCount: number;
  line: number;
  isQualified: boolean;
  unsupportedReason?: string;
}

export interface ParsedJavaType {
  kind: 'Class' | 'Interface' | 'Enum' | 'Annotation';
  name: string;
  qualifiedName: string;
  modifiers: string[];
  superClass?: string;
  interfaces: string[];
  fields: ParsedJavaField[];
  methods: ParsedJavaMethod[];
  startLine: number;
  endLine: number;
}

export interface ParsedJavaFile {
  filePath: string;
  packageName: string;
  imports: string[];
  types: ParsedJavaType[];
}

export interface JavaSearchResult {
  node: JavaGraphNode;
  score: number;
}
