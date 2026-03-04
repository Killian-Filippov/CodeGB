import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createKnowledgeGraph } from '../src/graph/graph.ts';
import { processCalls } from '../src/ingestion/call-processor.ts';
import type { FileExtraction, MethodRef } from '../src/ingestion/symbol-processor.ts';

const makeMethod = (overrides: Partial<MethodRef> & Pick<MethodRef, 'id' | 'name' | 'className'>): MethodRef => {
  return {
    id: overrides.id,
    name: overrides.name,
    className: overrides.className,
    typeId: overrides.typeId ?? 'type:default',
    filePath: overrides.filePath ?? 'src/Default.java',
    packageName: overrides.packageName ?? 'com.acme',
    qualifiedName: overrides.qualifiedName ?? `com.acme.${overrides.className}.${overrides.name}`,
    signature: overrides.signature ?? `${overrides.name}()`,
    parameterCount: overrides.parameterCount ?? 0,
  };
};

const makeExtraction = (
  methods: MethodRef[],
  pendingCalls: FileExtraction['pendingCalls'],
  options?: Partial<FileExtraction>,
): FileExtraction => ({
  fileNodeId: options?.fileNodeId ?? 'file:src/Caller.java',
  filePath: options?.filePath ?? 'src/Caller.java',
  packageName: options?.packageName ?? 'com.acme',
  imports: options?.imports ?? [],
  types: options?.types ?? [],
  methods,
  pendingCalls,
  pendingInheritance: [],
});

test('processCalls prefers qualifiedName exact match with highest confidence', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.demo.Caller.call',
    name: 'call',
    className: 'Caller',
    qualifiedName: 'com.demo.Caller.call',
    packageName: 'com.demo',
    filePath: 'src/Caller.java',
  });
  const inA = makeMethod({
    id: 'method:com.demo.A.work',
    name: 'work',
    className: 'A',
    qualifiedName: 'com.demo.A.work',
    packageName: 'com.demo',
    parameterCount: 1,
  });
  const inB = makeMethod({
    id: 'method:com.demo.B.work',
    name: 'work',
    className: 'B',
    qualifiedName: 'com.demo.B.work',
    packageName: 'com.demo',
    parameterCount: 1,
  });

  const extraction = makeExtraction(
    [caller, inA, inB],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.demo',
        simpleName: 'work',
        qualifiedNameHint: 'com.demo.B.work',
        argCount: 1,
        imports: [],
        source: 'tree-sitter',
        line: 12,
      },
    ],
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.ok(rel);
  assert.equal(rel?.targetId, inB.id);
  assert.equal(rel?.confidence, 0.95);
  assert.match(rel?.reason ?? '', /strategy=qualifiedName-exact/);
});

test('processCalls applies arity+same-class over other candidates', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.acme.Worker.call',
    name: 'call',
    className: 'Worker',
    qualifiedName: 'com.acme.Worker.call',
    packageName: 'com.acme',
    filePath: 'src/Worker.java',
  });
  const sameClass = makeMethod({
    id: 'method:com.acme.Worker.run',
    name: 'run',
    className: 'Worker',
    qualifiedName: 'com.acme.Worker.run',
    packageName: 'com.acme',
    parameterCount: 2,
    filePath: 'src/Worker.java',
  });
  const otherClass = makeMethod({
    id: 'method:com.acme.Helper.run',
    name: 'run',
    className: 'Helper',
    qualifiedName: 'com.acme.Helper.run',
    packageName: 'com.acme',
    parameterCount: 2,
    filePath: 'src/Helper.java',
  });

  const extraction = makeExtraction(
    [caller, sameClass, otherClass],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Worker',
        callerFilePath: 'src/Worker.java',
        callerPackageName: 'com.acme',
        simpleName: 'run',
        argCount: 2,
        imports: [],
        source: 'tree-sitter',
        line: 21,
      },
    ],
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.ok(rel);
  assert.equal(rel?.targetId, sameClass.id);
  assert.equal(rel?.confidence, 0.85);
  assert.match(rel?.reason ?? '', /strategy=name-arity-same-class/);
});

test('processCalls uses import scope to disambiguate same-name calls', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.app.Caller.call',
    name: 'call',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.call',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
  });
  const importedTarget = makeMethod({
    id: 'method:com.lib.Target.exec',
    name: 'exec',
    className: 'Target',
    qualifiedName: 'com.lib.Target.exec',
    packageName: 'com.lib',
    parameterCount: 0,
  });
  const outOfScopeTarget = makeMethod({
    id: 'method:com.other.Target.exec',
    name: 'exec',
    className: 'Target',
    qualifiedName: 'com.other.Target.exec',
    packageName: 'com.other',
    parameterCount: 0,
  });

  const extraction = makeExtraction(
    [caller, importedTarget, outOfScopeTarget],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'exec',
        argCount: 0,
        imports: ['com.lib.Target'],
        source: 'tree-sitter',
        line: 30,
      },
    ],
    { imports: ['com.lib.Target'] },
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.ok(rel);
  assert.equal(rel?.targetId, importedTarget.id);
  assert.equal(rel?.confidence, 0.75);
  assert.match(rel?.reason ?? '', /strategy=name-arity-import-scope/);
});

