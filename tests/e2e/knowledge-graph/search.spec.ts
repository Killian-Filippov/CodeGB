import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runPipelineFromRepo } from '../../../packages/core/src/ingestion/pipeline.ts';
import { buildSymbolContext } from '../../../packages/core/src/search/context-builder.ts';
import { searchByKeyword } from '../../../packages/core/src/search/keyword-search.ts';
import { KuzuAdapter } from '../../../packages/core/src/storage/kuzu-adapter.ts';
import type { KnowledgeGraph } from '../../../packages/core/src/types/graph.ts';

describe('knowledge graph search e2e', () => {
  let repoPath: string;
  let storagePath: string;
  let graph: KnowledgeGraph;
  let adapter: KuzuAdapter;

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'codegb-search-repo-'));
    storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'codegb-search-db-'));

    const root = path.join(repoPath, 'src', 'main', 'java', 'com', 'example');
    await fs.mkdir(root, { recursive: true });

    await fs.writeFile(path.join(root, 'User.java'), `
package com.example;

public class User {
  private Long id;
  private String email;

  public User(String email) {
    this.email = email;
  }
}
`);

    await fs.writeFile(path.join(root, 'UserRepository.java'), `
package com.example;

public interface UserRepository {
  User save(User user);
  User findById(Long id);
}
`);

    await fs.writeFile(path.join(root, 'EmailService.java'), `
package com.example;

public class EmailService {
  public void sendWelcomeEmail(String email) {}
}
`);

    await fs.writeFile(path.join(root, 'ProductService.java'), `
package com.example;

public class ProductService {
  public void createProduct(String name) {}
}
`);

    await fs.writeFile(path.join(root, 'UserService.java'), `
package com.example;

public class UserService {
  private UserRepository userRepository;
  private EmailService emailService;

  public UserService(UserRepository userRepository, EmailService emailService) {
    this.userRepository = userRepository;
    this.emailService = emailService;
  }

  public User createUser(String email) {
    User user = new User(email);
    User saved = userRepository.save(user);
    emailService.sendWelcomeEmail(email);
    return saved;
  }

  public User findUserById(Long id) {
    return userRepository.findById(id);
  }
}
`);

    await runPipelineFromRepo({
      repoPath,
      storagePath,
      projectName: 'search-e2e',
    });

    adapter = new KuzuAdapter(storagePath);
    await adapter.init();
    graph = await adapter.loadGraph();
  });

  afterEach(async () => {
    await adapter?.close();
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.rm(storagePath, { recursive: true, force: true });
  });

  it('searches persisted symbols with the current keyword search API', async () => {
    const classResults = searchByKeyword(graph, 'UserService', 10);
    const classHit = classResults.find((entry) => entry.node.label === 'Class');
    assert.equal(classHit?.node.properties.name, 'UserService');

    const methodResults = searchByKeyword(graph, 'create user', 10);
    const methodHit = methodResults.find((entry) => entry.node.label === 'Method');
    assert.equal(methodHit?.node.properties.name, 'createUser');

    const serviceResults = searchByKeyword(graph, 'Service', 10);
    const serviceNames = serviceResults
      .filter((entry) => entry.node.label === 'Class')
      .map((entry) => entry.node.properties.name);
    assert.ok(serviceNames.includes('UserService'));
    assert.ok(serviceNames.includes('EmailService'));
    assert.ok(serviceNames.includes('ProductService'));
  });

  it('builds symbol context from the persisted graph with outgoing relationships', async () => {
    const context = buildSymbolContext(graph, 'com.example.UserService');

    assert.equal(context.symbol?.name, 'UserService');
    assert.deepEqual(context.candidates, []);

    const outgoingTypes = new Set(context.outgoing.map((edge) => edge.type));
    assert.ok(outgoingTypes.has('CONTAINS'));

    const outgoingTargets = context.outgoing.map((edge) => edge.to);
    assert.ok(outgoingTargets.includes('createUser'));
    assert.ok(outgoingTargets.includes('findUserById'));
  });

  it('loads the persisted graph back through the storage adapter after indexing', async () => {
    const loadedGraph = await adapter.loadGraph();

    const createUserNode = loadedGraph.nodes.find(
      (node) => node.label === 'Method' && node.properties.name === 'createUser',
    );
    assert.ok(createUserNode);

    const targetNames = loadedGraph.relationships
      .filter(
        (rel) => rel.type === 'CALLS' && rel.sourceId === createUserNode?.id,
      )
      .map((rel) => loadedGraph.getNode(rel.targetId)?.properties.name)
      .filter((value): value is string => Boolean(value))
      .sort();
    assert.deepEqual(targetNames, ['User', 'save', 'sendWelcomeEmail']);
  });
});
