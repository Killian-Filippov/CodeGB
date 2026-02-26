import fs from 'node:fs/promises';
import path from 'node:path';

import { collectChangedJavaFiles } from '../../../core/src/ingestion/git-changed-files';
import { KuzuAdapter } from '../../../core/src/storage/kuzu-adapter';
import { runPipelineFromRepo } from '../../../core/src/ingestion/pipeline';

export interface IndexCommandArgs {
  repoPath?: string;
  storagePath: string;
  changedFiles?: boolean;
}

const loadRepoPathFromConfig = async (storagePath: string): Promise<string> => {
  const configPath = path.join(storagePath, 'config.json');
  const content = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(content) as { repoPath: string };
  if (!config.repoPath) {
    throw new Error(`Missing repoPath in ${configPath}`);
  }
  return config.repoPath;
};

const loadPersistedGraphStats = async (storagePath: string): Promise<{ nodeCount: number; relationshipCount: number }> => {
  const adapter = new KuzuAdapter(storagePath);
  try {
    await adapter.init();
    const graph = await adapter.loadGraph();
    return {
      nodeCount: graph.nodeCount,
      relationshipCount: graph.relationshipCount,
    };
  } catch {
    return {
      nodeCount: 0,
      relationshipCount: 0,
    };
  } finally {
    await adapter.close().catch(() => undefined);
  }
};

export const runIndexCommand = async (args: IndexCommandArgs): Promise<string> => {
  const repoPath = args.repoPath ? path.resolve(args.repoPath) : await loadRepoPathFromConfig(args.storagePath);
  const projectName = path.basename(repoPath);

  if (args.changedFiles) {
    const changedFiles = await collectChangedJavaFiles(repoPath);
    if (changedFiles.filesToInvalidate.length === 0) {
      const persisted = await loadPersistedGraphStats(args.storagePath);
      return `Mode: incremental (git diff)\nIndexed files: 0\nNodes: ${persisted.nodeCount}\nRelationships: ${persisted.relationshipCount}\nSkipped: no changed Java files detected`;
    }

    const result = await runPipelineFromRepo({
      repoPath,
      storagePath: args.storagePath,
      projectName,
      includeFilePaths: changedFiles.filesToIndex,
      changedFilePaths: changedFiles.filesToInvalidate,
      incremental: true,
    });

    return `Mode: incremental (git diff)\nIndexed files: ${result.filesIndexed}\nNodes: ${result.graph.nodeCount}\nRelationships: ${result.graph.relationshipCount}`;
  }

  const result = await runPipelineFromRepo({
    repoPath,
    storagePath: args.storagePath,
    projectName,
  });

  return `Mode: full\nIndexed files: ${result.filesIndexed}\nNodes: ${result.graph.nodeCount}\nRelationships: ${result.graph.relationshipCount}`;
};
