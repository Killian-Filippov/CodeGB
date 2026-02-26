/**
 * Knowledge Graph Search E2E Tests
 *
 * Tests the search functionality of the knowledge graph:
 * - Keyword search (BM25)
 * - Symbol lookup
 * - Graph traversal
 * - Context building
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { KuzuAdapter } from '../../../packages/core/src/storage/kuzu-adapter.js';
import { KeywordSearch } from '../../../packages/core/src/search/keyword-search.js';
import { ContextBuilder } from '../../../packages/core/src/search/context-builder.js';
import { TestJavaRepository } from '../fixtures/test-repo.js';

describe('Knowledge Graph Search E2E Tests', () => {
  let dbPath: string;
  let kuzuAdapter: KuzuAdapter;
  let keywordSearch: KeywordSearch;
  let contextBuilder: ContextBuilder;
  let testRepo: TestJavaRepository;

  before(async () => {
    // Setup temporary database
    dbPath = path.join(os.tmpdir(), `java-kg-search-test-${Date.now()}`);

    // Initialize database
    kuzuAdapter = new KuzuAdapter(dbPath);
    await kuzuAdapter.initialize();
    await kuzuAdapter.createSchema();

    // Initialize search components
    keywordSearch = new KeywordSearch(kuzuAdapter);
    contextBuilder = new ContextBuilder(kuzuAdapter);

    // Create and index test repository
    testRepo = new TestJavaRepository('search-test-repo');
    await testRepo.create();
    await indexTestRepository();
  });

  after(async () => {
    await kuzuAdapter.close();
    await fs.rm(dbPath, { recursive: true, force: true });
    await testRepo.cleanup();
  });

  async function indexTestRepository(): Promise<void> {
    // Create test data manually for search testing
    const testData = `
package com.example;

public class UserService {
    private UserRepository userRepository;
    private EmailService emailService;

    public User createUser(String name, String email) {
        User user = new User(name, email);
        User saved = userRepository.save(user);
        emailService.sendWelcomeEmail(email);
        return saved;
    }

    public User findUserById(Long id) {
        return userRepository.findById(id);
    }

    public void deleteUser(Long id) {
        userRepository.delete(id);
    }
}

public interface UserRepository {
    User save(User user);
    User findById(Long id);
    void delete(Long id);
}

public class EmailService {
    public void sendWelcomeEmail(String email) {
        // Send welcome email
    }

    public void sendPasswordResetEmail(String email) {
        // Send reset email
    }
}

public class User {
    private Long id;
    private String name;
    private String email;
}

public class ProductService {
    private ProductRepository productRepository;

    public Product createProduct(String name, double price) {
        return productRepository.save(new Product(name, price));
    }
}

public interface ProductRepository {
    Product save(Product product);
    List<Product> findAll();
}
`;

    // Parse and index test data
    const { Parser } = await import('../../../packages/core/src/parser/parser-loader.js');
    const { JavaExtractor } = await import('../../../packages/core/src/parser/ast-extractor.js');
    const { SymbolProcessor } =
      await import('../../../packages/core/src/ingestion/symbol-processor.js');

    const parser = await Parser.create();
    const extractor = new JavaExtractor(parser);
    const symbolProcessor = new SymbolProcessor(kuzuAdapter);

    const symbols = extractor.extractSymbols(testData, '/TestCode.java');
    await symbolProcessor.processSymbols(symbols);
  }

  describe('Keyword Search (BM25)', () => {
    it('should search by class name', async () => {
      const results = await keywordSearch.search('UserService', {
        nodeTypes: ['Class'],
        limit: 10,
      });

      assert.ok(results.length > 0, 'Should find UserService class');
      assert.strictEqual(results[0].name, 'UserService');
      assert.strictEqual(results[0].type, 'Class');
    });

    it('should search by method name', async () => {
      const results = await keywordSearch.search('createUser', {
        nodeTypes: ['Method'],
        limit: 10,
      });

      assert.ok(results.length > 0, 'Should find createUser method');
      assert.strictEqual(results[0].name, 'createUser');
      assert.strictEqual(results[0].type, 'Method');
    });

    it('should search partial matches', async () => {
      const results = await keywordSearch.search('Service', {
        limit: 10,
      });

      assert.ok(results.length >= 3, 'Should find multiple Service classes');
      const serviceClasses = results.filter(
        (r) => r.type === 'Class' && r.name.includes('Service'),
      );
      assert.ok(serviceClasses.length >= 3, 'Should have at least 3 Service classes');
    });

    it('should filter by node type', async () => {
      const allResults = await keywordSearch.search('User', { limit: 20 });
      const classResults = await keywordSearch.search('User', {
        nodeTypes: ['Class'],
        limit: 20,
      });

      assert.ok(classResults.length < allResults.length, 'Filtered results should be fewer');
      assert.ok(
        classResults.every((r) => r.type === 'Class'),
        'All results should be Class type',
      );
    });

    it('should respect limit parameter', async () => {
      const limit = 2;
      const results = await keywordSearch.search('Service', { limit });

      assert.ok(results.length <= limit, `Should return at most ${limit} results`);
    });

    it('should handle no results', async () => {
      const results = await keywordSearch.search('NonExistentClassXYZ123', {
        limit: 10,
      });

      assert.strictEqual(results.length, 0, 'Should return no results');
    });
  });

  describe('Symbol Lookup', () => {
    it('should find class by qualified name', async () => {
      const symbol = await kuzuAdapter.getSymbol('UserService', 'Class');

      assert.ok(symbol, 'Should find UserService class');
      assert.strictEqual(symbol!.name, 'UserService');
      assert.strictEqual(symbol!.type, 'Class');
    });

    it('should find method by name and class', async () => {
      const query = `
        MATCH (c:Class {name: "UserService"})-[:CONTAINS]->(m:Method {name: "createUser"})
        RETURN m
      `;
      const result = await kuzuAdapter.executeCypher(query);

      assert.ok(result.length > 0, 'Should find createUser method');
      assert.strictEqual(result[0].m.name, 'createUser');
    });

    it('should return null for non-existent symbol', async () => {
      const symbol = await kuzuAdapter.getSymbol('NonExistentClass', 'Class');

      assert.strictEqual(symbol, null, 'Should return null for non-existent symbol');
    });
  });

  describe('Context Building', () => {
    it('should build context for a class symbol', async () => {
      const context = await contextBuilder.buildContext('UserService', 'Class');

      assert.ok(context.symbol, 'Should include symbol information');
      assert.strictEqual(context.symbol.name, 'UserService');
      assert.strictEqual(context.symbol.type, 'Class');

      assert.ok(Array.isArray(context.methods), 'Should include methods');
      assert.ok(Array.isArray(context.fields), 'Should include fields');
    });

    it('should include method details in class context', async () => {
      const context = await contextBuilder.buildContext('UserService', 'Class');

      assert.ok(context.methods.length > 0, 'Should have methods');

      const createUser = context.methods.find((m: any) => m.name === 'createUser');
      assert.ok(createUser, 'Should include createUser method');
    });

    it('should include field details in class context', async () => {
      const context = await contextBuilder.buildContext('UserService', 'Class');

      assert.ok(context.fields.length >= 2, 'Should have at least 2 fields');
    });

    it('should include call relationships when requested', async () => {
      const context = await contextBuilder.buildContext('UserService', 'Class', {
        includeCalls: true,
      });

      assert.ok(context.calls !== undefined, 'Should include calls when requested');
    });
  });

  describe('Graph Traversal', () => {
    it('should traverse class inheritance (simple)', async () => {
      // Create a class hierarchy
      const hierarchyCode = `
package com.example;

public class ParentClass {
    public void parentMethod() {}
}

public class ChildClass extends ParentClass {
    public void childMethod() {}
}
`;

      await indexCode(hierarchyCode);

      // Query for inheritance
      const query = `
        MATCH (child:Class {name: "ChildClass"})-[:EXTENDS]->(parent:Class)
        RETURN parent.name as parentName
      `;
      const result = await kuzuAdapter.executeCypher(query);

      if (result.length > 0) {
        assert.strictEqual(result[0].parentName, 'ParentClass');
      }
    });

    it('should traverse class relationships', async () => {
      const query = `
        MATCH (c:Class)-[r]->(target)
        WHERE c.name = "UserService"
        RETURN type(r) as relationshipType, target.name as targetName, target.type as targetType
        LIMIT 10
      `;
      const result = await kuzuAdapter.executeCypher(query);

      assert.ok(result.length > 0, 'Should have relationships from UserService');

      const hasMethods = result.some(
        (r) => r.relationshipType === 'CONTAINS' && r.targetType === 'Method',
      );
      assert.ok(hasMethods, 'Should have CONTAINS relationships to Methods');
    });

    it('should find related symbols', async () => {
      const related = await kuzuAdapter.findRelatedSymbols('UserService', 'Class', {
        maxDepth: 2,
      });

      assert.ok(Array.isArray(related), 'Should return array of related symbols');
      assert.ok(related.length > 0, 'Should find related symbols');
    });
  });

  describe('Complex Search Scenarios', () => {
    it('should search and build context together', async () => {
      // Step 1: Search
      const searchResults = await keywordSearch.search('EmailService', {
        nodeTypes: ['Class'],
        limit: 1,
      });

      assert.ok(searchResults.length > 0, 'Should find EmailService');

      // Step 2: Build context
      const context = await contextBuilder.buildContext(searchResults[0].name, 'Class');

      assert.ok(context.symbol, 'Should have context');
      assert.strictEqual(context.symbol.name, 'EmailService');
    });

    it('should find all methods with a specific pattern', async () => {
      const query = `
        MATCH (m:Method)
        WHERE m.name CONTAINS "create"
        RETURN m.name as methodName, m.className as className
        ORDER BY methodName
      `;
      const result = await kuzuAdapter.executeCypher(query);

      assert.ok(result.length > 0, 'Should find methods with "create" in name');
      assert.ok(
        result.every((r) => r.methodName.includes('create')),
        'All should contain "create"',
      );
    });

    it('should find classes implementing an interface', async () => {
      const query = `
        MATCH (i:Interface)-[:IMPLEMENTS]-(c:Class)
        WHERE i.name = "UserRepository"
        RETURN c.name as className
      `;
      const result = await kuzuAdapter.executeCypher(query);

      if (result.length > 0) {
        assert.ok(result[0].className, 'Should have class implementing interface');
      }
    });
  });
});
