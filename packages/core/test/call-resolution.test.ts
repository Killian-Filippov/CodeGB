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

test('processCalls resolves constructor call sites and falls back when static-import owner is missing', () => {
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
  assert.equal(callEdges.length, 2);
  assert.equal(callEdges[0]?.targetId, ctor.id);
  assert.equal(callEdges[1]?.targetId, target.id);
});

test('processCalls resolves explicit static member import with unique owner+arity match', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.app.Caller.call',
    name: 'call',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.call',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
  });
  const staticImported = makeMethod({
    id: 'method:com.lib.MathUtil.max',
    name: 'max',
    className: 'MathUtil',
    qualifiedName: 'com.lib.MathUtil.max',
    packageName: 'com.lib',
    parameterCount: 2,
  });
  const otherTarget = makeMethod({
    id: 'method:com.app.Util.max',
    name: 'max',
    className: 'Util',
    qualifiedName: 'com.app.Util.max',
    packageName: 'com.app',
    parameterCount: 2,
  });

  const extraction = makeExtraction(
    [caller, staticImported, otherTarget],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'max',
        argCount: 2,
        imports: ['static com.lib.MathUtil.max'],
        source: 'tree-sitter',
        line: 16,
      },
    ],
    { imports: ['static com.lib.MathUtil.max'] },
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.ok(rel);
  assert.equal(rel?.targetId, staticImported.id);
  assert.equal(rel?.confidence, 0.9);
  assert.match(rel?.reason ?? '', /strategy=static-import-owner-arity-exact/);
});

test('processCalls resolves static wildcard import with unique owner+arity match', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.app.Caller.call',
    name: 'call',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.call',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
  });
  const wildcardImported = makeMethod({
    id: 'method:com.lib.MathUtil.abs',
    name: 'abs',
    className: 'MathUtil',
    qualifiedName: 'com.lib.MathUtil.abs',
    packageName: 'com.lib',
    parameterCount: 1,
  });
  const otherTarget = makeMethod({
    id: 'method:com.other.Other.abs',
    name: 'abs',
    className: 'Other',
    qualifiedName: 'com.other.Other.abs',
    packageName: 'com.other',
    parameterCount: 1,
  });

  const extraction = makeExtraction(
    [caller, wildcardImported, otherTarget],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'abs',
        argCount: 1,
        imports: ['static com.lib.MathUtil.*'],
        source: 'tree-sitter',
        line: 18,
      },
    ],
    { imports: ['static com.lib.MathUtil.*'] },
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.ok(rel);
  assert.equal(rel?.targetId, wildcardImported.id);
  assert.equal(rel?.confidence, 0.9);
  assert.match(rel?.reason ?? '', /strategy=static-import-owner-arity-exact/);
});

test('processCalls does not resolve static wildcard imports when owner+arity remains ambiguous', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.app.Caller.call',
    name: 'call',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.call',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
  });
  const fromA = makeMethod({
    id: 'method:com.lib.A.merge',
    name: 'merge',
    className: 'A',
    qualifiedName: 'com.lib.A.merge',
    packageName: 'com.lib',
    parameterCount: 1,
  });
  const fromB = makeMethod({
    id: 'method:com.lib.B.merge',
    name: 'merge',
    className: 'B',
    qualifiedName: 'com.lib.B.merge',
    packageName: 'com.lib',
    parameterCount: 1,
  });

  const extraction = makeExtraction(
    [caller, fromA, fromB],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'merge',
        argCount: 1,
        imports: ['static com.lib.A.*', 'static com.lib.B.*'],
        source: 'tree-sitter',
        line: 22,
      },
    ],
    { imports: ['static com.lib.A.*', 'static com.lib.B.*'] },
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.equal(rel, undefined);
});


test('processCalls falls back to regular resolution when static import lookup misses', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.app.Caller.invoke',
    name: 'invoke',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.invoke',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
  });
  const sameClassTarget = makeMethod({
    id: 'method:com.app.Caller.helper',
    name: 'helper',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.helper',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
    parameterCount: 0,
  });
  const staticImported = makeMethod({
    id: 'method:com.lib.MathUtil.helper',
    name: 'helper',
    className: 'MathUtil',
    qualifiedName: 'com.lib.MathUtil.helper',
    packageName: 'com.lib',
    parameterCount: 0,
  });

  const extraction = makeExtraction(
    [caller, sameClassTarget, staticImported],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'helper',
        argCount: 0,
        imports: ['static java.lang.Math.*'],
        source: 'tree-sitter',
        line: 26,
      },
    ],
    { imports: ['static java.lang.Math.*'] },
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.ok(rel);
  assert.equal(rel?.targetId, sameClassTarget.id);
  assert.equal(rel?.confidence, 0.85);
  assert.match(rel?.reason ?? '', /strategy=name-arity-same-class/);
});

test('processCalls falls back when static import owner only has wrong-arity overloads', () => {
  const graph = createKnowledgeGraph();
  const caller = makeMethod({
    id: 'method:com.app.Caller.invoke',
    name: 'invoke',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.invoke',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
  });
  const sameClassTarget = makeMethod({
    id: 'method:com.app.Caller.helper',
    name: 'helper',
    className: 'Caller',
    qualifiedName: 'com.app.Caller.helper',
    packageName: 'com.app',
    filePath: 'src/Caller.java',
    parameterCount: 0,
  });
  const staticImportedWrongArity = makeMethod({
    id: 'method:com.lib.MathUtil.helper',
    name: 'helper',
    className: 'MathUtil',
    qualifiedName: 'com.lib.MathUtil.helper',
    packageName: 'com.lib',
    parameterCount: 1,
  });

  const extraction = makeExtraction(
    [caller, sameClassTarget, staticImportedWrongArity],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'helper',
        argCount: 0,
        imports: ['static com.lib.MathUtil.*'],
        source: 'tree-sitter',
        line: 27,
      },
    ],
    { imports: ['static com.lib.MathUtil.*'] },
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.ok(rel);
  assert.equal(rel?.targetId, sameClassTarget.id);
  assert.equal(rel?.confidence, 0.85);
  assert.match(rel?.reason ?? '', /strategy=name-arity-same-class/);
});

test('processCalls skips unsupported call sites even when candidates exist', () => {
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
    id: 'method:com.app.Util.run',
    name: 'run',
    className: 'Util',
    qualifiedName: 'com.app.Util.run',
    packageName: 'com.app',
    parameterCount: 0,
  });

  const extraction = makeExtraction(
    [caller, target],
    [
      {
        callerMethodId: caller.id,
        callerClassName: 'Caller',
        callerFilePath: 'src/Caller.java',
        callerPackageName: 'com.app',
        simpleName: 'run',
        argCount: 0,
        imports: [],
        source: 'tree-sitter',
        line: 27,
        unsupportedReason: 'unsupported/static import',
      },
    ],
  );

  processCalls(graph, [extraction]);
  const rel = graph.relationships.find((item) => item.type === 'CALLS');
  assert.equal(rel, undefined);
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
