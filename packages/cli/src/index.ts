import path from 'node:path';
import process from 'node:process';

import { runIndexCommand } from './commands/index';
import { runInitCommand } from './commands/init';
import { runQueryCommand } from './commands/query';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_STORAGE = '.javakg';
const CLI_VERSION = '0.1.0';

const readOption = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
};

const resolveStoragePath = (args: string[]): string => {
  const fromOption = readOption(args, '--storage');
  return path.resolve(fromOption ?? DEFAULT_STORAGE);
};

export const runCli = async (argv: string[]): Promise<CliResult> => {
  const [command, ...rest] = argv;

  try {
    if (!command || command === 'help' || command === '--help') {
      return {
        exitCode: 0,
        stdout: 'Usage: codegb <init|index|query> ...',
        stderr: '',
      };
    }

    if (command === 'version' || command === '--version' || command === '-v') {
      return {
        exitCode: 0,
        stdout: CLI_VERSION,
        stderr: '',
      };
    }

    if (command === 'init') {
      const repoPath = rest[0];
      if (!repoPath) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'init requires <repoPath>',
        };
      }
      const storagePath = resolveStoragePath(rest);
      const stdout = await runInitCommand({ repoPath, storagePath });
      return { exitCode: 0, stdout, stderr: '' };
    }

    if (command === 'index') {
      const repoPath = rest[0]?.startsWith('--') ? undefined : rest[0];
      const storagePath = resolveStoragePath(rest);
      const stdout = await runIndexCommand({ repoPath, storagePath });
      return { exitCode: 0, stdout, stderr: '' };
    }

    if (command === 'query') {
      const query = rest[0];
      if (!query) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'query requires <query>',
        };
      }
      const storagePath = resolveStoragePath(rest);
      const limit = Number(readOption(rest, '--limit') ?? 10);
      const stdout = await runQueryCommand({ query, storagePath, limit });
      return { exitCode: 0, stdout, stderr: '' };
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: `Unknown command: ${command}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: '',
      stderr: message,
    };
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) {
      process.stdout.write(`${result.stdout}\n`);
    }
    if (result.stderr) {
      process.stderr.write(`${result.stderr}\n`);
    }
    process.exitCode = result.exitCode;
  });
}
