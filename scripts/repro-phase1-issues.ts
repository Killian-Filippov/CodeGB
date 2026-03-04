import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);

const repoPath = process.env.REPRO_REPO_PATH ?? '/tmp/commons-lang';
const storagePath = process.env.REPRO_STORAGE_PATH ?? '/tmp/codegb-commons-db';
const codegbRoot = process.env.CODEGB_ROOT ?? process.cwd();

const run = async (cmd: string, args: string[], cwd = codegbRoot) => {
  const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, env: process.env });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

const runCli = async (args: string[]) => {
  return run('pnpm', ['-s', 'exec', 'tsx', 'packages/cli/src/index.ts', ...args]);
};

type Probe = {
  id: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL' | 'WARN';
};

const probes: Probe[] = [];

const addProbe = (id: string, expected: string, actual: string, status: Probe['status']) => {
  probes.push({ id, expected, actual, status });
};

const summarize = () => {
  console.log('\n=== Repro Summary ===');
  for (const p of probes) {
    console.log(`- [${p.status}] ${p.id}`);
    console.log(`  expected: ${p.expected}`);
    console.log(`  actual:   ${p.actual}`);
  }
};

const main = async () => {
  console.log(`Using repo: ${repoPath}`);
  console.log(`Using storage: ${storagePath}`);
  console.log(`Using codegb root: ${codegbRoot}`);

  await run('git', ['clone', '--depth', '1', 'https://github.com/apache/commons-lang.git', repoPath], '/tmp').catch(() => {
    // Ignore if already exists.
  });

  const init = await runCli(['init', repoPath, '--storage', storagePath]);
  const index = await runCli(['index', repoPath, '--storage', storagePath]);
  const query = await runCli(['query', 'StringUtils', '--storage', storagePath, '--limit', '3']);

  addProbe(
    'CLI init/index/query base flow',
    'init/index/query all succeed',
    `init=${init.stdout || init.stderr}; index=${index.stdout || index.stderr}; query=${query.stdout.split('\n')[0] ?? ''}`,
    'PASS'
  );

  const legacyQuery = await runCli(['query', 'StringUtils', '--db-path', storagePath, '--limit', '3']).catch((e: any) => ({
    stdout: '',
    stderr: String(e.stderr ?? e.message ?? e),
  }));

  const legacyActual = `${legacyQuery.stdout} ${legacyQuery.stderr}`.trim();
  if (legacyActual.includes('graph.json')) {
    addProbe(
      'Legacy CLI flag --db-path',
      'clear validation error for unsupported flag',
      legacyActual,
      'FAIL'
    );
  } else {
    addProbe('Legacy CLI flag --db-path', 'clear validation error for unsupported flag', legacyActual, 'WARN');
  }

  const transport = new StdioClientTransport({
    command: 'pnpm',
    args: ['exec', 'tsx', 'packages/mcp-server/src/cli.ts'],
    cwd: codegbRoot,
    env: {
      ...process.env,
      JAVA_KG_DB_PATH: storagePath,
    },
  });

  const client = new Client({ name: 'codegb-repro', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((t: any) => t.name).join(',');
  addProbe(
    'MCP tools exposure',
    'query,context,impact,cypher,list_repos all available',
    names,
    names.includes('query') && names.includes('context') && names.includes('impact') && names.includes('cypher') && names.includes('list_repos')
      ? 'PASS'
      : 'FAIL'
  );

  const unsupportedCypher = await client
    .callTool({
      name: 'cypher',
      arguments: { query: "MATCH (n:Class) WHERE n.name CONTAINS 'String' RETURN n.name LIMIT 3" },
    })
    .then(() => ({ ok: true, text: '' }))
    .catch((e) => ({ ok: false, text: String(e) }));

  addProbe(
    'Cypher boundary: WHERE CONTAINS',
    'query should be supported or return structured unsupported-capability response',
    unsupportedCypher.ok ? 'unexpected success' : unsupportedCypher.text,
    unsupportedCypher.ok ? 'WARN' : 'FAIL'
  );

  const countRes = await client.callTool({
    name: 'cypher',
    arguments: { query: 'MATCH (n:Class) RETURN count(n) as cnt' },
  });
  const countText = String((countRes.content as any[])?.[0]?.text ?? '');
  addProbe(
    'Cypher accuracy: count aggregation',
    'single row with numeric cnt',
    countText,
    countText.includes('"cnt"') ? 'PASS' : 'FAIL'
  );

  const nodeRes = await client.callTool({
    name: 'cypher',
    arguments: { query: 'MATCH (n:Class) RETURN n ORDER BY n.name LIMIT 3' },
  });
  const nodeText = String((nodeRes.content as any[])?.[0]?.text ?? '');
  addProbe(
    'Cypher accuracy: RETURN n shape',
    'rows should contain non-empty node payloads',
    nodeText,
    nodeText.includes('{}') ? 'FAIL' : 'PASS'
  );

  await client.close();
  summarize();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
