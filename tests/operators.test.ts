import { describe, expect, it } from 'vitest';
import {
  ALL_OPERATORS,
  generateMutants,
  type CalmArchitecture,
} from '../src/index.js';

function createFixtureSeed(): CalmArchitecture {
  return {
    $schema: 'https://calm.finos.org/release/1.3/meta/calm.json',
    'unique-id': 'fixture-arch',
    name: 'Fixture Architecture',
    controls: {
      'global-audit': {
        description: 'Global audit logging',
        requirements: [{ 'requirement-url': 'https://example.com/req/audit' }],
      },
    },
    nodes: [
      {
        'unique-id': 'client-actor',
        'node-type': 'actor',
        name: 'Client User',
        description: 'External user',
      },
      {
        'unique-id': 'api-gateway',
        'node-type': 'service',
        name: 'API Gateway',
        description: 'Gateway',
        details: { tier: 'edge' },
        interfaces: [
          {
            'unique-id': 'api-https',
            'definition-url': 'https://calm.finos.org/release/1.3/meta/interface.json#/defs/interface-type',
            config: { port: 443 },
          },
        ],
        controls: {
          'auth-control': {
            description: 'OIDC auth',
            requirements: [{ 'requirement-url': 'https://example.com/req/auth' }],
          },
        },
      },
      {
        'unique-id': 'core-db',
        'node-type': 'database',
        name: 'Core DB',
        description: 'Primary store',
        interfaces: [{ 'unique-id': 'db-tls' }],
      },
      {
        'unique-id': 'prod-vpc',
        'node-type': 'network',
        name: 'Prod VPC',
        description: 'Isolated zone',
      },
    ],
    relationships: [
      {
        'unique-id': 'gateway-to-db',
        description: 'Encrypted DB connection',
        protocol: 'HTTPS',
        'relationship-type': {
          connects: {
            source: { node: 'api-gateway' },
            destination: { node: 'core-db', interfaces: ['db-tls'] },
          },
        },
        controls: {
          mtls: {
            description: 'Mutual TLS',
            requirements: [{ 'requirement-url': 'https://example.com/req/mtls' }],
          },
        },
      },
      {
        'unique-id': 'deploy-zone',
        description: 'Deployed in prod VPC',
        'relationship-type': {
          'deployed-in': {
            container: 'prod-vpc',
            nodes: ['api-gateway', 'core-db'],
          },
        },
      },
    ],
  };
}

describe('mutation operators', () => {
  it('generates mutants across all 7 operators without mutating the seed', () => {
    const seed = createFixtureSeed();
    const snapshot = JSON.stringify(seed);

    const mutants = generateMutants(seed);
    expect(JSON.stringify(seed)).toBe(snapshot);
    expect(mutants.length).toBeGreaterThan(10);

    const operatorsPresent = new Set(mutants.map((m) => m.operator));
    for (const op of ALL_OPERATORS) {
      expect(operatorsPresent.has(op)).toBe(true);
    }
  });

  it('control-stripper removes controls from nodes and relationships', () => {
    const seed = createFixtureSeed();
    const mutants = generateMutants(seed, ['control-stripper']);

    expect(
      mutants.some(
        (m) =>
          m.id === 'control-strip-node-api-gateway' &&
          m.architecture.nodes.find((n) => n['unique-id'] === 'api-gateway')?.controls === undefined
      )
    ).toBe(true);
    expect(
      mutants.some(
        (m) =>
          m.id === 'control-strip-rel-gateway-to-db' &&
          m.architecture.relationships.find((r) => r['unique-id'] === 'gateway-to-db')?.controls === undefined
      )
    ).toBe(true);
  });

  it('protocol-downgrader downgrades HTTPS to HTTP and removes protocol', () => {
    const seed = createFixtureSeed();
    const mutants = generateMutants(seed, ['protocol-downgrader']);

    const downgraded = mutants.find((m) => m.id === 'protocol-downgrade-gateway-to-db-http');
    expect(downgraded).toBeDefined();
    expect(downgraded?.architecture.relationships[0].protocol).toBe('HTTP');

    const stripped = mutants.find((m) => m.id === 'protocol-remove-gateway-to-db');
    expect(stripped).toBeDefined();
    expect(stripped?.architecture.relationships[0].protocol).toBeUndefined();
  });

  it('rogue-edge-injector injects unguarded connects relationships', () => {
    const seed = createFixtureSeed();
    const mutants = generateMutants(seed, ['rogue-edge-injector']);

    expect(mutants.length).toBeGreaterThanOrEqual(1);
    for (const m of mutants) {
      expect(m.architecture.relationships.length).toBe(seed.relationships.length + 1);
      const injected = m.architecture.relationships[m.architecture.relationships.length - 1];
      expect(injected['unique-id']).toMatch(/^rogue-/);
      expect(injected.controls).toBeUndefined();
    }
  });

  it('rogue-node-injector adds unapproved service and shadow LLM nodes', () => {
    const seed = createFixtureSeed();
    const mutants = generateMutants(seed, ['rogue-node-injector']);

    expect(mutants.length).toBe(2);
    const serviceMutant = mutants.find((m) => m.id === 'rogue-node-service');
    expect(serviceMutant?.architecture.nodes.length).toBe(seed.nodes.length + 1);
    const llmMutant = mutants.find((m) => m.id === 'rogue-node-shadow-llm');
    expect(llmMutant?.architecture.nodes.length).toBe(seed.nodes.length + 1);
    expect(llmMutant?.architecture.relationships.length).toBe(seed.relationships.length + 1);
  });

  it('zone-escape removes a node from deployed-in container', () => {
    const seed = createFixtureSeed();
    const mutants = generateMutants(seed, ['zone-escape']);

    expect(mutants.length).toBeGreaterThanOrEqual(1);
    const escaped = mutants[0];
    const rel = escaped.architecture.relationships.find((r) => r['unique-id'] === 'deploy-zone');
    expect(rel?.['relationship-type']['deployed-in']?.nodes.length).toBe(1);
  });

  it('interface-bypass drops destination interfaces and removes node interfaces', () => {
    const seed = createFixtureSeed();
    const mutants = generateMutants(seed, ['interface-bypass']);

    const relBypass = mutants.find((m) => m.id === 'interface-bypass-dest-gateway-to-db');
    expect(relBypass).toBeDefined();
    expect(
      relBypass?.architecture.relationships[0]['relationship-type'].connects?.destination.interfaces
    ).toBeUndefined();

    const nodeDrop = mutants.find((m) => m.id === 'interface-strip-node-api-gateway');
    expect(nodeDrop).toBeDefined();
    expect(
      nodeDrop?.architecture.nodes.find((n) => n['unique-id'] === 'api-gateway')?.interfaces
    ).toBeUndefined();
  });

  it('standard-property-dropper drops non-core node properties like details', () => {
    const seed = createFixtureSeed();
    const mutants = generateMutants(seed, ['standard-property-dropper']);

    expect(
      mutants.some(
        (m) =>
          m.id === 'prop-drop-node-api-gateway-details' &&
          m.architecture.nodes.find((n) => n['unique-id'] === 'api-gateway')?.details === undefined
      )
    ).toBe(true);
  });
});
