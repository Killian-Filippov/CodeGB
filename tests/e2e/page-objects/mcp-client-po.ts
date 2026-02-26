/**
 * MCP Client Page Object
 *
 * Provides a high-level interface for interacting with the MCP server.
 * Encapsulates MCP protocol details and provides convenient methods.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface MCPToolResult {
  success: boolean;
  content: string;
  data?: unknown;
  error?: string;
}

export interface MCPQueryOptions {
  query: string;
  limit?: number;
  repo?: string;
}

export interface MCPContextOptions {
  symbol: string;
  repo?: string;
  include_calls?: boolean;
}

export interface MCPImpactOptions {
  target: string;
  direction: 'upstream' | 'downstream';
  maxDepth?: number;
  repo?: string;
}

export interface MCPCypherOptions {
  query: string;
  repo?: string;
}

/**
 * MCP Client Page Object
 */
export class MCPClientPO {
  private client: Client | null = null;
  private serverPath: string;
  private env: Record<string, string>;
  private useTsx = false;

  constructor(
    serverPath: string = 'packages/mcp-server/dist/index.js',
    env: Record<string, string> = {}
  ) {
    const requestedPath = path.resolve(process.cwd(), serverPath);
    const fallbackTsPath = requestedPath
      .replace(`${path.sep}dist${path.sep}index.js`, `${path.sep}src${path.sep}cli.ts`)
      .replace(/\.js$/, '.ts');
    const fallbackJsPath = requestedPath.replace(
      `${path.sep}dist${path.sep}`,
      `${path.sep}src${path.sep}`,
    );
    this.serverPath = existsSync(requestedPath)
      ? requestedPath
      : existsSync(fallbackTsPath)
        ? fallbackTsPath
        : fallbackJsPath;
    this.useTsx = this.serverPath.endsWith('.ts');
    this.env = env;
  }

