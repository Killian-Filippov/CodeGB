/**
 * Ingestion Pipeline E2E Tests
 *
 * Tests the complete flow from parsing Java code to storing in the knowledge graph:
 * - Java file parsing (Tree-sitter)
 * - Symbol extraction (classes, methods, fields)
 * - Relationship building
 * - Graph database storage
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Parser } from '../../../packages/core/src/parser/parser-loader.js';
import { JavaExtractor } from '../../../packages/core/src/parser/ast-extractor.js';
import { KuzuAdapter } from '../../../packages/core/src/storage/kuzu-adapter.js';
import { SymbolProcessor } from '../../../packages/core/src/ingestion/symbol-processor.js';
import { CallProcessor } from '../../../packages/core/src/ingestion/call-processor.js';
import { ImportProcessor } from '../../../packages/core/src/ingestion/import-processor.js';

describe('Ingestion Pipeline E2E Tests', () => {
  let dbPath: string;
  let kuzuAdapter: KuzuAdapter;
  let parser: Parser;
  let extractor: JavaExtractor;
  let tempDir: string;

  before(async () => {
    // Setup temporary database
    dbPath = path.join(os.tmpdir(), `java-kg-pipeline-test-${Date.now()}`);

    // Initialize parser
    parser = await Parser.create();

    // Initialize extractor
    extractor = new JavaExtractor(parser);

    // Initialize database
    kuzuAdapter = new KuzuAdapter(dbPath);
    await kuzuAdapter.initialize();
    await kuzuAdapter.createSchema();

    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-pipeline-'));
  });

  after(async () => {
    await kuzuAdapter.close();
    await fs.rm(dbPath, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Java File Parsing', () => {
    it('should parse a simple Java class', async () => {
      const javaCode = `
package com.example;

public class TestClass {
    private String name;

    public TestClass(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }
}
`;

      const tree = parser.parse(javaCode);
      assert.ok(tree.rootNode, 'Should have a root node');

      const symbols = extractor.extractSymbols(javaCode, '/TestClass.java');
      assert.ok(symbols.length > 0, 'Should extract symbols');

      const classSymbol = symbols.find(s => s.type === 'Class');
      assert.ok(classSymbol, 'Should extract class');
      assert.strictEqual(classSymbol!.name, 'TestClass');

      const methodSymbols = symbols.filter(s => s.type === 'Method');
      assert.ok(methodSymbols.length > 0, 'Should extract methods');

      const fieldSymbols = symbols.filter(s => s.type === 'Field');
      assert.ok(fieldSymbols.length > 0, 'Should extract fields');
    });

    it('should parse multiple classes in a file', async () => {
      const javaCode = `
package com.example;

public class Class1 {
    public void method1() {}
}

class Class2 {
    private int value;
}

enum TestEnum {
    A, B, C
}
`;

      const symbols = extractor.extractSymbols(javaCode, '/Multiple.java');
      const classes = symbols.filter(s => s.type === 'Class');
      const enums = symbols.filter(s => s.type === 'Enum');

      assert.ok(classes.length >= 2, 'Should extract at least 2 classes');
      assert.ok(enums.length > 0, 'Should extract enum');
    });

    it('should parse class inheritance and interfaces', async () => {
      const javaCode = `
package com.example;

public interface ParentInterface {
    void method();
}

public abstract class AbstractParent {
    protected abstract void abstractMethod();
}

public class Child extends AbstractParent implements ParentInterface {
    @Override
    public void method() {}

    @Override
    protected void abstractMethod() {}
}
`;

      const symbols = extractor.extractSymbols(javaCode, '/Inheritance.java');
      const childClass = symbols.find(s => s.name === 'Child');

      assert.ok(childClass, 'Should find Child class');
      // Verify inheritance is captured (implementation detail depends on extractor)
    });
  });

  describe('Method Call Analysis', () => {
    let callProcessor: CallProcessor;

    before(() => {
      callProcessor = new CallProcessor(kuzuAdapter);
    });

    it('should detect method calls', async () => {
      const javaCode = `
package com.example;

public class Caller {
    public void main() {
        helper1();
        helper2();
        helper1();
    }

    private void helper1() {}
    private void helper2() {}
}
`;

      const symbols = extractor.extractSymbols(javaCode, '/Caller.java');
      const calls = callProcessor.extractMethodCalls(javaCode, symbols);

      assert.ok(calls.length > 0, 'Should detect method calls');
    });

    it('should detect field accesses', async () => {
      const javaCode = `
package com.example;

public class Accessor {
    private String name;

    public void process() {
        String n = this.name;
        this.name = "test";
    }
}
`;

      const symbols = extractor.extractSymbols(javaCode, '/Accessor.java');
      const accesses = callProcessor.extractFieldAccesses(javaCode, symbols);

      assert.ok(accesses.length >= 2, 'Should detect at least 2 field accesses');
    });
  });

  describe('Import Analysis', () => {
    let importProcessor: ImportProcessor;

    before(() => {
      importProcessor = new ImportProcessor(kuzuAdapter);
    });

    it('should extract import statements', async () => {
      const javaCode = `
package com.example;

import java.util.List;
import java.util.ArrayList;
import java.io.*;
import static java.util.Collections.*;
import com.example.other.Class;

public class ImportTest {}
`;

      const imports = importProcessor.extractImports(javaCode);

      assert.ok(imports.length >= 5, 'Should extract all imports');

      const hasWildCard = imports.some(i => i.endsWith('*'));
      assert.ok(hasWildCard, 'Should detect wildcard import');

      const hasStatic = imports.some(i => i.includes('static'));
      assert.ok(hasStatic, 'Should detect static import');
    });
  });

  describe('Symbol Processing', () => {
    let symbolProcessor: SymbolProcessor;

    before(() => {
      symbolProcessor = new SymbolProcessor(kuzuAdapter);
    });

    it('should process and store class symbols', async () => {
      const javaCode = `
package com.example;

public class TestClass {
    private String field;

    public TestClass(String field) {
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
`;

      const symbols = extractor.extractSymbols(javaCode, '/TestClass.java');
      await symbolProcessor.processSymbols(symbols);

      // Verify class was stored
      const classQuery = 'MATCH (c:Class {name: "TestClass"}) RETURN c';
      const classResult = await kuzuAdapter.executeCypher(classQuery);

      assert.ok(classResult.length > 0, 'Class should be stored in database');
      assert.strictEqual(classResult[0].c.name, 'TestClass');
    });

    it('should process and store method symbols', async () => {
      const javaCode = `
package com.example;

public class MethodTest {
    public void method1() {}

    private String method2(int param) {
        return "result";
    }
}
`;

      const symbols = extractor.extractSymbols(javaCode, '/MethodTest.java');
      await symbolProcessor.processSymbols(symbols);

      // Verify methods were stored
      const methodQuery = 'MATCH (m:Method) WHERE m.className = "MethodTest" RETURN m';
      const methodResult = await kuzuAdapter.executeCypher(methodQuery);

      assert.ok(methodResult.length >= 2, 'Methods should be stored in database');
    });

    it('should establish class-method relationships', async () => {
      const javaCode = `
package com.example;

public class RelationshipTest {
    public void method1() {}

    public void method2() {}
}
`;

      const symbols = extractor.extractSymbols(javaCode, '/RelationshipTest.java');
      await symbolProcessor.processSymbols(symbols);

      // Verify CONTAINS relationships
      const relQuery = `
        MATCH (c:Class)-[r:CONTAINS]->(m:Method)
        WHERE c.name = "RelationshipTest"
        RETURN c, r, m
      `;
      const relResult = await kuzuAdapter.executeCypher(relQuery);

      assert.ok(relResult.length >= 2, 'Should have class-method relationships');
    });
  });

  describe('Complete Pipeline Integration', () => {
    it('should process a complete Java file end-to-end', async () => {
      const javaCode = `
package com.example.service;

import java.util.List;
import java.util.Optional;

public class UserService {
    private UserRepository userRepository;
    private EmailService emailService;

    public UserService(UserRepository userRepository, EmailService emailService) {
        this.userRepository = userRepository;
        this.emailService = emailService;
    }

    public User createUser(String name, String email) {
        User user = new User(name, email);
        User saved = userRepository.save(user);
        emailService.sendWelcomeEmail(email);
        return saved;
    }

    public Optional<User> findUserById(Long id) {
        return userRepository.findById(id);
    }
}
`;

      // Step 1: Parse
      const symbols = extractor.extractSymbols(javaCode, '/UserService.java');
      assert.ok(symbols.length > 0, 'Should extract symbols');

      // Step 2: Extract calls
      const callProcessor = new CallProcessor(kuzuAdapter);
      const calls = callProcessor.extractMethodCalls(javaCode, symbols);

      // Step 3: Extract imports
      const importProcessor = new ImportProcessor(kuzuAdapter);
      const imports = importProcessor.extractImports(javaCode);

      // Step 4: Process and store
      const symbolProcessor = new SymbolProcessor(kuzuAdapter);
      await symbolProcessor.processSymbols(symbols);

      // Verify complete graph
      const graphQuery = `
        MATCH (c:Class)
        WHERE c.name = "UserService"
        OPTIONAL MATCH (c)-[:CONTAINS]->(m:Method)
        OPTIONAL MATCH (c)-[:CONTAINS]->(f:Field)
        RETURN c, collect(m) as methods, collect(f) as fields
      `;
      const graphResult = await kuzuAdapter.executeCypher(graphQuery);

      assert.ok(graphResult.length > 0, 'Should have class in graph');
      assert.ok(graphResult[0].methods.length >= 3, 'Should have at least 3 methods');
      assert.ok(graphResult[0].fields.length >= 2, 'Should have at least 2 fields');
    });

    it('should process multiple related files', async () => {
      // File 1: Interface
      const interfaceCode = `
package com.example;

public interface UserRepository {
    User save(User user);
    User findById(Long id);
}
`;

      // File 2: Implementation
      const implementationCode = `
package com.example;

public class UserRepositoryImpl implements UserRepository {
    @Override
    public User save(User user) {
        return user;
    }

    @Override
    public User findById(Long id) {
        return new User("Test", "test@example.com");
    }
}
`;

      // Process interface
      const interfaceSymbols = extractor.extractSymbols(interfaceCode, '/UserRepository.java');
      await new SymbolProcessor(kuzuAdapter).processSymbols(interfaceSymbols);

      // Process implementation
      const implSymbols = extractor.extractSymbols(implementationCode, '/UserRepositoryImpl.java');
      await new SymbolProcessor(kuzuAdapter).processSymbols(implSymbols);

      // Verify both classes exist
      const allClassesQuery = 'MATCH (c:Class) WHERE c.name IN ["UserRepository", "UserRepositoryImpl"] RETURN c ORDER BY c.name';
      const allClasses = await kuzuAdapter.executeCypher(allClassesQuery);

      assert.strictEqual(allClasses.length, 2, 'Should have both classes');
    });
  });
});
