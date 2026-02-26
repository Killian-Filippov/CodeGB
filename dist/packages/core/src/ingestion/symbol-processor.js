import path from 'node:path';
const toRelPath = (repoPath, filePath) => {
    const rel = path.relative(repoPath, filePath);
    return rel || path.basename(filePath);
};
const typeToLabel = (kind) => {
    return kind;
};
const buildTypeId = (type) => {
    return `${type.kind.toLowerCase()}:${type.qualifiedName}`;
};
const parseParameterTypes = (parameters) => {
    return parameters
        .map((param) => param.split(/\s+/)[0] ?? '')
        .map((entry) => entry.trim())
        .filter(Boolean);
};
export const processSymbolsForFile = (graph, parsed, repoPath, projectNodeId) => {
    const relFilePath = toRelPath(repoPath, parsed.filePath);
    const packageName = parsed.packageName || 'default';
    const packageNodeId = `package:${packageName}`;
    graph.addNode({
        id: packageNodeId,
        label: 'Package',
        properties: {
            name: packageName,
            qualifiedName: packageName,
            packageName,
            filePath: '',
        },
    });
    graph.addRelationship({
        id: `${projectNodeId}->${packageNodeId}:CONTAINS`,
        sourceId: projectNodeId,
        targetId: packageNodeId,
        type: 'CONTAINS',
        confidence: 1,
        reason: 'file-package',
    });
    const fileNodeId = `file:${relFilePath}`;
    graph.addNode({
        id: fileNodeId,
        label: 'File',
        properties: {
            name: path.basename(relFilePath),
            qualifiedName: relFilePath,
            packageName,
            filePath: relFilePath,
        },
    });
    graph.addRelationship({
        id: `${packageNodeId}->${fileNodeId}:CONTAINS`,
        sourceId: packageNodeId,
        targetId: fileNodeId,
        type: 'CONTAINS',
        confidence: 1,
        reason: 'package-file',
    });
    const typeRefs = [];
    const methodRefs = [];
    const pendingCalls = [];
    const pendingInheritance = [];
    for (const type of parsed.types) {
        const typeNodeId = buildTypeId(type);
        typeRefs.push({
            id: typeNodeId,
            name: type.name,
            kind: type.kind,
            packageName,
            filePath: relFilePath,
        });
        graph.addNode({
            id: typeNodeId,
            label: typeToLabel(type.kind),
            properties: {
                name: type.name,
                qualifiedName: type.qualifiedName,
                packageName,
                filePath: relFilePath,
                startLine: type.startLine,
                endLine: type.endLine,
                modifiers: type.modifiers,
                superClass: type.superClass,
                interfaces: type.interfaces,
            },
        });
        graph.addRelationship({
            id: `${fileNodeId}->${typeNodeId}:CONTAINS`,
            sourceId: fileNodeId,
            targetId: typeNodeId,
            type: 'CONTAINS',
            confidence: 1,
            reason: 'file-type',
        });
        pendingInheritance.push({
            sourceTypeId: typeNodeId,
            superClass: type.superClass,
            interfaces: type.interfaces,
        });
        for (const field of type.fields) {
            const fieldId = `field:${type.qualifiedName}.${field.name}`;
            graph.addNode({
                id: fieldId,
                label: 'Field',
                properties: {
                    name: field.name,
                    qualifiedName: `${type.qualifiedName}.${field.name}`,
                    packageName,
                    className: type.name,
                    filePath: relFilePath,
                    startLine: field.startLine,
                    endLine: field.endLine,
                    modifiers: field.modifiers,
                    type: field.type,
                    isStatic: field.modifiers.includes('static'),
                },
            });
            graph.addRelationship({
                id: `${typeNodeId}->${fieldId}:CONTAINS`,
                sourceId: typeNodeId,
                targetId: fieldId,
                type: 'CONTAINS',
                confidence: 1,
                reason: 'type-field',
            });
        }
        for (const method of type.methods) {
            const signature = `${method.name}(${parseParameterTypes(method.parameters).join(',')})`;
            const methodId = `method:${type.qualifiedName}.${signature}`;
            methodRefs.push({
                id: methodId,
                name: method.name,
                className: type.name,
                typeId: typeNodeId,
                filePath: relFilePath,
            });
            graph.addNode({
                id: methodId,
                label: method.isConstructor ? 'Constructor' : 'Method',
                properties: {
                    name: method.name,
                    qualifiedName: `${type.qualifiedName}.${signature}`,
                    signature,
                    packageName,
                    className: type.name,
                    filePath: relFilePath,
                    startLine: method.startLine,
                    endLine: method.endLine,
                    modifiers: method.modifiers,
                    returnType: method.returnType,
                    parameters: method.parameters,
                    isStatic: method.modifiers.includes('static'),
                },
            });
            graph.addRelationship({
                id: `${typeNodeId}->${methodId}:CONTAINS`,
                sourceId: typeNodeId,
                targetId: methodId,
                type: 'CONTAINS',
                confidence: 1,
                reason: 'type-method',
            });
            for (const callee of method.calls) {
                pendingCalls.push({
                    callerMethodId: methodId,
                    callerClassName: type.name,
                    calleeName: callee,
                    line: method.startLine,
                });
            }
        }
    }
    return {
        fileNodeId,
        filePath: relFilePath,
        packageName,
        imports: parsed.imports,
        types: typeRefs,
        methods: methodRefs,
        pendingCalls,
        pendingInheritance,
    };
};
//# sourceMappingURL=symbol-processor.js.map