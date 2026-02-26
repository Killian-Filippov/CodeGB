/**
 * Database Page Object
 *
 * Provides a high-level interface for interacting with the KuzuDB database.
 * Encapsulates database operations and query execution.
 */

import { KuzuAdapter } from '../../../packages/core/src/storage/kuzu-adapter.js';

export interface Symbol {
  id?: string;
  name: string;
  type: string;
  qualifiedName?: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  className?: string;
  visibility?: string;
  returnType?: string;
  parameters?: Array<{ name: string; type: string }>;
  fieldType?: string;
  parent?: string;
}

export interface Relationship {
  from: Symbol;
  to: Symbol;
  type: string;
}

export interface NodeWithRelationships {
  node: Symbol;
  incoming: Relationship[];
  outgoing: Relationship[];
}

/**
 * Database Page Object
 */
export class DatabasePO {
  private adapter: KuzuAdapter;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.adapter = new KuzuAdapter(dbPath);
  }

  /**
   * Initialize database
   */
  async initialize(): Promise<void> {
    await this.adapter.init();
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    // KuzuAdapter doesn't have a close method in current implementation
    // This is a placeholder for future cleanup
  }

  /**
   * Execute Cypher query
   */
  async executeCypher(query: string): Promise<Array<Record<string, unknown>>> {
    return this.adapter.executeCypher(query);
  }

  /**
   * Get symbol by name and type
   */
  async getSymbol(name: string, type: string): Promise<Symbol | null> {
    const query = `MATCH (s:${type} {name: "${name}"}) RETURN s`;
    const results = await this.executeCypher(query);

    if (results.length === 0) {
      return null;
    }

    return this.formatNode(results[0].s);
  }

  /**
   * Get all symbols of a type
   */
  async getAllSymbols(type: string, limit = 100): Promise<Symbol[]> {
    const query = `MATCH (s:${type}) RETURN s LIMIT ${limit}`;
    const results = await this.executeCypher(query);

    return results.map((r) => this.formatNode(r.s));
  }

  /**
   * Count nodes by type
   */
  async countNodes(type?: string): Promise<number> {
    const graph = await this.adapter.loadGraph();
    if (!type) {
      return graph.nodes.length;
    }
    return graph.nodes.filter((node) => node.label === type).length;
  }

  /**
   * Get all classes
   */
  async getAllClasses(limit = 100): Promise<Symbol[]> {
    return this.getAllSymbols('Class', limit);
  }

  /**
   * Get all methods
   */
  async getAllMethods(limit = 100): Promise<Symbol[]> {
    return this.getAllSymbols('Method', limit);
  }

  /**
   * Get all fields
   */
  async getAllFields(limit = 100): Promise<Symbol[]> {
    return this.getAllSymbols('Field', limit);
  }

  /**
   * Get methods for a class
   */
  async getClassMethods(className: string): Promise<Symbol[]> {
    const graph = await this.adapter.loadGraph();
    const classNode = graph.nodes.find((n) => n.label === 'Class' && n.properties.name === className);
    if (!classNode) {
      return [];
    }
    return graph.relationships
      .filter((r) => r.type === 'CONTAINS' && r.sourceId === classNode.id)
      .map((r) => graph.getNode(r.targetId))
      .filter((n): n is any => !!n && n.label === 'Method')
      .map((n) => this.formatNode(n.properties))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get fields for a class
   */
  async getClassFields(className: string): Promise<Symbol[]> {
    const query = `
      MATCH (c:Class {name: "${className}"})-[:CONTAINS]->(f:Field)
      RETURN f
      ORDER BY f.name
    `;
    const results = await this.executeCypher(query);

    return results.map((r) => this.formatNode(r.f));
  }

  /**
   * Get relationships for a symbol
   */
  async getRelationships(
    symbolName: string,
    symbolType: string,
    direction: 'incoming' | 'outgoing' | 'both' = 'both',
  ): Promise<Relationship[]> {
    let query = '';

    if (direction === 'both') {
      query = `
        MATCH (s:${symbolType} {name: "${symbolName}"})-[r]-(other)
        RETURN s, r, other
      `;
    } else if (direction === 'outgoing') {
      query = `
        MATCH (s:${symbolType} {name: "${symbolName}"})-[r]->(other)
        RETURN s, r, other
      `;
    } else {
      query = `
        MATCH (s:${symbolType} {name: "${symbolName}"})<-[r]-(other)
        RETURN s, r, other
      `;
    }

    const results = await this.executeCypher(query);

    return results.map((r) => ({
      from: this.formatNode(r.s),
      to: this.formatNode(r.other),
      type: r.r.type || 'UNKNOWN',
    }));
  }

  /**
   * Get node with all relationships
   */
  async getNodeWithRelationships(
    symbolName: string,
    symbolType: string,
  ): Promise<NodeWithRelationships | null> {
    const node = await this.getSymbol(symbolName, symbolType);
    if (!node) {
      return null;
    }

    const outgoing = await this.getRelationships(symbolName, symbolType, 'outgoing');
    const incoming = await this.getRelationships(symbolName, symbolType, 'incoming');

    return { node, outgoing, incoming };
  }

  /**
   * Search symbols by name (partial match)
   */
  async searchByName(name: string, type?: string, limit = 10): Promise<Symbol[]> {
    let query = `MATCH (s) WHERE s.name CONTAINS "${name}"`;
    if (type) {
      query += ` AND s:${type}`;
    }
    query += ` RETURN s LIMIT ${limit}`;

    const results = await this.executeCypher(query);
    return results.map((r) => this.formatNode(r.s));
  }

  /**
   * Get inheritance chain for a class
   */
  async getInheritanceChain(className: string): Promise<Symbol[]> {
    const graph = await this.adapter.loadGraph();
    const start = graph.nodes.find((n) => n.label === 'Class' && n.properties.name === className);
    if (!start) {
      return [];
    }
    const visited = new Set<string>();
    const chain: Symbol[] = [];
    const queue = [start.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const rel of graph.relationships) {
        if (rel.type !== 'EXTENDS' || rel.sourceId !== current) {
          continue;
        }
        if (visited.has(rel.targetId)) {
          continue;
        }
        visited.add(rel.targetId);
        const parent = graph.getNode(rel.targetId);
        if (parent) {
          chain.push(this.formatNode(parent.properties));
          queue.push(parent.id);
        }
      }
    }
    return chain.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get classes that extend or implement this class/interface
   */
  async getSubclasses(className: string): Promise<Symbol[]> {
    const graph = await this.adapter.loadGraph();
    const parentIds = new Set(
      graph.nodes
        .filter((n) => n.properties.name === className)
        .map((n) => n.id),
    );
    return graph.relationships
      .filter((r) => (r.type === 'EXTENDS' || r.type === 'IMPLEMENTS') && parentIds.has(r.targetId))
      .map((r) => graph.getNode(r.sourceId))
      .filter((n): n is any => !!n && n.label === 'Class')
      .map((n) => this.formatNode(n.properties))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get classes that this class extends or implements
   */
  async getSuperclasses(className: string): Promise<Symbol[]> {
    const graph = await this.adapter.loadGraph();
    const classNode = graph.nodes.find((n) => n.label === 'Class' && n.properties.name === className);
    if (!classNode) {
      return [];
    }
    return graph.relationships
      .filter((r) => (r.type === 'EXTENDS' || r.type === 'IMPLEMENTS') && r.sourceId === classNode.id)
      .map((r) => graph.getNode(r.targetId))
      .filter((n): n is any => !!n)
      .map((n) => this.formatNode(n.properties))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get method calls made by a method
   */
  async getMethodCalls(methodName: string, className?: string): Promise<Symbol[]> {
    let query = `MATCH (m:Method {name: "${methodName}"})-[:CALLS]->(called) RETURN called`;

    if (className) {
      query = `MATCH (c:Class {name: "${className}"})-[:CONTAINS]->(m:Method {name: "${methodName}"})-[:CALLS]->(called) RETURN called`;
    }

    const results = await this.executeCypher(query);

    return results.map((r) => this.formatNode(r.called));
  }

  /**
   * Get methods that call this method
   */
  async getMethodCallers(methodName: string, className?: string): Promise<Symbol[]> {
    let query = `MATCH (caller:Method)-[:CALLS]->(m:Method {name: "${methodName}"}) RETURN caller`;

    if (className) {
      query = `MATCH (c:Class {name: "${className}"})-[:CONTAINS]->(caller:Method)-[:CALLS]->(m:Method {name: "${methodName}"}) RETURN caller`;
    }

    const results = await this.executeCypher(query);

    return results.map((r) => this.formatNode(r.caller));
  }

  /**
   * Get impact analysis (upstream or downstream)
   */
  async getImpact(
    symbolName: string,
    symbolType: string,
    direction: 'upstream' | 'downstream',
    maxDepth = 3,
  ): Promise<Array<{ symbol: Symbol; depth: number; path: string[] }>> {
    let relPattern = direction === 'upstream' ? '<-[:CALLS|CONTAINS*]-' : '-[:CALLS|CONTAINS*]->';

    const query = `
      MATCH path = (s:${symbolType} {name: "${symbolName}"})${relPattern}(related)
      WHERE length(path) <= ${maxDepth}
      RETURN related, length(path) as depth, [n IN nodes(path) | n.name] as pathNames
      ORDER BY depth, pathNames
    `;

    const results = await this.executeCypher(query);

    return results.map((r) => ({
      symbol: this.formatNode(r.related),
      depth: r.depth as number,
      path: r.pathNames as string[],
    }));
  }

  /**
   * Get all classes in a package
   */
  async getClassesByPackage(packageName: string): Promise<Symbol[]> {
    const query = `
      MATCH (c:Class)
      WHERE c.qualifiedName STARTS WITH "${packageName}."
      RETURN c
      ORDER BY c.name
    `;
    const results = await this.executeCypher(query);

    return results.map((r) => this.formatNode(r.c));
  }

  /**
   * Format node from database
   */
  private formatNode(node: Record<string, unknown>): Symbol {
    return {
      id: node._id as string,
      name: node.name as string,
      type: (node._type as string) || (node.type as string),
      qualifiedName: node.qualifiedName as string,
      file: node.file as string,
      startLine: node.startLine as number,
      endLine: node.endLine as number,
      className: node.className as string,
      visibility: node.visibility as string,
      returnType: node.returnType as string,
      fieldType: node.fieldType as string,
      parent: node.parent as string,
      parameters: Array.isArray(node.parameters)
        ? (node.parameters as Array<{ name: string; type: string }>)
        : undefined,
    };
  }

  /**
   * Get database statistics
   */
  async getStatistics(): Promise<{
    totalNodes: number;
    classes: number;
    methods: number;
    fields: number;
    interfaces: number;
    enums: number;
    relationships: number;
  }> {
    const graph = await this.adapter.loadGraph();
    const stats = {
      totalNodes: graph.nodes.length,
      classes: graph.nodes.filter((n) => n.label === 'Class').length,
      methods: graph.nodes.filter((n) => n.label === 'Method').length,
      fields: graph.nodes.filter((n) => n.label === 'Field').length,
      interfaces: graph.nodes.filter((n) => n.label === 'Interface').length,
      enums: graph.nodes.filter((n) => n.label === 'Enum').length,
      relationships: graph.relationships.length,
    };

    return stats;
  }
}
