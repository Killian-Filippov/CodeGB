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
  includeFilePaths?: string[];
  changedFilePaths?: string[];
  incremental?: boolean;
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

const toAbsoluteFilePath = (repoPath: string, filePath: string): string => {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  return path.resolve(repoPath, filePath);
};

const toRelativeFilePath = (repoPath: string, filePath: string): string => {
  const absPath = toAbsoluteFilePath(repoPath, filePath);
  const relPath = path.relative(repoPath, absPath);
  return relPath || path.basename(absPath);
};

const dedupe = (values: string[]): string[] => Array.from(new Set(values));

const filterExistingJavaFiles = async (repoPath: string, filePaths: string[]): Promise<string[]> => {
  const resolved = dedupe(filePaths.map((item) => toAbsoluteFilePath(repoPath, item))).filter(isJavaFile);
  const existing: string[] = [];

  for (const filePath of resolved) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        existing.push(filePath);
      }
    } catch {
      // Ignore deleted/non-existing files in incremental mode.
    }
  }

  return existing;
};

const buildGraphFromFiles = async (repoPath: string, projectName: string, javaFiles: string[]): Promise<KnowledgeGraph> => {
  const graph = createKnowledgeGraph();
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

  const extractions = [];
  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    const parsed = parseJavaSource(source, filePath);
    extractions.push(processSymbolsForFile(graph, parsed, repoPath, projectNodeId));
  }

  processImports(graph, extractions);
  processInheritance(graph, extractions);
  processCalls(graph, extractions);

  return graph;
};

const mergeIncrementalGraph = (
  baseGraph: KnowledgeGraph,
  patchGraph: KnowledgeGraph,
  invalidatedFiles: Set<string>,
): KnowledgeGraph => {
  const merged = createKnowledgeGraph();
  const removedNodeIds = new Set(
    baseGraph.nodes
      .filter((node) => invalidatedFiles.has(node.properties.filePath))
      .map((node) => node.id),
  );

  for (const node of baseGraph.nodes) {
    if (removedNodeIds.has(node.id)) {
      continue;
    }
    merged.addNode(node);
  }

  for (const node of patchGraph.nodes) {
    merged.addNode(node);
  }

  const canAttach = (sourceId: string, targetId: string): boolean => {
    return Boolean(merged.getNode(sourceId) && merged.getNode(targetId));
  };

  for (const rel of baseGraph.relationships) {
    if (removedNodeIds.has(rel.sourceId)) {
      continue;
    }
    if (!canAttach(rel.sourceId, rel.targetId)) {
      continue;
    }
    merged.addRelationship(rel);
  }

  for (const rel of patchGraph.relationships) {
    if (!canAttach(rel.sourceId, rel.targetId)) {
      continue;
    }
    merged.addRelationship(rel);
  }

  return merged;
};

export const runPipelineFromRepo = async (options: PipelineOptions): Promise<PipelineResult> => {
  const repoPath = path.resolve(options.repoPath);
  const projectName = options.projectName ?? path.basename(repoPath);
  const javaFiles = options.includeFilePaths
    ? await filterExistingJavaFiles(repoPath, options.includeFilePaths)
    : await walk(repoPath);
  const patchGraph = await buildGraphFromFiles(repoPath, projectName, javaFiles);

  const adapter = new KuzuAdapter(options.storagePath);
  await adapter.init();

  let graph = patchGraph;
  if (options.incremental) {
    const invalidatedFiles = new Set(
      dedupe(options.changedFilePaths ?? options.includeFilePaths ?? javaFiles)
        .filter(isJavaFile)
        .map((filePath) => toRelativeFilePath(repoPath, filePath)),
    );

    if (invalidatedFiles.size > 0) {
      let baseGraph = createKnowledgeGraph();
      try {
        baseGraph = await adapter.loadGraph();
      } catch {
        // Empty or missing graph is expected before first index.
      }
      graph = mergeIncrementalGraph(baseGraph, patchGraph, invalidatedFiles);
    }
  }

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
