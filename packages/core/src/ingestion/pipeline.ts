import fs from 'node:fs/promises';
import path from 'node:path';

import { createKnowledgeGraph } from '../graph/graph';
import { parseJavaSource } from '../parser/ast-extractor';
import { KuzuAdapter } from '../storage/kuzu-adapter';
import type { KnowledgeGraph } from '../types/graph';
import { processCalls } from './call-processor';
import { processImports } from './import-processor';
import { processInheritance } from './inheritance-processor';
import { processSymbolsForFile } from './symbol-processor';

export interface PipelineOptions {
  repoPath: string;
  storagePath: string;
  projectName?: string;
}

export interface PipelineResult {
  graph: KnowledgeGraph;
  repoPath: string;
  filesIndexed: number;
  persisted: boolean;
}

const isJavaFile = (filePath: string): boolean => filePath.endsWith('.java');

const walk = async (dirPath: string): Promise<string[]> => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.isFile() && isJavaFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
};

export const runPipelineFromRepo = async (options: PipelineOptions): Promise<PipelineResult> => {
  const repoPath = path.resolve(options.repoPath);
  const graph = createKnowledgeGraph();
  const projectName = options.projectName ?? path.basename(repoPath);
  const projectNodeId = `project:${projectName}`;

  graph.addNode({
    id: projectNodeId,
    label: 'Project',
    properties: {
      name: projectName,
      qualifiedName: projectName,
      filePath: repoPath,
    },
  });

  const javaFiles = await walk(repoPath);
  const extractions = [];

  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    const parsed = parseJavaSource(source, filePath);
    extractions.push(processSymbolsForFile(graph, parsed, repoPath, projectNodeId));
  }

  processImports(graph, extractions);
  processInheritance(graph, extractions);
  processCalls(graph, extractions);

  const adapter = new KuzuAdapter(options.storagePath);
  await adapter.init();
  await adapter.persistGraph(graph);
  await adapter.saveRepository({
    name: projectName,
    path: repoPath,
  });

  return {
    graph,
    repoPath,
    filesIndexed: javaFiles.length,
    persisted: true,
  };
};
