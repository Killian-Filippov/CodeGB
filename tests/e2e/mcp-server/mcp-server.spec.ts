/**
 * MCP Server E2E Tests
 *
 * Tests the complete interaction between MCP client and server for Phase 1 features:
 * - Tool registration
 * - Query tool (basic keyword search)
 * - Context tool (symbol 360-degree view)
 * - Impact tool (impact analysis)
 * - Cypher tool (direct Cypher query execution)
 * - List repos tool
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TestJavaRepository } from '../fixtures/test-repo.js';

describe('MCP Server E2E Tests', () => {
  let client: Client;
  let serverProcess: ChildProcess;
  let testRepo: TestJavaRepository;

  before(async () => {
    // Create a test Java repository
    testRepo = new TestJavaRepository();
    await testRepo.create();

    // Start the MCP server
    serverProcess = spawn('node', ['packages/mcp-server/dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        JAVA_KG_DB_PATH: testRepo.dbPath,
      },
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create MCP client
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['packages/mcp-server/dist/index.js'],
      env: {
        ...process.env,
        JAVA_KG_DB_PATH: testRepo.dbPath,
      },
    });

    client = new Client({
      name: 'e2e-test-client',
      version: '1.0.0',
    }, {
      capabilities: {},
    });

    await client.connect(transport);
  });

  after(async () => {
    await client.close();
    serverProcess.kill();
    await testRepo.cleanup();
  });

  describe('Tool Registration', () => {
    it('should register all Phase 1 tools', async () => {
      const tools = await client.listTools();

      assert.ok(tools.tools.length >= 4, 'Should have at least 4 tools');

      const toolNames = tools.tools.map(t => t.name);
      assert.ok(toolNames.includes('query'), 'Should have query tool');
      assert.ok(toolNames.includes('context'), 'Should have context tool');
      assert.ok(toolNames.includes('impact'), 'Should have impact tool');
      assert.ok(toolNames.includes('cypher'), 'Should have cypher tool');
      assert.ok(toolNames.includes('list_repos'), 'Should have list_repos tool');
    });

    it('should have correct tool schemas', async () => {
      const tools = await client.listTools();
      const queryTool = tools.tools.find(t => t.name === 'query');

      assert.ok(queryTool, 'Query tool should exist');
      assert.ok(queryTool?.inputSchema, 'Query tool should have input schema');

      const schema = queryTool!.inputSchema as any;
      assert.ok(schema.properties?.query, 'Query tool should have query parameter');
      assert.ok(schema.properties?.repo, 'Query tool should have repo parameter');
      assert.ok(schema.properties?.limit, 'Query tool should have limit parameter');
    });
  });

  describe('Query Tool (Basic Search)', () => {
    it('should search for classes by name', async () => {
      const result = await client.callTool({
        name: 'query',
        arguments: {
          query: 'UserService',
          repo: testRepo.repoName,
          limit: 10,
        },
      });

      const content = result.content as any[];
      assert.ok(content.length > 0, 'Should return search results');

      const textContent = content.find(c => c.type === 'text');
      assert.ok(textContent, 'Should have text content');

      const data = JSON.parse(textContent.text);
      assert.ok(data.results.length > 0, 'Should have search results in data');
      assert.ok(data.results.some((r: any) => r.type === 'Class'), 'Should have Class results');
    });

    it('should search for methods', async () => {
      const result = await client.callTool({
        name: 'query',
        arguments: {
          query: 'createUser',
          repo: testRepo.repoName,
          limit: 10,
        },
      });

      const content = result.content as any[];
      const textContent = content.find(c => c.type === 'text');
      const data = JSON.parse(textContent!.text);

      assert.ok(data.results.some((r: any) => r.type === 'Method'), 'Should have Method results');
    });

    it('should respect limit parameter', async () => {
      const limit = 3;
      const result = await client.callTool({
        name: 'query',
        arguments: {
          query: 'Service',
          repo: testRepo.repoName,
          limit,
        },
      });

      const content = result.content as any[];
      const textContent = content.find(c => c.type === 'text');
      const data = JSON.parse(textContent!.text);

      assert.ok(data.results.length <= limit, `Should return at most ${limit} results`);
    });
  });

  describe('Context Tool (Symbol View)', () => {
    it('should provide 360-degree view of a class symbol', async () => {
      // First, find a class symbol
      const searchResult = await client.callTool({
        name: 'query',
        arguments: {
          query: 'UserService',
          repo: testRepo.repoName,
          limit: 1,
        },
      });

      const searchContent = searchResult.content as any[];
      const searchData = JSON.parse(searchContent.find(c => c.type === 'text')!.text);
      const symbol = searchData.results[0];

      assert.ok(symbol, 'Should have found a symbol');

      // Get context for the symbol
      const contextResult = await client.callTool({
        name: 'context',
        arguments: {
          symbol: symbol.qualifiedName || symbol.name,
          repo: testRepo.repoName,
          include_calls: true,
        },
      });

      const contextContent = contextResult.content as any[];
      const textContent = contextContent.find(c => c.type === 'text');
      const data = JSON.parse(textContent!.text);

      assert.ok(data.symbol, 'Should include symbol information');
      assert.ok(data.symbol.type === 'Class', 'Symbol type should be Class');

      // Verify context includes related information
      if (data.methods) {
        assert.ok(Array.isArray(data.methods), 'Methods should be an array');
      }
      if (data.fields) {
        assert.ok(Array.isArray(data.fields), 'Fields should be an array');
      }
    });

    it('should include call relationships when requested', async () => {
      const searchResult = await client.callTool({
        name: 'query',
        arguments: {
          query: 'processData',
          repo: testRepo.repoName,
          limit: 1,
        },
      });

      const searchContent = searchResult.content as any[];
      const searchData = JSON.parse(searchContent.find(c => c.type === 'text')!.text);

      if (searchData.results.length > 0 && searchData.results[0].type === 'Method') {
        const contextResult = await client.callTool({
          name: 'context',
          arguments: {
            symbol: searchData.results[0].qualifiedName || searchData.results[0].name,
            repo: testRepo.repoName,
            include_calls: true,
          },
        });

        const contextContent = contextResult.content as any[];
        const textContent = contextContent.find(c => c.type === 'text');
        const data = JSON.parse(textContent!.text);

        // Call relationships should be present if they exist
        if (data.calls) {
          assert.ok(Array.isArray(data.calls), 'Calls should be an array');
        }
      }
    });
  });

  describe('Impact Tool (Impact Analysis)', () => {
    it('should analyze upstream dependencies', async () => {
      const searchResult = await client.callTool({
        name: 'query',
        arguments: {
          query: 'UserService',
          repo: testRepo.repoName,
          limit: 1,
        },
      });

      const searchContent = searchResult.content as any[];
      const searchData = JSON.parse(searchContent.find(c => c.type === 'text')!.text);

      if (searchData.results.length > 0) {
        const impactResult = await client.callTool({
          name: 'impact',
          arguments: {
            target: searchData.results[0].qualifiedName || searchData.results[0].name,
            repo: testRepo.repoName,
            direction: 'upstream',
            maxDepth: 2,
          },
        });

        const impactContent = impactResult.content as any[];
        const textContent = impactContent.find(c => c.type === 'text');
        const data = JSON.parse(textContent!.text);

        assert.ok(data.target, 'Should include target information');
        assert.ok(Array.isArray(data.impacts), 'Impacts should be an array');
      }
    });

    it('should analyze downstream dependencies', async () => {
      const searchResult = await client.callTool({
        name: 'query',
        arguments: {
          query: 'UserService',
          repo: testRepo.repoName,
          limit: 1,
        },
      });

      const searchContent = searchResult.content as any[];
      const searchData = JSON.parse(searchContent.find(c => c.type === 'text')!.text);

      if (searchData.results.length > 0) {
        const impactResult = await client.callTool({
          name: 'impact',
          arguments: {
            target: searchData.results[0].qualifiedName || searchData.results[0].name,
            repo: testRepo.repoName,
            direction: 'downstream',
            maxDepth: 2,
          },
        });

        const impactContent = impactResult.content as any[];
        const textContent = impactContent.find(c => c.type === 'text');
        const data = JSON.parse(textContent!.text);

        assert.ok(data.target, 'Should include target information');
        assert.ok(Array.isArray(data.impacts), 'Impacts should be an array');
      }
    });

    it('should respect maxDepth parameter', async () => {
      const maxDepth = 1;
      const searchResult = await client.callTool({
        name: 'query',
        arguments: {
          query: 'UserService',
          repo: testRepo.repoName,
          limit: 1,
        },
      });

      const searchContent = searchResult.content as any[];
      const searchData = JSON.parse(searchContent.find(c => c.type === 'text')!.text);

      if (searchData.results.length > 0) {
        const impactResult = await client.callTool({
          name: 'impact',
          arguments: {
            target: searchData.results[0].qualifiedName || searchData.results[0].name,
            repo: testRepo.repoName,
            direction: 'upstream',
            maxDepth,
          },
        });

        const impactContent = impactResult.content as any[];
        const textContent = impactContent.find(c => c.type === 'text');
        const data = JSON.parse(textContent!.text);

        // Check that no impact exceeds maxDepth
        if (data.impacts.length > 0) {
          const maxDepthFound = Math.max(...data.impacts.map((i: any) => i.depth || 0));
          assert.ok(maxDepthFound <= maxDepth, `Max depth should not exceed ${maxDepth}`);
        }
      }
    });
  });

  describe('Cypher Tool (Direct Query)', () => {
    it('should execute Cypher query and return results', async () => {
      const result = await client.callTool({
        name: 'cypher',
        arguments: {
          query: 'MATCH (c:Class) RETURN c LIMIT 5',
          repo: testRepo.repoName,
        },
      });

      const content = result.content as any[];
      assert.ok(content.length > 0, 'Should return results');

      const textContent = content.find(c => c.type === 'text');
      assert.ok(textContent, 'Should have text content');

      const data = JSON.parse(textContent!.text);
      assert.ok(Array.isArray(data.results), 'Results should be an array');
    });

    it('should query for specific class', async () => {
      const result = await client.callTool({
        name: 'cypher',
        arguments: {
          query: 'MATCH (c:Class {name: "UserService"}) RETURN c',
          repo: testRepo.repoName,
        },
      });

      const content = result.content as any[];
      const textContent = content.find(c => c.type === 'text');
      const data = JSON.parse(textContent!.text);

      assert.ok(data.results.length > 0, 'Should find UserService class');
      assert.strictEqual(data.results[0].c.name, 'UserService', 'Class name should match');
    });

    it('should query for class relationships', async () => {
      const result = await client.callTool({
        name: 'cypher',
        arguments: {
          query: `MATCH (c1:Class)-[r]->(c2:Class) RETURN c1.name as from, type(r) as rel, c2.name as to LIMIT 10`,
          repo: testRepo.repoName,
        },
      });

      const content = result.content as any[];
      const textContent = content.find(c => c.type === 'text');
      const data = JSON.parse(textContent!.text);

      assert.ok(Array.isArray(data.results), 'Results should be an array');
      if (data.results.length > 0) {
        assert.ok(data.results[0].from, 'Should have from node');
        assert.ok(data.results[0].rel, 'Should have relationship type');
        assert.ok(data.results[0].to, 'Should have to node');
      }
    });
  });

  describe('List Repos Tool', () => {
    it('should list all indexed repositories', async () => {
      const result = await client.callTool({
        name: 'list_repos',
        arguments: {},
      });

      const content = result.content as any[];
      assert.ok(content.length > 0, 'Should return results');

      const textContent = content.find(c => c.type === 'text');
      assert.ok(textContent, 'Should have text content');

      const data = JSON.parse(textContent!.text);
      assert.ok(Array.isArray(data.repos), 'Repos should be an array');
    });

    it('should include the test repository', async () => {
      const result = await client.callTool({
        name: 'list_repos',
        arguments: {},
      });

      const content = result.content as any[];
      const textContent = content.find(c => c.type === 'text');
      const data = JSON.parse(textContent!.text);

      const hasTestRepo = data.repos.some((r: any) => r.name === testRepo.repoName);
      assert.ok(hasTestRepo, 'Should include test repository');
    });
  });
});
