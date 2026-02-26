/**
 * CLI Workflow Phase 1 E2E Tests
 *
 * Comprehensive tests for CLI commands:
 * 1. init - Initialize repository
 * 2. index - Index Java code
 * 3. query - Search knowledge graph
 * 4. Full workflow integration
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CLIPO } from '../page-objects/cli-po.js';
import { DatabasePO } from '../page-objects/database-po.js';
import { getFixture, FIXTURE_CATEGORIES } from '../fixtures/java-fixtures.js';

describe('CLI Workflow Phase 1 E2E Tests', () => {
  let cli: CLIPO;
  let db: DatabasePO;
  let testDir: string;
  let dbPath: string;

  before(async () => {
    // Setup test environment
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-cli-workflow-'));
    dbPath = path.join(os.tmpdir(), `java-kg-cli-db-${Date.now()}`);

    // Initialize page objects
    cli = new CLIPO('packages/cli/dist/index.js', dbPath);
    db = new DatabasePO(dbPath);
  });

  after(async () => {
    await db.close();

    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    try {
      await fs.rm(dbPath, { recursive: true, force: true });
    } catch {}
  });

  describe('Init Command', () => {
    it('should initialize a repository', async () => {
      const initDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-init-'));

      const result = await cli.init({
        repoPath: initDir,
        dbPath: dbPath,
      });

      assert.ok(result.success, 'Init should succeed');
      assert.ok(!cli.hasError(result.stdout, result.stderr), 'Should not have errors');

      // Verify config file was created
      const isInitialized = await cli.isInitialized(initDir);
      assert.ok(isInitialized, 'Repository should be initialized');

      // Cleanup
      await fs.rm(initDir, { recursive: true, force: true });
    });

    it('should detect Java project structure', async () => {
      const initDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-detect-'));

      // Create Maven-like structure
      const srcDir = path.join(initDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(
        path.join(srcDir, 'Main.java'),
        'package com.example;\npublic class Main {}',
      );

      const result = await cli.init({
        repoPath: initDir,
        dbPath: dbPath,
      });

      assert.ok(result.success, 'Init should detect project structure');

      await fs.rm(initDir, { recursive: true, force: true });
    });

    it('should handle existing config gracefully', async () => {
      const initDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-existing-'));

      // Create initial config
      await fs.mkdir(path.join(initDir, '.javakg'), { recursive: true });
      await fs.writeFile(
        path.join(initDir, '.javakg/config.json'),
        JSON.stringify({ repo: initDir }),
      );

      const result = await cli.init({
        repoPath: initDir,
        dbPath: dbPath,
      });

      assert.ok(result.success, 'Init should handle existing config');

      await fs.rm(initDir, { recursive: true, force: true });
    });

    it('should create config file with proper structure', async () => {
      const initDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-config-'));

      const result = await cli.init({
        repoPath: initDir,
        dbPath: dbPath,
      });

      assert.ok(result.success);

      // Read and verify config
      const configPath = path.join(initDir, '.javakg/config.json');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      assert.ok(config.repo, 'Config should have repo');
      assert.ok(config.dbPath, 'Config should have dbPath');
      assert.strictEqual(config.repo, initDir);

      await fs.rm(initDir, { recursive: true, force: true });
    });

    it('should fail with invalid repository path', async () => {
      const result = await cli.init({
        repoPath: '/nonexistent/path/xyz123',
        dbPath: dbPath,
      });

      assert.ok(!result.success, 'Should fail with invalid path');
      assert.ok(cli.hasError(result.stdout, result.stderr), 'Should have error');
    });
  });

  describe('Index Command', () => {
    let indexDir: string;

    beforeEach(async () => {
      indexDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-index-'));

      const srcDir = path.join(indexDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(path.join(srcDir, 'Service.java'), getFixture('serviceClass'));
    });

    afterEach(async () => {
      try {
        await fs.rm(indexDir, { recursive: true, force: true });
      } catch {}
    });

    it('should index a Java repository', async () => {
      const initResult = await cli.init({
        repoPath: indexDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success, 'Init should succeed');

      const indexResult = await cli.index({
        repoPath: indexDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success, 'Index should succeed');
      assert.ok(!cli.hasError(indexResult.stdout, indexResult.stderr), 'Should not have errors');

      // Verify database was created
      const dbExists = await cli.databaseExists(dbPath);
      assert.ok(dbExists, 'Database should be created');
    });

    it('should index multiple files', async () => {
      const srcDir = path.join(indexDir, 'src/main/java/com/example');

      await fs.writeFile(path.join(srcDir, 'Repository.java'), getFixture('interfaceDefinition'));
      await fs.writeFile(path.join(srcDir, 'Entity.java'), getFixture('inheritance'));

      await cli.init({ repoPath: indexDir, dbPath: dbPath });

      const indexResult = await cli.index({
        repoPath: indexDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      // Parse statistics
      const stats = cli.parseStatistics(indexResult.stdout);
      assert.ok(stats.filesIndexed, 'Should have files indexed count');
      assert.ok(stats.filesIndexed >= 3, 'Should index at least 3 files');
    });

    it('should handle empty directory gracefully', async () => {
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-empty-'));

      await cli.init({ repoPath: emptyDir, dbPath: dbPath });

      const indexResult = await cli.index({
        repoPath: emptyDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success, 'Should handle empty directory');

      await fs.rm(emptyDir, { recursive: true, force: true });
    });

    it('should show progress with verbose flag', async () => {
      await cli.init({ repoPath: indexDir, dbPath: dbPath });

      const indexResult = await cli.index({
        repoPath: indexDir,
        dbPath: dbPath,
        verbose: true,
      });

      assert.ok(indexResult.success);

      // Verbose output should contain more details
      assert.ok(indexResult.stdout.length > 0, 'Verbose output should have content');
    });

    it('should create database with proper structure', async () => {
      await cli.init({ repoPath: indexDir, dbPath: dbPath });

      await cli.index({ repoPath: indexDir, dbPath: dbPath });

      await db.initialize();

      const stats = await db.getStatistics();
      assert.ok(stats.classes > 0, 'Should have classes');
      assert.ok(stats.methods > 0, 'Should have methods');
      assert.ok(stats.fields > 0, 'Should have fields');
    });
  });

  describe('Query Command', () => {
    let queryDir: string;

    beforeEach(async () => {
      queryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-query-'));

      const srcDir = path.join(queryDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(path.join(srcDir, 'UserService.java'), getFixture('serviceClass'));

      await cli.init({ repoPath: queryDir, dbPath: dbPath });
      await cli.index({ repoPath: queryDir, dbPath: dbPath });
    });

    afterEach(async () => {
      try {
        await fs.rm(queryDir, { recursive: true, force: true });
      } catch {}
    });

    it('should query by class name', async () => {
      const result = await cli.query({
        searchTerm: 'UserService',
        dbPath: dbPath,
      });

      assert.ok(result.success, 'Query should succeed');

      const results = cli.parseQueryResults(result.stdout);
      assert.ok(results.length > 0, 'Should find results');

      const userService = results.find((r) => r.name === 'UserService');
      assert.ok(userService, 'Should find UserService');
    });

    it('should query by method name', async () => {
      const result = await cli.query({
        searchTerm: 'createUser',
        dbPath: dbPath,
      });

      assert.ok(result.success);

      const results = cli.parseQueryResults(result.stdout);
      assert.ok(results.length > 0);

      const createUser = results.find((r) => r.name === 'createUser');
      assert.ok(createUser, 'Should find createUser method');
      assert.strictEqual(createUser?.type, 'Method', 'Should be Method type');
    });

    it('should respect limit parameter', async () => {
      const limit = 2;
      const result = await cli.query({
        searchTerm: 'User',
        dbPath: dbPath,
        limit,
      });

      assert.ok(result.success);

      const results = cli.parseQueryResults(result.stdout);
      assert.ok(results.length <= limit, `Should return at most ${limit} results`);
    });

    it('should handle no results', async () => {
      const result = await cli.query({
        searchTerm: 'NonExistentClassXYZ123',
        dbPath: dbPath,
      });

      assert.ok(result.success, 'Query should succeed even with no results');

      const results = cli.parseQueryResults(result.stdout);
      assert.strictEqual(results.length, 0, 'Should have no results');
    });

    it('should filter by type parameter', async () => {
      const classResult = await cli.query({
        searchTerm: 'User',
        dbPath: dbPath,
        type: 'Class',
      });

      assert.ok(classResult.success);
      const classResults = cli.parseQueryResults(classResult.stdout);
      assert.ok(
        classResults.every((r) => r.type === 'Class'),
        'All results should be Class type',
      );
    });

    it('should return formatted results with metadata', async () => {
      const result = await cli.query({
        searchTerm: 'UserService',
        dbPath: dbPath,
      });

      assert.ok(result.success);

      const results = cli.parseQueryResults(result.stdout);
      if (results.length > 0) {
        const first = results[0];
        assert.ok(first.name, 'Should have name');
        assert.ok(first.type, 'Should have type');
        assert.ok(first.qualifiedName || first.file, 'Should have qualifiedName or file');
      }
    });
  });

  describe('Complete CLI Workflow', () => {
    it('should execute init -> index -> query workflow', async () => {
      const workflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-workflow-'));

      const srcDir = path.join(workflowDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });

      await fs.writeFile(
        path.join(srcDir, 'Calculator.java'),
        `
package com.example;

public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    public int subtract(int a, int b) {
        return a - b;
    }

    public int multiply(int a, int b) {
        return a * b;
    }
}
`,
      );

      // Step 1: Init
      const initResult = await cli.init({
        repoPath: workflowDir,
        dbPath: dbPath,
      });

      assert.ok(initResult.success, 'Init should succeed');
      assert.ok(await cli.isInitialized(workflowDir), 'Should be initialized');

      // Step 2: Index
      const indexResult = await cli.index({
        repoPath: workflowDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success, 'Index should succeed');

      const indexStats = cli.parseStatistics(indexResult.stdout);
      assert.ok(indexStats.filesIndexed, 'Should have files indexed');

      // Step 3: Query
      const queryResult = await cli.query({
        searchTerm: 'Calculator',
        dbPath: dbPath,
      });

      assert.ok(queryResult.success, 'Query should succeed');

      const queryResults = cli.parseQueryResults(queryResult.stdout);
      assert.ok(queryResults.length > 0, 'Should find results');

      const calculator = queryResults.find((r) => r.name === 'Calculator');
      assert.ok(calculator, 'Should find Calculator class');

      await fs.rm(workflowDir, { recursive: true, force: true });
    });

    it('should handle complex multi-package project', async () => {
      const workflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-multi-package-'));

      // Create multiple packages
      const packages = ['service', 'repository', 'controller', 'model'];

      for (const pkg of packages) {
        const pkgDir = path.join(workflowDir, `src/main/java/com/example/${pkg}`);
        await fs.mkdir(pkgDir, { recursive: true });

        // Create a simple class in each package
        const className = `${pkg.charAt(0).toUpperCase() + pkg.slice(1)}Service`;
        await fs.writeFile(
          path.join(pkgDir, `${className}.java`),
          `
package com.example.${pkg};

public class ${className} {
    public void execute() {
        System.out.println("${pkg}");
    }
}
`,
        );
      }

      await cli.init({ repoPath: workflowDir, dbPath: dbPath });

      const indexResult = await cli.index({
        repoPath: workflowDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      await db.initialize();
      const classes = await db.getAllClasses();

      assert.ok(classes.length >= packages.length, 'Should have classes from all packages');

      await fs.rm(workflowDir, { recursive: true, force: true });
    });

    it('should support incremental indexing', async () => {
      const workflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-incremental-'));

      const srcDir = path.join(workflowDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });

      // Initial files
      await fs.writeFile(
        path.join(srcDir, 'Class1.java'),
        `
package com.example;

public class Class1 {
    public void method1() {}
}
`,
      );

      await cli.init({ repoPath: workflowDir, dbPath: dbPath });

      let indexResult = await cli.index({
        repoPath: workflowDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      let stats = await db.getStatistics();
      const initialClassCount = stats.classes;

      // Add new file
      await fs.writeFile(
        path.join(srcDir, 'Class2.java'),
        `
package com.example;

public class Class2 {
    public void method2() {}
}
`,
      );

      // Re-index
      indexResult = await cli.index({
        repoPath: workflowDir,
        dbPath: dbPath,
      });

      assert.ok(indexResult.success);

      stats = await db.getStatistics();
      assert.ok(stats.classes > initialClassCount, 'Should have more classes after re-index');

      await fs.rm(workflowDir, { recursive: true, force: true });
    });
  });

  describe('Error Handling', () => {
    it('should show help', async () => {
      const result = await cli.help();

      assert.ok(result.success, 'Help should display');
      assert.ok(
        result.stdout.includes('init') ||
          result.stdout.includes('index') ||
          result.stdout.includes('query'),
        'Should show available commands',
      );
    });

    it('should show help for specific command', async () => {
      const result = await cli.help('query');

      assert.ok(result.success, 'Help should display');
      assert.ok(result.stdout.includes('query'), 'Should mention query command');
    });

    it('should show version', async () => {
      const result = await cli.version();

      assert.ok(result.success, 'Version should display');
      assert.ok(result.stdout.length > 0, 'Should have version output');
    });

    it('should handle missing command', async () => {
      const result = await cli.execute('invalid-command', []);

      assert.ok(!result.success, 'Should reject invalid command');
      assert.ok(cli.hasError(result.stdout, result.stderr), 'Should have error');
    });

    it('should handle invalid query parameters', async () => {
      const result = await cli.query({
        searchTerm: '', // Empty search term
        dbPath: dbPath,
      });

      assert.ok(!result.success, 'Should fail with empty search term');
      assert.ok(cli.hasError(result.stdout, result.stderr), 'Should have error');
    });

    it('should handle missing database', async () => {
      const result = await cli.query({
        searchTerm: 'Test',
        dbPath: '/nonexistent/path/to/db',
      });

      assert.ok(!result.success, 'Should fail with missing database');
      assert.ok(cli.hasError(result.stdout, result.stderr), 'Should have error');
    });
  });

  describe('Performance Tests', () => {
    it('should index 10 files within reasonable time', async () => {
      const perfDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-perf-'));

      const srcDir = path.join(perfDir, 'src/main/java/com/example');
      await fs.mkdir(srcDir, { recursive: true });

      // Create 10 files
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(
          path.join(srcDir, `Class${i}.java`),
          `
package com.example;

public class Class${i} {
    private String name;
    private int value;

    public void method1() {
        System.out.println("Method 1");
    }

    public void method2() {
        System.out.println("Method 2");
    }
}
`,
        );
      }

      await cli.init({ repoPath: perfDir, dbPath: dbPath });

      const indexStart = Date.now();
      const indexResult = await cli.index({
        repoPath: perfDir,
        dbPath: dbPath,
      });
      const indexDuration = Date.now() - indexStart;

      assert.ok(indexResult.success, 'Index should succeed');
      assert.ok(indexDuration < 30000, `Indexing should complete in <30s, took ${indexDuration}ms`);

      const queryStart = Date.now();
      const queryResult = await cli.query({
        searchTerm: 'Class',
        dbPath: dbPath,
        limit: 10,
      });
      const queryDuration = Date.now() - queryStart;

      assert.ok(queryResult.success, 'Query should succeed');
      assert.ok(queryDuration < 1000, `Query should complete in <1s, took ${queryDuration}ms`);

      await fs.rm(perfDir, { recursive: true, force: true });
    });
  });
});
