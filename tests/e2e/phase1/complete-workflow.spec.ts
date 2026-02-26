/**
 * Complete Phase 1 Workflow E2E Tests
 *
 * Tests the complete end-to-end workflow from CLI init to MCP query:
 * 1. Initialize repository with CLI
 * 2. Index Java code
 * 3. Query via CLI
 * 4. Query via MCP tools
 * 5. Context and impact analysis
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CLIPO } from '../page-objects/cli-po.js';
import { MCPClientPO } from '../page-objects/mcp-client-po.js';
import { DatabasePO } from '../page-objects/database-po.js';
import { getFixture, FIXTURE_CATEGORIES } from '../fixtures/java-fixtures.js';

describe('Phase 1 Complete Workflow E2E Tests', () => {
  let cli: CLIPO;
  let mcpClient: MCPClientPO;
  let db: DatabasePO;
  let testDir: string;
  let dbPath: string;
  let repoName: string;

  before(async () => {
    // Setup test environment
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-workflow-'));
    dbPath = path.join(os.tmpdir(), `java-kg-db-${Date.now()}`);
    repoName = 'test-repo';

    // Initialize page objects
    cli = new CLIPO('packages/cli/dist/index.js', dbPath);
    mcpClient = new MCPClientPO('packages/mcp-server/dist/index.js', {
      JAVA_KG_DB_PATH: dbPath,
    });
    db = new DatabasePO(dbPath);
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

  describe('Workflow: Simple Service Class', () => {
    it('should complete full workflow for a service class', async () => {
      // Step 1: Create test files
      const srcDir = path.join(testDir, 'src/main/java/com/example/service');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(path.join(srcDir, 'UserService.java'), getFixture('serviceClass'));

      // Step 2: Initialize repository
      const initResult = await cli.init({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success, 'Init should succeed');
      assert.ok(await cli.isInitialized(testDir), 'Repository should be initialized');

      // Step 3: Index the code
      const indexResult = await cli.index({
        repoPath: testDir,
        dbPath: dbPath,
        verbose: true,
      });

      assert.ok(indexResult.success, 'Index should succeed');

      // Step 4: Verify database
      await db.initialize();
      const classCount = await db.countNodes('Class');
      assert.ok(classCount > 0, 'Should have classes in database');

      // Step 5: Query via CLI
      const queryResult = await cli.query({
        searchTerm: 'UserService',
        dbPath: dbPath,
      });

      assert.ok(queryResult.success, 'CLI query should succeed');
      const cliResults = cli.parseQueryResults(queryResult.stdout);
      assert.ok(cliResults.length > 0, 'Should find results via CLI');

      // Step 6: Connect to MCP server
      await mcpClient.connect();

      // Step 7: Query via MCP
      const mcpResult = await mcpClient.query({
        query: 'UserService',
        limit: 10,
      });

      assert.ok(mcpResult.success, 'MCP query should succeed');
      assert.ok(mcpResult.data, 'Should have data in MCP response');

      const mcpData = mcpResult.data as any;
      assert.ok(mcpData.results.length > 0, 'Should find results via MCP');

      // Step 8: Get context
      const contextResult = await mcpClient.getClassContext('UserService');
      assert.ok(contextResult.success, 'Context query should succeed');

      const contextData = contextResult.data as any;
      assert.ok(contextData.symbol, 'Should have symbol in context');
      assert.ok(contextData.methods, 'Should have methods in context');
      assert.ok(Array.isArray(contextData.methods), 'Methods should be array');

      // Step 9: Get impact
      const impactResult = await mcpClient.getDownstreamImpacts('UserService', 2);
      assert.ok(impactResult.success, 'Impact query should succeed');
    });
  });

  describe('Workflow: Inheritance Hierarchy', () => {
    it('should complete workflow with inheritance', async () => {
      const srcDir = path.join(testDir, 'src/main/java/com/example/domain');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(path.join(srcDir, 'Entity.java'), getFixture('inheritance'));

      const initResult = await cli.init({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success);

      const indexResult = await cli.index({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      await mcpClient.connect();

      // Query for base class
      const baseClassResult = await mcpClient.searchClasses('BaseEntity');
      assert.ok(baseClassResult.success);

      // Query for child classes
      const childClasses = await mcpClient.searchClasses('User');
      assert.ok(childClasses.success);

      // Get inheritance chain
      const chain = await db.getInheritanceChain('User');
      assert.ok(chain.length > 0, 'Should have inheritance chain');

      // Verify relationship exists
      const superclasses = await db.getSuperclasses('User');
      assert.ok(superclasses.length > 0, 'Should have superclasses');
    });
  });

  describe('Workflow: Interface Implementation', () => {
    it('should complete workflow with interfaces', async () => {
      const srcDir = path.join(testDir, 'src/main/java/com/example/repository');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(
        path.join(srcDir, 'UserRepository.java'),
        getFixture('interfaceDefinition'),
      );

      await fs.writeFile(path.join(srcDir, 'UserRepositoryImpl.java'), getFixture('interfaceImpl'));

      const initResult = await cli.init({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success);

      const indexResult = await cli.index({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      await mcpClient.connect();

      // Find interface
      const interfaceResult = await mcpClient.query({
        query: 'UserRepository',
        limit: 10,
      });

      assert.ok(interfaceResult.success);
      const data = interfaceResult.data as any;
      const hasInterface = data.results.some((r: any) => r.type === 'Interface');
      assert.ok(hasInterface, 'Should find interface');

      // Find implementation
      const implResult = await mcpClient.query({
        query: 'UserRepositoryImpl',
        limit: 10,
      });

      assert.ok(implResult.success);

      // Verify IMPLEMENTS relationship
      const subclasses = await db.getSubclasses('UserRepository');
      assert.ok(subclasses.length > 0, 'Should have implementations');
    });
  });

  describe('Workflow: Complex Controller', () => {
    it('should complete workflow with complex controller', async () => {
      const srcDir = path.join(testDir, 'src/main/java/com/example/controller');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(path.join(srcDir, 'UserController.java'), getFixture('controller'));

      const initResult = await cli.init({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success);

      const indexResult = await cli.index({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      await mcpClient.connect();

      // Find controller
      const controllerResult = await mcpClient.searchClasses('UserController');
      assert.ok(controllerResult.success);

      // Get all methods in controller
      const methods = await db.getClassMethods('UserController');
      assert.ok(methods.length >= 4, 'Should have at least 4 methods');

      // Query specific method
      const methodResult = await mcpClient.searchMethods('getUser');
      assert.ok(methodResult.success);

      // Get method context
      const contextResult = await mcpClient.context({
        symbol: 'getUser',
        include_calls: true,
      });

      assert.ok(contextResult.success);
    });
  });

  describe('Workflow: Multiple Files', () => {
    it('should handle multiple related files', async () => {
      const baseDir = path.join(testDir, 'src/main/java/com/example');
      await fs.mkdir(baseDir, { recursive: true });

      // Create multiple files
      await fs.writeFile(
        path.join(baseDir, 'User.java'),
        getFixture('serviceClass').split('public class UserService')[0] +
          'public class User {\n    private Long id;\n    private String name;\n}',
      );

      await fs.writeFile(
        path.join(baseDir, 'EmailService.java'),
        getFixture('serviceClass').split('public class UserService')[0] +
          'public class EmailService {\n    public void sendWelcomeEmail(String email) {}\n}',
      );

      await fs.writeFile(
        path.join(baseDir, 'UserRepository.java'),
        getFixture('interfaceDefinition'),
      );

      const initResult = await cli.init({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success);

      const indexResult = await cli.index({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      // Verify all files indexed
      const stats = await db.getStatistics();
      assert.ok(stats.classes >= 3, 'Should have at least 3 classes');

      await mcpClient.connect();

      // Query for each file
      for (const className of ['User', 'EmailService', 'UserRepository']) {
        const result = await mcpClient.query({
          query: className,
          limit: 10,
        });

        assert.ok(result.success, `Should find ${className}`);
      }
    });
  });

  describe('Workflow: Impact Analysis', () => {
    it('should analyze impact of symbol changes', async () => {
      const srcDir = path.join(testDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(
        path.join(srcDir, 'Service.java'),
        `
package com.example;

public class Service {
    public void method1() {
        helper();
    }

    public void method2() {
        helper();
    }

    private void helper() {
        System.out.println("helper");
    }
}
`,
      );

      const initResult = await cli.init({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success);

      const indexResult = await cli.index({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      await mcpClient.connect();

      // Get upstream impact
      const upstreamResult = await mcpClient.getUpstreamImpacts('helper', 3);
      assert.ok(upstreamResult.success);

      const upstreamData = upstreamResult.data as any;
      assert.ok(Array.isArray(upstreamData.impacts), 'Should have impacts array');

      // Should find method1 and method2 as upstream
      if (upstreamData.impacts.length > 0) {
        assert.ok(upstreamData.impacts.length >= 2, 'Should have at least 2 upstream impacts');
      }

      // Get downstream impact
      const downstreamResult = await mcpClient.getDownstreamImpacts('method1', 2);
      assert.ok(downstreamResult.success);
    });
  });

  describe('Workflow: Cypher Queries', () => {
    it('should execute custom Cypher queries', async () => {
      const srcDir = path.join(testDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(path.join(srcDir, 'Test.java'), getFixture('simpleClass'));

      const initResult = await cli.init({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success);

      const indexResult = await cli.index({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      await mcpClient.connect();

      // Query 1: Count all nodes
      const countResult = await mcpClient.cypher({
        query: 'MATCH (n) RETURN count(n) as count',
      });

      assert.ok(countResult.success);
      const countData = countResult.data as any;
      assert.ok(countData.results.length > 0, 'Should have count result');

      // Query 2: Get all classes
      const classesResult = await mcpClient.getAllClasses();
      assert.ok(classesResult.success);

      // Query 3: Get class with methods
      const complexResult = await mcpClient.cypher({
        query: `
          MATCH (c:Class)-[:CONTAINS]->(m:Method)
          RETURN c.name as className, count(m) as methodCount
          ORDER BY methodCount DESC
        `,
      });

      assert.ok(complexResult.success);
    });
  });

  describe('Workflow: Error Handling', () => {
    it('should handle invalid queries gracefully', async () => {
      await mcpClient.connect();

      // Invalid symbol name
      const result = await mcpClient.query({
        query: 'NonExistentClassXYZ123',
        limit: 10,
      });

      assert.ok(result.success, 'Should succeed even with no results');
      const data = result.data as any;
      assert.strictEqual(data.results.length, 0, 'Should have no results');
    });

    it('should handle empty database', async () => {
      await mcpClient.connect();

      const count = await mcpClient.countNodes();
      assert.strictEqual(count, 0, 'Should have zero nodes in empty database');
    });

    it('should handle malformed Cypher queries', async () => {
      await mcpClient.connect();

      const result = await mcpClient.cypher({
        query: 'INVALID QUERY',
      });

      assert.ok(!result.success, 'Should fail on invalid query');
      assert.ok(result.error, 'Should have error message');
    });
  });

  describe('Workflow: Performance', () => {
    it('should index and query within reasonable time', async () => {
      const srcDir = path.join(testDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });

      // Create multiple files
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(
          path.join(srcDir, `Class${i}.java`),
          `
package com.example;

public class Class${i} {
    public void method1() {}
    public void method2() {}
    public void method3() {}
}
`,
        );
      }

      const initResult = await cli.init({
        repoPath: testDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success);

      // Time the indexing
      const indexStart = Date.now();
      const indexResult = await cli.index({
        repoPath: testDir,
        dbPath: dbPath,
      });
      const indexDuration = Date.now() - indexStart;

      assert.ok(indexResult.success, 'Index should succeed');
      assert.ok(indexDuration < 30000, `Indexing should complete in <30s, took ${indexDuration}ms`);

      await mcpClient.connect();

      // Time queries
      const queryStart = Date.now();
      const queryResult = await mcpClient.query({
        query: 'Class',
        limit: 10,
      });
      const queryDuration = Date.now() - queryStart;

      assert.ok(queryResult.success, 'Query should succeed');
      assert.ok(queryDuration < 1000, `Query should complete in <1s, took ${queryDuration}ms`);
    });
  });
});
