export interface CliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export declare const runCli: (argv: string[]) => Promise<CliResult>;
//# sourceMappingURL=index.d.ts.map