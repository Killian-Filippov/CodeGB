/**
 * MCP Tools Phase 1 E2E Tests
 *
 * Comprehensive tests for all 4 MCP tools in Phase 1:
 * 1. Query tool - keyword search
 * 2. Context tool - symbol 360-degree view
 * 3. Impact tool - impact analysis
 * 4. Cypher tool - direct query execution
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MCPClientPO } from '../page-objects/mcp-client-po.js';
import { DatabasePO } from '../page-objects/database-po.js';
import { CLIPO } from '../page-objects/cli-po.js';
import { getFixture, FIXTURE_CATEGORIES } from '../fixtures/java-fixtures.js';

describe('MCP Tools Phase 1 E2E Tests', () => {
  let mcpClient: MCPClientPO;
  let db: DatabasePO;
  let cli: CLIPO;
  let testDir: string;
  let dbPath: string;

  before(async () => {
    // Setup test environment
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-mcp-tools-'));
    dbPath = path.join(os.tmpdir(), `java-kg-mcp-db-${Date.now()}`);

    // Initialize page objects
    mcpClient = new MCPClientPO('packages/mcp-server/dist/index.js', {
      JAVA_KG_DB_PATH: dbPath,
    });
    db = new DatabasePO(dbPath);
    cli = new CLIPO('packages/cli/dist/index.js', dbPath);

    // Create and index test data
    await setupTestData();
  });

  after(async () => {
    await mcpClient.disconnect();
    await db.close();

    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    try {
      await fs.rm(dbPath, { recursive: true, force: true });
    } catch {}
  });

  async function setupTestData(): Promise<void> {
    const srcDir = path.join(testDir, 'src/main/java/com/example');
    await fs.mkdir(srcDir, { recursive: true });

    // Create comprehensive test fixtures
    await fs.writeFile(path.join(srcDir, 'UserService.java'), getFixture('serviceClass'));
    await fs.writeFile(path.join(srcDir, 'UserRepository.java'), getFixture('interfaceDefinition'));
    await fs.writeFile(path.join(srcDir, 'UserRepositoryImpl.java'), getFixture('interfaceImpl'));
    await fs.writeFile(path.join(srcDir, 'UserController.java'), getFixture('controller'));
    await fs.writeFile(path.join(srcDir, 'BaseEntity.java'), getFixture('inheritance'));
    await fs.writeFile(path.join(srcDir, 'Order.java'), getFixture('jpaEntity'));

    // Initialize and index
    await cli.init({ repoPath: testDir, dbPath: dbPath });
    await cli.index({ repoPath: testDir, dbPath: dbPath });
  }

  describe('Tool Registration', () => {
    it('should register all Phase 1 tools', async () => {
      await mcpClient.connect();

      const tools = await mcpClient.listTools();

      assert.ok(tools.length >= 5, `Should have at least 5 tools, got ${tools.length}`);

      const toolNames = tools.map((t) => t.name);
      assert.ok(toolNames.includes('query'), 'Should have query tool');
      assert.ok(toolNames.includes('context'), 'Should have context tool');
      assert.ok(toolNames.includes('impact'), 'Should have impact tool');
      assert.ok(toolNames.includes('cypher'), 'Should have cypher tool');
      assert.ok(toolNames.includes('list_repos'), 'Should have list_repos tool');
    });

    it('should have proper tool schemas', async () => {
      await mcpClient.connect();

      const tools = await mcpClient.listTools();

      // Check query tool schema
      const queryTool = tools.find((t) => t.name === 'query');
      assert.ok(queryTool, 'Query tool should exist');
      assert.ok(queryTool!.inputSchema, 'Query tool should have input schema');

      const querySchema = queryTool!.inputSchema as any;
      assert.ok(querySchema.properties?.query, 'Should have query parameter');
      assert.ok(querySchema.properties?.limit, 'Should have limit parameter');
      assert.strictEqual(querySchema.required?.[0], 'query', 'query should be required');

      // Check context tool schema
      const contextTool = tools.find((t) => t.name === 'context');
      assert.ok(contextTool, 'Context tool should exist');
      assert.ok(contextTool!.inputSchema, 'Context tool should have input schema');

      const contextSchema = contextTool!.inputSchema as any;
      assert.ok(contextSchema.properties?.symbol, 'Should have symbol parameter');
      assert.strictEqual(contextSchema.required?.[0], 'symbol', 'symbol should be required');

      // Check impact tool schema
      const impactTool = tools.find((t) => t.name === 'impact');
      assert.ok(impactTool, 'Impact tool should exist');
      assert.ok(impactTool!.inputSchema, 'Impact tool should have input schema');

      const impactSchema = impactTool!.inputSchema as any;
      assert.ok(impactSchema.properties?.target, 'Should have target parameter');
      assert.ok(impactSchema.properties?.direction, 'Should have direction parameter');
    });
  });

  describe('Query Tool - Basic Keyword Search', () => {
    beforeEach(async () => {
      if (!mcpClient) {
        await mcpClient.connect();
      }
    });

    it('should search by class name', async () => {
      const result = await mcpClient.query({
        query: 'UserService',
        limit: 10,
      });

      assert.ok(result.success, 'Query should succeed');
      assert.ok(result.data, 'Should have data');

      const data = result.data as any;
      assert.ok(data.results, 'Should have results array');
      assert.ok(data.results.length > 0, 'Should find results');

      const userService = data.results.find((r: any) => r.name === 'UserService');
      assert.ok(userService, 'Should find UserService');
      assert.strictEqual(userService.type, 'Class', 'Should be a Class type');
    });

    it('should search by method name', async () => {
      const result = await mcpClient.query({
        query: 'createUser',
        limit: 10,
      });

      assert.ok(result.success);
      const data = result.data as any;

      const createUserMethod = data.results.find((r: any) => r.name === 'createUser');
      assert.ok(createUserMethod, 'Should find createUser method');
      assert.strictEqual(createUserMethod.type, 'Method', 'Should be a Method type');
    });

    it('should search partial matches', async () => {
      const result = await mcpClient.searchClasses('Service', 10);

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.results.length >= 2, 'Should find multiple Service classes');
      assert.ok(
        data.results.every((r: any) => r.name.includes('Service')),
        'All results should contain "Service"',
      );
    });

    it('should respect limit parameter', async () => {
      const limit = 3;
      const result = await mcpClient.query({
        query: 'Service',
        limit,
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.results.length <= limit, `Should return at most ${limit} results`);
    });

    it('should handle no results', async () => {
      const result = await mcpClient.query({
        query: 'NonExistentClassXYZ123ABC',
        limit: 10,
      });

      assert.ok(result.success, 'Should succeed even with no results');
      const data = result.data as any;

      assert.strictEqual(data.results.length, 0, 'Should have no results');
    });

    it('should return structured results with metadata', async () => {
      const result = await mcpClient.query({
        query: 'UserService',
        limit: 1,
      });

      assert.ok(result.success);
      const data = result.data as any;

      if (data.results.length > 0) {
        const item = data.results[0];
        assert.ok(item.name, 'Should have name');
        assert.ok(item.type, 'Should have type');
        assert.ok(item.qualifiedName || item.file, 'Should have qualifiedName or file');
      }
    });
  });

  describe('Context Tool - Symbol 360-Degree View', () => {
    beforeEach(async () => {
      if (!mcpClient) {
        await mcpClient.connect();
      }
    });

    it('should provide context for a class symbol', async () => {
      const result = await mcpClient.getClassContext('UserService');

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.symbol, 'Should have symbol information');
      assert.strictEqual(data.symbol.name, 'UserService');
      assert.strictEqual(data.symbol.type, 'Class');

      assert.ok(data.methods, 'Should have methods');
      assert.ok(Array.isArray(data.methods), 'Methods should be array');
      assert.ok(data.methods.length > 0, 'Should have methods');

      assert.ok(data.fields, 'Should have fields');
      assert.ok(Array.isArray(data.fields), 'Fields should be array');
      assert.ok(data.fields.length > 0, 'Should have fields');
    });

    it('should include method details in class context', async () => {
      const result = await mcpClient.getClassContext('UserService');

      assert.ok(result.success);
      const data = result.data as any;

      const createUserMethod = data.methods.find((m: any) => m.name === 'createUser');
      assert.ok(createUserMethod, 'Should include createUser method');

      assert.ok(createUserMethod.name, 'Method should have name');
      assert.ok(createUserMethod.returnType, 'Method should have returnType');
      assert.ok(createUserMethod.parameters, 'Method should have parameters');
    });

    it('should include field details in class context', async () => {
      const result = await mcpClient.getClassContext('UserService');

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.fields.length >= 2, 'Should have at least 2 fields');

      const fields = data.fields as any[];
      assert.ok(
        fields.every((f) => f.name),
        'All fields should have name',
      );
      assert.ok(
        fields.every((f) => f.type || f.fieldType),
        'All fields should have type',
      );
    });

    it('should include call relationships when requested', async () => {
      const result = await mcpClient.context({
        symbol: 'createUser',
        include_calls: true,
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.calls !== undefined, 'Should include calls when requested');
      if (data.calls) {
        assert.ok(Array.isArray(data.calls), 'Calls should be array');
      }
    });

    it('should handle non-existent symbol gracefully', async () => {
      const result = await mcpClient.context({
        symbol: 'NonExistentSymbolXYZ123',
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.error || data.symbol === null, 'Should indicate error or null symbol');
    });

    it('should provide context for method symbol', async () => {
      const result = await mcpClient.context({
        symbol: 'createUser',
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.symbol, 'Should have symbol information');
      assert.strictEqual(data.symbol.name, 'createUser');
      assert.strictEqual(data.symbol.type, 'Method');
    });
  });

  describe('Impact Tool - Impact Analysis', () => {
    beforeEach(async () => {
      if (!mcpClient) {
        await mcpClient.connect();
      }
    });

    it('should analyze upstream dependencies', async () => {
      const result = await mcpClient.getUpstreamImpacts('UserService', 2);

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.target, 'Should include target information');
      assert.strictEqual(data.target.name, 'UserService');

      assert.ok(data.impacts, 'Should have impacts array');
      assert.ok(Array.isArray(data.impacts), 'Impacts should be array');

      if (data.impacts.length > 0) {
        const impact = data.impacts[0];
        assert.ok(impact.symbol, 'Impact should have symbol');
        assert.ok(impact.depth !== undefined, 'Impact should have depth');
        assert.ok(impact.path, 'Impact should have path');
      }
    });

    it('should analyze downstream dependencies', async () => {
      const result = await mcpClient.getDownstreamImpacts('UserService', 2);

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.target, 'Should include target');
      assert.ok(data.impacts, 'Should have impacts');
      assert.ok(Array.isArray(data.impacts));
    });

    it('should respect maxDepth parameter', async () => {
      const maxDepth = 1;
      const result = await mcpClient.getUpstreamImpacts('UserService', maxDepth);

      assert.ok(result.success);
      const data = result.data as any;

      if (data.impacts.length > 0) {
        const maxDepthFound = Math.max(...data.impacts.map((i: any) => i.depth || 0));
        assert.ok(maxDepthFound <= maxDepth, `Max depth should not exceed ${maxDepth}`);
      }
    });

    it('should include relationship types in impact', async () => {
      const result = await mcpClient.impact({
        target: 'UserService',
        direction: 'upstream',
        maxDepth: 2,
      });

      assert.ok(result.success);
      const data = result.data as any;

      if (data.impacts.length > 0) {
        const impact = data.impacts[0];
        assert.ok(impact.relationshipType, 'Impact should have relationship type');
      }
    });

    it('should handle circular dependencies', async () => {
      const result = await mcpClient.getUpstreamImpacts('UserService', 5);

      assert.ok(result.success);
      const data = result.data as any;

      // Verify no duplicates
      const paths = data.impacts.map((i: any) => i.path.join('->'));
      const uniquePaths = new Set(paths);
      assert.strictEqual(paths.length, uniquePaths.size, 'Should not have duplicate paths');
    });

    it('should return empty impacts for isolated symbol', async () => {
      // First, create an isolated class
      const srcDir = path.join(testDir, 'src/main/java/com/example');
      await fs.writeFile(
        path.join(srcDir, 'Isolated.java'),
        `
package com.example;

public class Isolated {
    public void isolatedMethod() {}
}
`,
      );

      await cli.index({ repoPath: testDir, dbPath: dbPath });

      const result = await mcpClient.getUpstreamImpacts('Isolated', 2);

      assert.ok(result.success);
      const data = result.data as any;

      assert.strictEqual(data.impacts.length, 0, 'Isolated class should have no impacts');
    });
  });

  describe('Cypher Tool - Direct Query Execution', () => {
    beforeEach(async () => {
      if (!mcpClient) {
        await mcpClient.connect();
      }
    });

    it('should execute simple MATCH query', async () => {
      const result = await mcpClient.cypher({
        query: 'MATCH (n) RETURN n LIMIT 5',
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.results, 'Should have results');
      assert.ok(Array.isArray(data.results), 'Results should be array');
      assert.ok(data.results.length > 0, 'Should return results');
    });

    it('should query for specific class', async () => {
      const result = await mcpClient.cypher({
        query: 'MATCH (c:Class {name: "UserService"}) RETURN c',
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.results.length > 0, 'Should find UserService');
      assert.strictEqual(data.results[0].c.name, 'UserService');
    });

    it('should query class relationships', async () => {
      const result = await mcpClient.cypher({
        query: `
          MATCH (c:Class)-[r]->(target)
          RETURN c.name as from, type(r) as rel, target.name as to, target.type as targetType
          LIMIT 10
        `,
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.results.length > 0, 'Should have relationships');

      const firstRel = data.results[0];
      assert.ok(firstRel.from, 'Should have from node');
      assert.ok(firstRel.rel, 'Should have relationship type');
      assert.ok(firstRel.to, 'Should have to node');
    });

    it('should query with WHERE clause', async () => {
      const result = await mcpClient.cypher({
        query: `
          MATCH (c:Class)
          WHERE c.name CONTAINS "Service"
          RETURN c.name as name
          ORDER BY name
        `,
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.results.length >= 1, 'Should find classes with "Service"');
      assert.ok(
        data.results.every((r: any) => r.name.includes('Service')),
        'All results should contain "Service"',
      );
    });

    it('should query with aggregation', async () => {
      const result = await mcpClient.cypher({
        query: `
          MATCH (c:Class)-[:CONTAINS]->(m:Method)
          RETURN c.name as className, count(m) as methodCount
          ORDER BY methodCount DESC
        `,
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.results.length > 0, 'Should have aggregation results');

      const firstResult = data.results[0];
      assert.ok(firstResult.className, 'Should have class name');
      assert.ok(typeof firstResult.methodCount === 'number', 'Should have method count');
    });

    it('should handle complex multi-hop query', async () => {
      const result = await mcpClient.cypher({
        query: `
          MATCH (c1:Class)-[:CONTAINS]->(m1:Method)-[:CALLS]->(m2:Method)<-[:CONTAINS]-(c2:Class)
          RETURN DISTINCT c1.name, c2.name
          LIMIT 10
        `,
      });

      assert.ok(result.success);
      const data = result.data as any;

      // Results may be empty if no call relationships exist
      assert.ok(Array.isArray(data.results), 'Results should be array');
    });

    it('should handle invalid Cypher query', async () => {
      const result = await mcpClient.cypher({
        query: 'INVALID SYNTAX QUERY',
      });

      assert.ok(!result.success, 'Should fail on invalid query');
      assert.ok(result.error, 'Should have error message');
      assert.ok(typeof result.error === 'string', 'Error should be string');
    });

    it('should handle query with no results', async () => {
      const result = await mcpClient.cypher({
        query: 'MATCH (c:Class {name: "NonExistentClassXYZ123"}) RETURN c',
      });

      assert.ok(result.success, 'Should succeed even with no results');
      const data = result.data as any;

      assert.strictEqual(data.results.length, 0, 'Should have no results');
    });

    it('should respect LIMIT clause', async () => {
      const limit = 2;
      const result = await mcpClient.cypher({
        query: `MATCH (n) RETURN n LIMIT ${limit}`,
      });

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.results.length <= limit, `Should return at most ${limit} results`);
    });
  });

  describe('List Repos Tool', () => {
    beforeEach(async () => {
      if (!mcpClient) {
        await mcpClient.connect();
      }
    });

    it('should list all indexed repositories', async () => {
      const result = await mcpClient.listRepos();

      assert.ok(result.success);
      const data = result.data as any;

      assert.ok(data.repos, 'Should have repos array');
      assert.ok(Array.isArray(data.repos), 'Repos should be array');
      assert.ok(data.repos.length > 0, 'Should have at least one repository');
    });

    it('should include repository metadata', async () => {
      const result = await mcpClient.listRepos();

      assert.ok(result.success);
      const data = result.data as any;

      if (data.repos.length > 0) {
        const repo = data.repos[0];
        assert.ok(repo.name, 'Repo should have name');
        assert.ok(repo.path, 'Repo should have path');
      }
    });

    it('should return empty list when no repos indexed', async () => {
      // Create a new client with empty database
      const emptyDbPath = path.join(os.tmpdir(), `java-kg-empty-${Date.now()}`);
      const emptyClient = new MCPClientPO('packages/mcp-server/dist/index.js', {
        JAVA_KG_DB_PATH: emptyDbPath,
      });

      await emptyClient.connect();

      const result = await emptyClient.listRepos();

      assert.ok(result.success);
      const data = result.data as any;

      assert.strictEqual(data.repos.length, 0, 'Should have no repositories');

      await emptyClient.disconnect();
      await fs.rm(emptyDbPath, { recursive: true, force: true }).catch(() => {});
    });
  });

  describe('Integration Between Tools', () => {
    beforeEach(async () => {
      if (!mcpClient) {
        await mcpClient.connect();
      }
    });

    it('should use query to find symbol then get context', async () => {
      // Step 1: Query to find symbol
      const queryResult = await mcpClient.query({
        query: 'UserService',
        limit: 1,
      });

      assert.ok(queryResult.success);
      const queryData = queryResult.data as any;
      assert.ok(queryData.results.length > 0);

      // Step 2: Get context for found symbol
      const contextResult = await mcpClient.context({
        symbol: queryData.results[0].name,
      });

      assert.ok(contextResult.success);
      const contextData = contextResult.data as any;

      assert.ok(contextData.symbol, 'Should have symbol in context');
      assert.strictEqual(contextData.symbol.name, queryData.results[0].name);
    });

    it('should use query to find symbol then analyze impact', async () => {
      // Step 1: Query
      const queryResult = await mcpClient.query({
        query: 'UserService',
        limit: 1,
      });

      assert.ok(queryResult.success);
      const queryData = queryResult.data as any;

      // Step 2: Impact analysis
      const impactResult = await mcpClient.impact({
        target: queryData.results[0].name,
        direction: 'upstream',
        maxDepth: 2,
      });

      assert.ok(impactResult.success);
      const impactData = impactResult.data as any;

      assert.ok(impactData.target, 'Should have target in impact');
      assert.strictEqual(impactData.target.name, queryData.results[0].name);
    });

    it('should use cypher to verify query results', async () => {
      // Step 1: Query
      const queryResult = await mcpClient.searchClasses('Service', 10);

      assert.ok(queryResult.success);
      const queryData = queryResult.data as any;

      if (queryData.results.length > 0) {
        // Step 2: Verify with Cypher
        const cypherResult = await mcpClient.cypher({
          query: `
            MATCH (c:Class)
            WHERE c.name CONTAINS "Service"
            RETURN count(c) as count
          `,
        });

        assert.ok(cypherResult.success);
        const cypherData = cypherResult.data as any;

        assert.ok(
          cypherData.results[0].count >= queryData.results.length,
          'Cypher count should be at least query results count',
        );
      }
    });

    it('should traverse query -> context -> cypher chain', async () => {
      // Step 1: Query for a method
      const queryResult = await mcpClient.query({
        query: 'createUser',
        limit: 1,
      });

      assert.ok(queryResult.success);
      const queryData = queryResult.data as any;
      assert.ok(queryData.results.length > 0);

      const method = queryData.results[0];

      // Step 2: Get context
      const contextResult = await mcpClient.context({
        symbol: method.name,
        include_calls: true,
      });

      assert.ok(contextResult.success);
      const contextData = contextResult.data as any;

      // Step 3: Use Cypher to verify relationships
      if (contextData.calls && contextData.calls.length > 0) {
        const calledMethod = contextData.calls[0];
        const cypherResult = await mcpClient.cypher({
          query: `
            MATCH (caller:Method {name: "${method.name}"})-[r:CALLS]->(called:Method {name: "${calledMethod.name}"})
            RETURN r
          `,
        });

        assert.ok(cypherResult.success);
      }
    });
  });
});
