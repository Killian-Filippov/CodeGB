import fs from 'node:fs/promises';
import path from 'node:path';
export const runInitCommand = async (args) => {
    await fs.mkdir(args.storagePath, { recursive: true });
    const config = {
        repoPath: path.resolve(args.repoPath),
        initializedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(args.storagePath, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
    return `Initialized JavaKG at ${args.storagePath}`;
};
//# sourceMappingURL=init.js.map