test('processCalls resolves qualified constructor call with qualifiedName-exact', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.app.Caller.build',
    name: 'build',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.build',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
  });
  const ctor = makeMethod({
    id: 'method:com.acme.Factory.Factory(String)',
    name: 'Factory',
    className: 'Factory',
    qualifiedName: 'com.acme.Factory.Factory',
    packageName: 'com.acme',
    parameterCount: 1,
    filePath: 'src/Factory.java',
  });

  const extraction = makeExtraction(
    [caller, ctor],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'Factory',
        qualifiedNameHint: 'com.acme.Factory.Factory',
        argCount: 1,
        imports: [],
        source: 'tree-sitter',
        line: 40,
      },
    ],
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.ok(rel);
  assert.equal(rel?.targetId, ctor.id);
  assert.equal(rel?.confidence, 0.95);
  assert.match(rel?.reason ?? '', /strategy=qualifiedName-exact/);
});

test('processCalls resolves constructor call sites and still skips static-import call names', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.app.Caller.call',
    name: 'call',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.call',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
  });
  const target = makeMethod({
    id: 'method:com.app.Util.max',
    name: 'max',
    className: 'Util',
    qualifiedName: 'com.app.Util.max',
    packageName: 'com.app',
    parameterCount: 2,
  });
  const ctor = makeMethod({
    id: 'method:com.app.Caller.Caller(int)',
    name: 'Caller',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.Caller',
    packageName: 'com.app',
    parameterCount: 1,
  });

  const extraction = makeExtraction(
    [caller, target, ctor],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'Caller',
        qualifiedNameHint: 'com.app.Caller.Caller',
        argCount: 1,
        imports: [],
        source: 'tree-sitter',
        line: 8,
      },
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'max',
        argCount: 2,
        imports: ['static java.lang.Math.max'],
        source: 'tree-sitter',
        line: 9,
      },
    ],
    { imports: ['static java.lang.Math.max'] },
  );

  processCalls(graph, [extraction]);
  const callEdges = graph.relationships.filter((item) => item.type === 'CALLS');
  assert.equal(callEdges.length, 1);
  assert.equal(callEdges[0]?.targetId, ctor.id);
});

test('processCalls resolves this/super constructor calls', () => {
  const graph = createKnowledgeGraph();
  const childCtor = makeMethod({
    id: 'method:com.demo.Child.Child()',
    name: 'Child',
    className: 'Child',
    qualifiedName: 'com.demo.Child.Child',
    packageName: 'com.demo',
    parameterCount: 0,
    filePath: 'src/Child.java',
  });
  const childCtorWithArg = makeMethod({
    id: 'method:com.demo.Child.Child(int)',
    name: 'Child',
    className: 'Child',
    qualifiedName: 'com.demo.Child.Child',
    packageName: 'com.demo',
    parameterCount: 1,
    filePath: 'src/Child.java',
  });
  const parentCtor = makeMethod({
    id: 'method:com.demo.Parent.Parent(int)',
    name: 'Parent',
    className: 'Parent',
    qualifiedName: 'com.demo.Parent.Parent',
    packageName: 'com.demo',
    parameterCount: 1,
    filePath: 'src/Parent.java',
  });

  const extraction = makeExtraction(
    [childCtor, childCtorWithArg, parentCtor],
    [
      {
        callerMethodId: childCtor.id,
        callerClassName: 'Child',
        callerFilePath: 'src/Child.java',
        callerPackageName: 'com.demo',
        simpleName: 'Child',
        qualifiedNameHint: 'com.demo.Child.Child',
        argCount: 1,
        imports: [],
        source: 'tree-sitter',
        line: 10,
      },
      {
        callerMethodId: childCtorWithArg.id,
        callerClassName: 'Child',
        callerFilePath: 'src/Child.java',
        callerPackageName: 'com.demo',
        simpleName: 'Parent',
        argCount: 1,
        imports: [],
        source: 'tree-sitter',
        line: 14,
      },
    ],
    { filePath: 'src/Child.java', packageName: 'com.demo' },
  );

  processCalls(graph, [extraction]);
  const thisEdge = graph.relationships.find((item) => item.line === 10);
  const superEdge = graph.relationships.find((item) => item.line === 14);
  assert.ok(thisEdge);
  assert.ok(superEdge);
  assert.equal(thisEdge?.targetId, childCtorWithArg.id);
  assert.equal(thisEdge?.confidence, 0.95);
  assert.equal(superEdge?.targetId, parentCtor.id);
  assert.equal(superEdge?.confidence, 0.75);
});
