import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { runPipelineFromRepo } from '../packages/core/src/ingestion/pipeline';

const execFile = promisify(execFileCallback);

type Backend = 'wasm' | 'native';

const BENCHMARK_DOC_PATH = path.resolve('docs/benchmarks/latest.md');
const MCP_SERVER_ENTRY = path.resolve('packages/mcp-server/src/cli.ts');
const DB_BACKEND_ENV_KEY = 'CODEGB_DB_BACKEND';
const RESULT_FILE_ENV_KEY = 'CODEGB_BENCH_RESULT_FILE';

const COLD_START_ITERATIONS = 10;
const WARM_QUERY_ITERATIONS = 120;
const CONCURRENCY_ROUNDS = 24;
const QUERY_FIXTURES = ['Service1', 'Service20', 'Repository18', 'Entity9', 'persist'];
const POLICY_THRESHOLD_RATIO = 0.1;
const POLICY_PRIMARY_SCENARIO = 'Warm Query (single client)';

interface ScenarioMetrics {
  name: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  throughputOpsPerSec: number;
}

interface BackendBenchmarkSuccess {
  backend: Backend;
  success: true;
  generatedFiles: number;
  indexedFiles: number;
  graphNodes: number;
  graphRelationships: number;
  indexDurationMs: number;
  peakMemoryBytes: number;
  scenarios: ScenarioMetrics[];
}

interface BackendBenchmarkFailure {
  backend: Backend;
  success: false;
  error: string;
}

type BackendBenchmark = BackendBenchmarkSuccess | BackendBenchmarkFailure;

const hrNowMs = (): number => Number(process.hrtime.bigint()) / 1_000_000;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
};

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const bytesToMiB = (bytes: number): number => round(bytes / (1024 * 1024), 2);

const psRssBytes = async (pid: number): Promise<number> => {
  try {
    const { stdout } = await execFile('ps', ['-o', 'rss=', '-p', String(pid)]);
    const kb = Number(stdout.trim());
    if (!Number.isFinite(kb) || kb <= 0) {
      return 0;
    }
    return kb * 1024;
  } catch {
    return 0;
  }
};

const createSyntheticRepo = async (repoPath: string): Promise<number> => {
  const srcDir = path.join(repoPath, 'src/main/java/com/benchmark');
  await fs.mkdir(srcDir, { recursive: true });

  const shared = `
package com.benchmark;

public class SharedUtil {
    public String normalize(String input) {
        return input == null ? "" : input.trim().toLowerCase();
    }
}
`;
  await fs.writeFile(path.join(srcDir, 'SharedUtil.java'), shared, 'utf8');

  const totalServices = 40;
  for (let i = 1; i <= totalServices; i += 1) {
    const entity = `
package com.benchmark;

public class Entity${i} {
    private String id;
    private String payload;

    public Entity${i}(String id, String payload) {
        this.id = id;
        this.payload = payload;
    }

    public String getId() { return id; }
    public String getPayload() { return payload; }
    public void setPayload(String payload) { this.payload = payload; }
}
`;

    const repository = `
package com.benchmark;

public interface Repository${i} {
    Entity${i} findById(String id);
    Entity${i} persist(Entity${i} entity);
}
`;

    const service = `
package com.benchmark;

public class Service${i} {
    private final Repository${i} repository;
    private final SharedUtil util;

    public Service${i}(Repository${i} repository, SharedUtil util) {
        this.repository = repository;
        this.util = util;
    }

    public Entity${i} process(String id, String payload) {
        String normalized = util.normalize(payload);
        Entity${i} entity = new Entity${i}(id, normalized);
        return repository.persist(entity);
    }

    public Entity${i} load(String id) {
        return repository.findById(id);
    }
}
`;

    await Promise.all([
      fs.writeFile(path.join(srcDir, `Entity${i}.java`), entity, 'utf8'),
      fs.writeFile(path.join(srcDir, `Repository${i}.java`), repository, 'utf8'),
      fs.writeFile(path.join(srcDir, `Service${i}.java`), service, 'utf8'),
    ]);
  }

  return 1 + totalServices * 3;
};

class BenchmarkClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async connect(storagePath: string, backend: Backend): Promise<void> {
    this.transport = new StdioClientTransport({
      command: 'pnpm',
      args: ['exec', 'tsx', MCP_SERVER_ENTRY],
      env: {
        ...process.env,
        JAVA_KG_DB_PATH: storagePath,
        [DB_BACKEND_ENV_KEY]: backend,
      },
      stderr: 'pipe',
    });

    this.client = new Client(
      {
        name: 'benchmark-client',
        version: '0.2.0-beta.1',
      },
      { capabilities: {} },
    );

    await this.client.connect(this.transport);
    await this.client.listTools();
  }

  getServerPid(): number | null {
    return this.transport?.pid ?? null;
  }

  async query(term: string): Promise<void> {
    if (!this.client) {
      throw new Error('Benchmark client not connected');
    }

    await this.client.callTool({
      name: 'query',
      arguments: {
        query: term,
        limit: 10,
      },
    });
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.transport = null;
  }
}

const runBackendBenchmark = async (backend: Backend): Promise<BackendBenchmark> => {
  const previousBackend = process.env[DB_BACKEND_ENV_KEY];
  process.env[DB_BACKEND_ENV_KEY] = backend;

  let peakMemoryBytes = process.memoryUsage().rss;
  const observePeakMemory = async (serverPid: number | null): Promise<void> => {
    peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);
    if (serverPid) {
      peakMemoryBytes = Math.max(peakMemoryBytes, await psRssBytes(serverPid));
    }
  };

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `codegb-mcp-bench-${backend}-`));
  const repoPath = path.join(tmpRoot, 'repo');
  const storagePath = path.join(tmpRoot, 'db');

  try {
    await fs.mkdir(repoPath, { recursive: true });
    const generatedFiles = await createSyntheticRepo(repoPath);

    const indexStart = hrNowMs();
    const indexResult = await runPipelineFromRepo({
      repoPath,
      storagePath,
      projectName: `benchmark-repo-${backend}`,
    });
    const indexDurationMs = hrNowMs() - indexStart;

    await observePeakMemory(null);

    const scenarioResults: ScenarioMetrics[] = [];

    {
      const latencies: number[] = [];
      const throughputStart = hrNowMs();
      for (let i = 0; i < COLD_START_ITERATIONS; i += 1) {
        const client = new BenchmarkClient();
        const query = QUERY_FIXTURES[i % QUERY_FIXTURES.length];
        const opStart = hrNowMs();
        await client.connect(storagePath, backend);
        await observePeakMemory(client.getServerPid());
        await client.query(query);
        await observePeakMemory(client.getServerPid());
        latencies.push(hrNowMs() - opStart);
        await client.close();
      }
      const totalSeconds = (hrNowMs() - throughputStart) / 1000;
      scenarioResults.push({
        name: 'Cold Start (connect + first query)',
        samples: latencies.length,
        p50Ms: round(percentile(latencies, 50)),
        p95Ms: round(percentile(latencies, 95)),
        throughputOpsPerSec: round(latencies.length / totalSeconds),
      });
    }

    {
      const client = new BenchmarkClient();
      await client.connect(storagePath, backend);
      await observePeakMemory(client.getServerPid());

      for (let i = 0; i < 8; i += 1) {
        await client.query(QUERY_FIXTURES[i % QUERY_FIXTURES.length]);
      }

      const latencies: number[] = [];
      const throughputStart = hrNowMs();
      for (let i = 0; i < WARM_QUERY_ITERATIONS; i += 1) {
        const opStart = hrNowMs();
        await client.query(QUERY_FIXTURES[i % QUERY_FIXTURES.length]);
        latencies.push(hrNowMs() - opStart);
      }
      await observePeakMemory(client.getServerPid());
      const totalSeconds = (hrNowMs() - throughputStart) / 1000;

      scenarioResults.push({
        name: 'Warm Query (single client)',
        samples: latencies.length,
        p50Ms: round(percentile(latencies, 50)),
        p95Ms: round(percentile(latencies, 95)),
        throughputOpsPerSec: round(latencies.length / totalSeconds),
      });

      await client.close();
    }

    for (const concurrency of [5, 10]) {
      const client = new BenchmarkClient();
      await client.connect(storagePath, backend);
      await observePeakMemory(client.getServerPid());

      for (let i = 0; i < concurrency; i += 1) {
        await client.query(QUERY_FIXTURES[i % QUERY_FIXTURES.length]);
      }

      const latencies: number[] = [];
      const totalOps = concurrency * CONCURRENCY_ROUNDS;
      const throughputStart = hrNowMs();

      for (let roundIndex = 0; roundIndex < CONCURRENCY_ROUNDS; roundIndex += 1) {
        const requests = Array.from({ length: concurrency }, async (_, i) => {
          const query = QUERY_FIXTURES[(roundIndex + i) % QUERY_FIXTURES.length];
          const opStart = hrNowMs();
          await client.query(query);
          latencies.push(hrNowMs() - opStart);
        });
        await Promise.all(requests);
      }

      await observePeakMemory(client.getServerPid());
      const totalSeconds = (hrNowMs() - throughputStart) / 1000;

      scenarioResults.push({
        name: `Concurrent Query (concurrency=${concurrency})`,
        samples: latencies.length,
        p50Ms: round(percentile(latencies, 50)),
        p95Ms: round(percentile(latencies, 95)),
        throughputOpsPerSec: round(totalOps / totalSeconds),
      });

      await client.close();
    }

    return {
      backend,
      success: true,
      generatedFiles,
      indexedFiles: indexResult.filesIndexed,
      graphNodes: indexResult.graph.nodes.length,
      graphRelationships: indexResult.graph.relationships.length,
      indexDurationMs: round(indexDurationMs),
      peakMemoryBytes,
      scenarios: scenarioResults,
    };
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    return {
      backend,
      success: false,
      error: message,
    };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    if (previousBackend === undefined) {
      delete process.env[DB_BACKEND_ENV_KEY];
    } else {
      process.env[DB_BACKEND_ENV_KEY] = previousBackend;
    }
  }
};

