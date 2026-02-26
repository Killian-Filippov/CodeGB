import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runPipelineFromRepo } from '../src/ingestion/pipeline.ts';
import { createJavaMCPServer } from '../src/mcp/server.ts';

async function makeRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'javakg-mcp-repo-'));
  const root = path.join(repoPath, 'src');
  await fs.mkdir(root, { recursive: true });

  await fs.writeFile(path.join(root, 'BaseService.java'), `
package com.acme;
public class BaseService {
  protected void processPayment() {}
}
`);

  await fs.writeFile(path.join(root, 'PaymentProcessor.java'), `
package com.acme;
public class PaymentProcessor extends BaseService {
  public void charge() { processPayment(); }
}
`);

  return repoPath;
}

test('MCP server exposes tools and executes query/context/impact/cypher/list_repos', async () => {
  const repoPath = await makeRepo();
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'javakg-mcp-db-'));
  const pipeline = await runPipelineFromRepo({ repoPath, storagePath, projectName: 'mcp-demo' });

  const server = createJavaMCPServer({
    graph: pipeline.graph,
    repoName: 'mcp-demo',
    repoPath,
  });

  const tools = server.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['query', 'context', 'impact', 'cypher', 'list_repos']);

  const queryResult = await server.callTool('query', { query: 'payment' });
  assert.ok(Array.isArray(queryResult.results));
  assert.ok(queryResult.results.length > 0);

  const contextResult = await server.callTool('context', { symbol: 'charge' });
  assert.equal(contextResult.symbol?.name, 'charge');

  const impactResult = await server.callTool('impact', { target: 'processPayment', direction: 'upstream', maxDepth: 2 });
  assert.ok(Array.isArray(impactResult.affected));
  assert.ok(impactResult.affected.some((item: any) => item.name === 'charge'));

  const cypherResult = await server.callTool('cypher', { query: 'MATCH (n:Class) RETURN n.name LIMIT 5' });
  assert.ok(Array.isArray(cypherResult.rows));
  assert.ok(cypherResult.rows.length >= 2);

  const reposResult = await server.callTool('list_repos', {});
  assert.deepEqual(reposResult.repos, [{ name: 'mcp-demo', path: repoPath }]);
});
