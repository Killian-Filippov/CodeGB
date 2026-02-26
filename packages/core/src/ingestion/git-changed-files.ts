import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface ChangedFilesResult {
  filesToIndex: string[];
  filesToInvalidate: string[];
}

const execFileAsync = promisify(execFile);

const isJavaPath = (filePath: string): boolean => filePath.toLowerCase().endsWith('.java');

const uniqueSorted = (values: Iterable<string>): string[] => {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
};

const runGitCommand = async (repoPath: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
  return stdout;
};

const parseNameStatus = (rawOutput: string, toIndex: Set<string>, toInvalidate: Set<string>): void => {
  const lines = rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split('\t').filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const status = parts[0] ?? '';
    const code = status[0] ?? '';
    const firstPath = parts[1] ?? '';
    const secondPath = parts[2] ?? '';

    if (code === 'R') {
      if (isJavaPath(firstPath)) {
        toInvalidate.add(firstPath);
      }
      if (isJavaPath(secondPath)) {
        toIndex.add(secondPath);
        toInvalidate.add(secondPath);
      }
      continue;
    }

    if (code === 'C') {
      const target = secondPath || firstPath;
      if (isJavaPath(target)) {
        toIndex.add(target);
        toInvalidate.add(target);
      }
      continue;
    }

    if (code === 'D') {
      if (isJavaPath(firstPath)) {
        toInvalidate.add(firstPath);
      }
      continue;
    }

    if (!isJavaPath(firstPath)) {
      continue;
    }

    toIndex.add(firstPath);
    toInvalidate.add(firstPath);
  }
};

const hasGitHead = async (repoPath: string): Promise<boolean> => {
  try {
    await runGitCommand(repoPath, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
};

export const collectChangedJavaFiles = async (repoPath: string): Promise<ChangedFilesResult> => {
  try {
    await runGitCommand(repoPath, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error(`changed-files incremental indexing requires a git repository: ${repoPath}`);
  }

  const toIndex = new Set<string>();
  const toInvalidate = new Set<string>();
  const diffArgs = ['diff', '--name-status', '--find-renames', '--diff-filter=ACMRD'];

  if (await hasGitHead(repoPath)) {
    const headDiff = await runGitCommand(repoPath, [...diffArgs, 'HEAD']);
    parseNameStatus(headDiff, toIndex, toInvalidate);
  } else {
    const workingTreeDiff = await runGitCommand(repoPath, diffArgs);
    parseNameStatus(workingTreeDiff, toIndex, toInvalidate);

    const stagedDiff = await runGitCommand(repoPath, [...diffArgs, '--cached']);
    parseNameStatus(stagedDiff, toIndex, toInvalidate);
  }

  const untrackedRaw = await runGitCommand(repoPath, ['ls-files', '--others', '--exclude-standard']);
  const untracked = untrackedRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && isJavaPath(line));

  for (const filePath of untracked) {
    toIndex.add(filePath);
    toInvalidate.add(filePath);
  }

  return {
    filesToIndex: uniqueSorted(toIndex),
    filesToInvalidate: uniqueSorted(toInvalidate),
  };
};
