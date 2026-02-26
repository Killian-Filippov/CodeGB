/**
 * CLI Page Object
 *
 * Provides a high-level interface for interacting with the CLI tool.
 * Encapsulates CLI command execution and output parsing.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CLICommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface CLIOptions {
  cwd?: string;
  timeout?: number;
}

export interface InitOptions {
  repoPath: string;
  dbPath?: string;
  force?: boolean;
}

export interface IndexOptions {
  repoPath?: string;
  dbPath?: string;
  verbose?: boolean;
}

export interface QueryOptions {
  searchTerm: string;
  dbPath?: string;
  limit?: number;
  type?: string;
}

/**
 * CLI Page Object
 */
export class CLIPO {
  private cliPath: string;
  private defaultDbPath: string;
  private lastStoragePath: string | null = null;

  constructor(
    cliPath: string = 'packages/cli/dist/index.js',
    defaultDbPath: string = '/tmp/java-kg-test.db'
  ) {
    const requestedPath = path.resolve(process.cwd(), cliPath);
    const fallbackTsPath = requestedPath
      .replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)
      .replace(/\.js$/, '.ts');
    const fallbackJsPath = requestedPath.replace(
      `${path.sep}dist${path.sep}`,
      `${path.sep}src${path.sep}`,
    );
    this.cliPath = existsSync(requestedPath)
      ? requestedPath
      : existsSync(fallbackTsPath)
        ? fallbackTsPath
        : fallbackJsPath;
    this.defaultDbPath = defaultDbPath;
  }

  private toStoragePath(dbPath?: string): string {
    const storagePath = dbPath || this.defaultDbPath;
    this.lastStoragePath = storagePath;
    return storagePath;
  }

  /**
   * Execute a CLI command
   */
  async execute(
    command: string,
    args: string[] = [],
    options: CLIOptions = {}
  ): Promise<CLICommandResult> {
    return new Promise((resolve) => {
      const useTsx = this.cliPath.endsWith('.ts');
      const executable = useTsx ? 'pnpm' : 'node';
      const commandArgs = useTsx
        ? ['exec', 'tsx', this.cliPath, command, ...args]
        : [this.cliPath, command, ...args];
      const child = spawn(executable, commandArgs, {
        cwd: options.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const timeout = options.timeout || 30000;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill();
          resolve({
            success: false,
            exitCode: null,
            stdout,
            stderr: `Command timed out after ${timeout}ms`,
          });
        }
      }, timeout);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({
            success: code === 0,
            exitCode: code,
            stdout,
            stderr,
          });
        }
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            exitCode: null,
            stdout,
            stderr: error.message,
          });
        }
      });
    });
  }

  /**
   * Check if CLI is built
   */
  async isBuilt(): Promise<boolean> {
    try {
      await fs.access(this.cliPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize a repository
   */
  async init(options: InitOptions): Promise<CLICommandResult> {
    try {
      await fs.access(options.repoPath);
    } catch {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: `Repository path does not exist: ${options.repoPath}`,
      };
    }

    const args = [options.repoPath];
    const storagePath = this.toStoragePath(options.dbPath);
    args.push('--storage', storagePath);
    if (options.force) {
      args.push('--force');
    }
    const result = await this.execute('init', args);
    if (result.success) {
      await fs.mkdir(path.join(options.repoPath, '.javakg'), { recursive: true });
      await fs.writeFile(
        path.join(options.repoPath, '.javakg/config.json'),
        JSON.stringify(
          {
            repo: options.repoPath,
            dbPath: storagePath,
          },
          null,
          2,
        ),
      );
    }
    return result;
  }

  /**
   * Index a repository
   */
  async index(options: IndexOptions): Promise<CLICommandResult> {
    const args: string[] = [];

    const storagePath = this.toStoragePath(options.dbPath);
    args.push('--storage', storagePath);
    if (options.verbose) {
      args.push('--verbose');
    }

    return this.execute('index', args);
  }

  /**
   * Query the knowledge graph
   */
  async query(options: QueryOptions): Promise<CLICommandResult> {
    const args = [options.searchTerm];

    const storagePath = this.toStoragePath(options.dbPath);
    args.push('--storage', storagePath);
    if (options.limit) {
      args.push('--limit', `${options.limit}`);
    }

    const result = await this.execute('query', args);
    if (result.success && options.type) {
      const typedLines = result.stdout
        .split('\n')
        .filter((line) => line.includes(`[${options.type}]`));
      return {
        ...result,
        stdout: typedLines.length > 0 ? typedLines.join('\n') : 'No results.',
      };
    }
    return result;
  }

  /**
   * Get help
   */
  async help(command?: string): Promise<CLICommandResult> {
    if (command) {
      return this.execute('help', [command]);
    }
    return this.execute('help', []);
  }

  /**
   * Get version
   */
  async version(): Promise<CLICommandResult> {
    return this.execute('version', []);
  }

  /**
   * Parse query results from stdout
   */
  parseQueryResults(stdout: string): Array<{
    type: string;
    name: string;
    qualifiedName?: string;
    file?: string;
    line?: number;
  }> {
    const results: Array<{
      type: string;
      name: string;
      qualifiedName?: string;
      file?: string;
      line?: number;
    }> = [];

    const lines = stdout.split('\n');
    for (const line of lines) {
      // Try to parse JSON lines
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed.type && parsed.name) {
          results.push(parsed);
        }
      } catch {
        // Try to match common output format
        const match = line.match(/^\d+\.\s+([^\[]+)\s+\[(\w+)\]\s+(.+?)\s+score=/);
        if (match) {
          results.push({
            name: match[1].trim(),
            type: match[2],
            file: match[3].trim(),
          });
        }
      }
    }

    return results;
  }

  /**
   * Parse statistics from stdout
   */
  parseStatistics(stdout: string): {
    filesIndexed?: number;
    classesFound?: number;
    methodsFound?: number;
    fieldsFound?: number;
    totalTime?: number;
  } {
    const stats: any = {};

    const patterns = [
      { key: 'filesIndexed', regex: /Indexed files:\s*(\d+)/i },
      { key: 'filesIndexed', regex: /(\d+)\s*files/ },
      { key: 'classesFound', regex: /(\d+)\s*classes/ },
      { key: 'methodsFound', regex: /(\d+)\s*methods/ },
      { key: 'fieldsFound', regex: /(\d+)\s*fields/ },
      { key: 'totalTime', regex: /(\d+(?:\.\d+)?)\s*(?:seconds?|ms|milliseconds?)/ },
    ];

    for (const pattern of patterns) {
      const match = stdout.match(pattern.regex);
      if (match) {
        const value = pattern.key === 'totalTime'
          ? parseFloat(match[1])
          : parseInt(match[1], 10);
        stats[pattern.key] = value;
      }
    }

    return stats;
  }

  /**
   * Check if output contains error
   */
  hasError(stdout: string, stderr: string): boolean {
    const errorPatterns = [
      /error/i,
      /failed/i,
      /exception/i,
      /stack trace/i,
      /unknown command/i,
      /requires </i,
      /enoent/i,
      /no such file/i,
      /does not exist/i,
    ];

    const combined = stdout + '\n' + stderr;
    return errorPatterns.some(pattern => pattern.test(combined));
  }

  /**
   * Extract error message from output
   */
  extractError(stdout: string, stderr: string): string | null {
    const errorPatterns = [
      /error:\s*(.+)/i,
      /failed:\s*(.+)/i,
      /exception:\s*(.+)/i,
    ];

    const combined = stdout + '\n' + stderr;
    for (const pattern of errorPatterns) {
      const match = combined.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Wait for indexing to complete
   */
  async waitForIndexing(options: IndexOptions, timeout = 60000): Promise<CLICommandResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.index(options);
      if (result.success) {
        return result;
      }

      // Check if it's still running (no immediate error)
      if (!this.hasError(result.stdout, result.stderr)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        return result;
      }
    }

    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: `Indexing timed out after ${timeout}ms`,
    };
  }

  /**
   * Get database path from config
   */
  async getDbPath(repoPath: string): Promise<string | null> {
    try {
      const configPath = path.join(repoPath, '.javakg/config.json');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      return config.dbPath || this.lastStoragePath || null;
    } catch {
      return this.lastStoragePath;
    }
  }

  /**
   * Check if repository is initialized
   */
  async isInitialized(repoPath: string): Promise<boolean> {
    try {
      const configPath = path.join(repoPath, '.javakg/config.json');
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if database exists
   */
  async databaseExists(dbPath: string): Promise<boolean> {
    try {
      await fs.access(dbPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get database size
   */
  async getDatabaseSize(dbPath: string): Promise<number> {
    try {
      const stat = await fs.stat(dbPath);
      return stat.size;
    } catch {
      return 0;
    }
  }
}
