import fs from 'node:fs/promises';
import path from 'node:path';
import { createKnowledgeGraph } from '../graph/graph.ts';
import { parseJavaSource } from '../parser/ast-extractor.ts';
import { KuzuAdapter } from '../storage/kuzu-adapter.ts';
import { processCalls } from './call-processor.ts';
import { processImports } from './import-processor.ts';
import { processInheritance } from './inheritance-processor.ts';
import { processSymbolsForFile } from './symbol-processor.ts';
const isJavaFile = (filePath) => filePath.endsWith('.java');
const walk = async (dirPath) => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];
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
export const runPipelineFromRepo = async (options) => {
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
//# sourceMappingURL=pipeline.js.map