const findScenario = (bench: BackendBenchmarkSuccess, name: string): ScenarioMetrics => {
  const hit = bench.scenarios.find((item) => item.name === name);
  if (!hit) {
    throw new Error(`Scenario not found: ${name}`);
  }
  return hit;
};

const formatBackendSection = (result: BackendBenchmark): string[] => {
  if (!result.success) {
    return [
      `## Backend: ${result.backend}`,
      '',
      '- Status: failed',
      `- Error: ${result.error}`,
      '',
    ];
  }

  return [
    `## Backend: ${result.backend}`,
    '',
    '- Status: success',
    `- Indexed Java files: ${result.indexedFiles}`,
    `- Graph size: ${result.graphNodes} nodes / ${result.graphRelationships} relationships`,
    `- Index duration: ${result.indexDurationMs} ms`,
    `- Peak memory (runner + sampled MCP process): ${bytesToMiB(result.peakMemoryBytes)} MiB`,
    '',
    '| Scenario | Samples | P50 (ms) | P95 (ms) | Throughput (ops/s) |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...result.scenarios.map(
      (item) =>
        `| ${item.name} | ${item.samples} | ${item.p50Ms} | ${item.p95Ms} | ${item.throughputOpsPerSec} |`,
    ),
    '',
  ];
};

const parseBackendArg = (argv: string[]): Backend | null => {
  const index = argv.indexOf('--backend');
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1];
  if (value === 'wasm' || value === 'native') {
    return value;
  }
  throw new Error('Invalid --backend value; expected wasm|native');
};

const runSingleBackendMode = async (backend: Backend): Promise<void> => {
  const result = await runBackendBenchmark(backend);
  const outputFile = process.env[RESULT_FILE_ENV_KEY];
  if (outputFile) {
    await fs.writeFile(outputFile, JSON.stringify(result), 'utf8');
  }
  if (!result.success) {
    process.stderr.write(`${result.error}\n`);
    process.exitCode = 1;
  }
};

