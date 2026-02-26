import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createKnowledgeGraph } from '../src/graph/graph.ts';
import { searchByKeyword } from '../src/search/keyword-search.ts';

test('searchByKeyword ranks relevant Java symbols', () => {
  const graph = createKnowledgeGraph();

  graph.addNode({
    id: 'method:charge',
    label: 'Method',
    properties: {
      name: 'chargePayment',
      qualifiedName: 'com.acme.PaymentProcessor.chargePayment',
      className: 'PaymentProcessor',
      filePath: 'PaymentProcessor.java',
      returnType: 'void',
    },
  });

  graph.addNode({
    id: 'method:audit',
    label: 'Method',
    properties: {
      name: 'auditTrail',
      qualifiedName: 'com.acme.AuditService.auditTrail',
      className: 'AuditService',
      filePath: 'AuditService.java',
      returnType: 'void',
    },
  });

  const results = searchByKeyword(graph, 'charge payment', 5);
  assert.equal(results[0]?.node.properties.name, 'chargePayment');
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});
