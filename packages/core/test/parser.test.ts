import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseJavaSource } from '../src/parser/ast-extractor.ts';

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
  assert.deepEqual(chargeMethod?.calls.sort(), ['logCharge', 'processPayment']);
});