const runCompareMode = async (): Promise<void> => {
  const now = new Date().toISOString();
  const backends: Backend[] = ['wasm', 'native'];
  const results: BackendBenchmark[] = [];

  for (const backend of backends) {
    process.stdout.write(`Running MCP benchmark for backend=${backend} ...\n`);
    const resultPath = path.join(os.tmpdir(), `codegb-bench-result-${backend}-${Date.now()}.json`);
    try {
      await execFile(
        'pnpm',
        ['exec', 'tsx', 'scripts/benchmark-mcp.ts', '--backend', backend],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            [RESULT_FILE_ENV_KEY]: resultPath,
          },
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const raw = await fs.readFile(resultPath, 'utf8');
      results.push(JSON.parse(raw) as BackendBenchmark);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let detail = message;
      try {
        const raw = await fs.readFile(resultPath, 'utf8');
        const parsed = JSON.parse(raw) as BackendBenchmark;
        results.push(parsed);
        detail = '';
      } catch {
        results.push({
          backend,
          success: false,
          error: `Subprocess failed before benchmark result was persisted: ${message}`,
        });
      }
      if (detail) {
        process.stderr.write(`[benchmark:${backend}] ${detail}\n`);
      }
    } finally {
      await fs.rm(resultPath, { force: true });
    }
  }

  const wasmResult = results.find((item) => item.backend === 'wasm');
  const nativeResult = results.find((item) => item.backend === 'native');

  let recommendedDefault: Backend = 'wasm';
  let decisionSummary = 'Only one backend succeeded; selected the available backend.';
  let policyDetails = '- Decision metric unavailable because one side failed.';

  if (wasmResult?.success && nativeResult?.success) {
    const wasmP95 = findScenario(wasmResult, POLICY_PRIMARY_SCENARIO).p95Ms;
    const nativeP95 = findScenario(nativeResult, POLICY_PRIMARY_SCENARIO).p95Ms;
    const allowedP95 = nativeP95 * (1 + POLICY_THRESHOLD_RATIO);
    const degradationRatio = nativeP95 === 0 ? 0 : (wasmP95 - nativeP95) / nativeP95;

    if (wasmP95 <= allowedP95) {
      recommendedDefault = 'wasm';
      decisionSummary = `wasm P95 is within threshold (${round(POLICY_THRESHOLD_RATIO * 100)}%).`;
    } else {
      recommendedDefault = 'native';
      decisionSummary = `wasm P95 exceeds threshold by ${round((degradationRatio - POLICY_THRESHOLD_RATIO) * 100, 2)}%.`;
    }

    policyDetails = [
      `- Primary metric: ${POLICY_PRIMARY_SCENARIO} P95`,
      `- Threshold: wasm P95 <= native P95 * ${round(1 + POLICY_THRESHOLD_RATIO, 2)} (=${round(POLICY_THRESHOLD_RATIO * 100)}%)`,
      `- native P95: ${nativeP95} ms`,
      `- wasm P95: ${wasmP95} ms`,
      `- wasm vs native delta: ${round(degradationRatio * 100, 2)}%`,
    ].join('\n');
  } else if (nativeResult?.success && !wasmResult?.success) {
    recommendedDefault = 'native';
  } else if (wasmResult?.success && !nativeResult?.success) {
    recommendedDefault = 'wasm';
  }

  const markdown = [
    '# MCP Benchmark (Latest)',
    '',
    `- Generated at: ${now}`,
    '- Comparison: wasm vs native',
    '',
    '## Default Backend Decision',
    '',
    `- Recommended default backend: \`${recommendedDefault}\``,
    `- Summary: ${decisionSummary}`,
    policyDetails,
    '',
    ...results.flatMap((item) => formatBackendSection(item)),
    '## Notes',
    '',
    '- Cold start = MCP server spawn + handshake + first query.',
    '- Warm query and concurrent scenarios use one already connected MCP client.',
    '- Throughput is computed as total successful query calls divided by wall-clock scenario duration.',
  ].join('\n');

  await fs.mkdir(path.dirname(BENCHMARK_DOC_PATH), { recursive: true });
  await fs.writeFile(BENCHMARK_DOC_PATH, `${markdown}\n`, 'utf8');

  process.stdout.write(`Benchmark report generated: ${BENCHMARK_DOC_PATH}\n`);
  process.stdout.write(`Recommended default backend: ${recommendedDefault}\n`);
};

const run = async (): Promise<void> => {
  const backend = parseBackendArg(process.argv.slice(2));
  if (backend) {
    await runSingleBackendMode(backend);
    return;
  }
  await runCompareMode();
};

run().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
