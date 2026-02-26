import fs from 'node:fs/promises';
import path from 'node:path';

import { runPipelineFromRepo } from '../../../core/src/ingestion/pipeline';

export interface IndexCommandArgs {
  repoPath?: string;
  storagePath: string;
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

export const runIndexCommand = async (args: IndexCommandArgs): Promise<string> => {
  const repoPath = args.repoPath ? path.resolve(args.repoPath) : await loadRepoPathFromConfig(args.storagePath);
  const projectName = path.basename(repoPath);

  const result = await runPipelineFromRepo({
    repoPath,
    storagePath: args.storagePath,
    projectName,
  });

  return `Indexed files: ${result.filesIndexed}\nNodes: ${result.graph.nodeCount}\nRelationships: ${result.graph.relationshipCount}`;
};