  /**
   * Connect to MCP server
   */
  async connect(): Promise<void> {
    if (this.client) {
      try {
        await this.listTools();
        return;
      } catch {
        await this.disconnect();
      }
    }

    const transport = new StdioClientTransport({
      command: this.useTsx ? 'pnpm' : 'node',
      args: this.useTsx ? ['exec', 'tsx', this.serverPath] : [this.serverPath],
      env: {
        ...process.env,
        ...this.env,
      },
    });

    this.client = new Client(
      {
        name: 'e2e-test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await this.client.connect(transport);

    // Wait for server to be ready
    await this.waitForReady();
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /**
   * Wait for server to be ready
   */
  private async waitForReady(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify by listing tools
    try {
      await this.listTools();
    } catch (error) {
      // Retry once
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.listTools();
    }
  }

  /**
   * List all available tools
   */
  async listTools(): Promise<Tool[]> {
    if (!this.client) {
      throw new Error('Not connected to MCP server');
    }

    const result = await this.client.listTools();
    return result.tools;
  }

  /**
   * Check if tool exists
   */
  async hasTool(toolName: string): Promise<boolean> {
    const tools = await this.listTools();
    return tools.some(tool => tool.name === toolName);
  }

  /**
   * Execute query tool (keyword search)
   */
  async query(options: MCPQueryOptions): Promise<MCPToolResult> {
    return this.callTool('query', {
      query: options.query,
      limit: options.limit || 10,
      repo: options.repo,
    });
  }

  /**
   * Execute context tool (symbol 360-degree view)
   */
  async context(options: MCPContextOptions): Promise<MCPToolResult> {
    return this.callTool('context', {
      symbol: options.symbol,
      repo: options.repo,
      include_calls: options.include_calls !== false,
    });
  }

  /**
   * Execute impact tool (impact analysis)
   */
  async impact(options: MCPImpactOptions): Promise<MCPToolResult> {
    return this.callTool('impact', {
      target: options.target,
      direction: options.direction,
      maxDepth: options.maxDepth || 3,
      repo: options.repo,
    });
  }

  /**
   * Execute cypher tool (direct query)
   */
  async cypher(options: MCPCypherOptions): Promise<MCPToolResult> {
    return this.callTool('cypher', {
      query: options.query,
      repo: options.repo,
    });
  }

  /**
   * List repositories
   */
  async listRepos(): Promise<MCPToolResult> {
    return this.callTool('list_repos', {});
  }

  /**
   * Generic tool call
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    if (!this.client) {
      throw new Error('Not connected to MCP server');
    }

    try {
      const result = await this.client.callTool({
        name,
        arguments: args,
      });

      const textContent = result.content.find(c => c.type === 'text');
      if (!textContent) {
        return {
          success: false,
          content: '',
          error: 'No text content in response',
        };
      }

      const content = 'text' in textContent ? textContent.text : '';
      let data: unknown;

      try {
        data = JSON.parse(content);
      } catch {
        data = content;
      }

      return {
        success: true,
        content,
        data,
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Search for classes
   */
  async searchClasses(className: string, limit = 10): Promise<MCPToolResult> {
    const result = await this.query({ query: className, limit });
    if (result.data && typeof result.data === 'object' && 'results' in result.data) {
      const filtered = {
        ...result.data,
        results: (result.data.results as any[]).filter(r => r.type === 'Class'),
      };
      return { ...result, data: filtered };
    }
    return result;
  }

  /**
   * Search for methods
   */
  async searchMethods(methodName: string, limit = 10): Promise<MCPToolResult> {
    const result = await this.query({ query: methodName, limit });
    if (result.data && typeof result.data === 'object' && 'results' in result.data) {
      const filtered = {
        ...result.data,
        results: (result.data.results as any[]).filter(r => r.type === 'Method'),
      };
      return { ...result, data: filtered };
    }
    return result;
  }

  /**
   * Get class context
   */
  async getClassContext(className: string): Promise<MCPToolResult> {
    return this.context({ symbol: className, include_calls: true });
  }

  /**
   * Get upstream impacts
   */
  async getUpstreamImpacts(target: string, maxDepth = 3): Promise<MCPToolResult> {
    return this.impact({ target, direction: 'upstream', maxDepth });
  }

  /**
   * Get downstream impacts
   */
  async getDownstreamImpacts(target: string, maxDepth = 3): Promise<MCPToolResult> {
    return this.impact({ target, direction: 'downstream', maxDepth });
  }

  /**
   * Count nodes in database
   */
  async countNodes(nodeType?: string): Promise<number> {
    if (!nodeType) {
      return 0;
    }
    let query = 'MATCH (n) RETURN count(n) as count';
    if (nodeType) {
      query = `MATCH (n:${nodeType}) RETURN count(n) as count`;
    }

    const result = await this.cypher({ query });
    if (result.data && Array.isArray(result.data.results) && result.data.results[0]) {
      return result.data.results[0].count as number;
    }
    return 0;
  }

  /**
   * Get all classes
   */
  async getAllClasses(limit = 100): Promise<MCPToolResult> {
    const query = `MATCH (c:Class) RETURN c LIMIT ${limit}`;
    return this.cypher({ query });
  }

  /**
   * Get all methods for a class
   */
  async getClassMethods(className: string): Promise<MCPToolResult> {
    const query = `MATCH (c:Class {name: "${className}"})-[:CONTAINS]->(m:Method) RETURN m`;
    return this.cypher({ query });
  }

  /**
   * Get all fields for a class
   */
  async getClassFields(className: string): Promise<MCPToolResult> {
    const query = `MATCH (c:Class {name: "${className}"})-[:CONTAINS]->(f:Field) RETURN f`;
    return this.cypher({ query });
  }

  /**
   * Get class relationships
   */
  async getClassRelationships(className: string): Promise<MCPToolResult> {
    const query = `
      MATCH (c:Class {name: "${className}"})-[r]->(target)
      RETURN type(r) as relationship, target.name as targetName, target.type as targetType
    `;
    return this.cypher({ query });
  }
}
