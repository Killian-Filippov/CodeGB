import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseJavaSource } from '../src/parser/ast-extractor.ts';
import { loadJavaParserRuntime } from '../src/parser/parser-loader.ts';
import { parseJavaSourceWithTreeSitter } from '../src/parser/tree-sitter-extractor.ts';

const JAVA_SOURCE = `
package com.acme.service;

import java.util.List;
import com.acme.model.Invoice;

public class PaymentProcessor extends BaseService implements Runnable, Auditable {
  private String gateway;

  public PaymentProcessor() {
  }

  public void charge(Invoice invoice) {
    processPayment();
    logCharge();
  }

  private void logCharge() {
  }

  public void run() {
    charge(null);
  }
}
`;

test('parseJavaSource extracts package/imports/types/methods/fields/calls', () => {
  const parsed = parseJavaSource(JAVA_SOURCE, 'src/main/java/com/acme/service/PaymentProcessor.java');

  assert.equal(parsed.packageName, 'com.acme.service');
  assert.deepEqual(parsed.imports, ['java.util.List', 'com.acme.model.Invoice']);
  assert.equal(parsed.types.length, 1);

  const clazz = parsed.types[0];
  assert.equal(clazz.kind, 'Class');
  assert.equal(clazz.name, 'PaymentProcessor');
  assert.equal(clazz.superClass, 'BaseService');
  assert.deepEqual(clazz.interfaces, ['Runnable', 'Auditable']);

  assert.equal(clazz.fields.length, 1);
  assert.equal(clazz.fields[0]?.name, 'gateway');
  assert.equal(clazz.fields[0]?.type, 'String');

  const methodNames = clazz.methods.map((m) => m.name).sort();
  assert.deepEqual(methodNames, ['PaymentProcessor', 'charge', 'logCharge', 'run']);

  const chargeMethod = clazz.methods.find((m) => m.name === 'charge');
  assert.ok(chargeMethod);
  const callNames = chargeMethod?.calls.map((call) => call.simpleName).sort();
  assert.deepEqual(callNames, ['logCharge', 'processPayment']);
  assert.ok(chargeMethod?.calls.every((call) => Number.isInteger(call.argCount)));
  assert.ok(chargeMethod?.calls.every((call) => Number.isInteger(call.line) && call.line > 0));

  const runMethod = clazz.methods.find((m) => m.name === 'run');
  assert.ok(runMethod);
  const runCall = runMethod?.calls.find((call) => call.simpleName === 'charge');
  assert.equal(runCall?.argCount, 1);
});

test('parseJavaSourceWithTreeSitter emits constructor call sites for new/this/super', async (t) => {
  const runtime = await loadJavaParserRuntime();
  if (runtime.engine !== 'tree-sitter') {
    t.skip('tree-sitter runtime unavailable');
    return;
  }

  const source = `
package com.acme.ctor;

class Parent {
  Parent(int v) {}
}

class Child extends Parent {
  Child() {
    this(1);
  }

  Child(int n) {
    super(n);
    Parent p = new Parent(n);
  }
}
`;

  const parsed = await parseJavaSourceWithTreeSitter(source, 'src/main/java/com/acme/ctor/Child.java');
  const child = parsed.types.find((item) => item.name === 'Child');
  assert.ok(child);
  const noArgCtor = child?.methods.find((m) => m.name === 'Child' && m.parameters.length === 0);
  const oneArgCtor = child?.methods.find((m) => m.name === 'Child' && m.parameters.length === 1);
  assert.ok(noArgCtor);
  assert.ok(oneArgCtor);

  const thisCall = noArgCtor?.calls.find((call) => call.simpleName === 'Child');
  assert.ok(thisCall);
  assert.equal(thisCall?.argCount, 1);
  assert.equal(thisCall?.qualifier, 'com.acme.ctor.Child');
  assert.equal(thisCall?.unsupportedReason, undefined);

  const superCall = oneArgCtor?.calls.find((call) => call.simpleName === 'Parent' && call.qualifier === undefined);
  assert.ok(superCall);
  assert.equal(superCall?.argCount, 1);
  assert.equal(superCall?.unsupportedReason, undefined);

  const newCall = oneArgCtor?.calls.find((call) => call.simpleName === 'Parent' && call.qualifier === 'Parent');
  assert.ok(newCall);
  assert.equal(newCall?.argCount, 1);
  assert.equal(newCall?.unsupportedReason, undefined);
});
