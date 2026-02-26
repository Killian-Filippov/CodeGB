const buildMethodIndex = (files) => {
    const index = new Map();
    for (const file of files) {
        for (const method of file.methods) {
            const list = index.get(method.name) ?? [];
            list.push(method);
            index.set(method.name, list);
        }
    }
    return index;
};
const pickCallee = (candidates, callerClassName) => {
    const sameClass = candidates.find((candidate) => candidate.className === callerClassName);
    if (sameClass) {
        return sameClass;
    }
    return candidates[0];
};
export const processCalls = (graph, files) => {
    const methodIndex = buildMethodIndex(files);
    for (const file of files) {
        for (const call of file.pendingCalls) {
            const candidates = methodIndex.get(call.calleeName);
            if (!candidates || candidates.length === 0) {
                continue;
            }
            const callee = pickCallee(candidates, call.callerClassName);
            if (call.callerMethodId === callee.id) {
                continue;
            }
            graph.addRelationship({
                id: `${call.callerMethodId}->${callee.id}:CALLS:${call.calleeName}:${call.line}`,
                sourceId: call.callerMethodId,
                targetId: callee.id,
                type: 'CALLS',
                confidence: 0.9,
                reason: 'name-resolution',
                line: call.line,
            });
        }
    }
};
//# sourceMappingURL=call-processor.js.map