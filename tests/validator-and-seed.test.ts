import { describe, expect, it } from 'vitest';
import {
  DifferentialValidator,
  fillPlaceholders,
  type CalmArchitecture,
  type CalmPattern,
} from '../src/index.js';

describe('fillPlaceholders', () => {
  it('fills CALM generate placeholder tokens and -1 sentinel ports', () => {
    const input = {
      name: '[[ APP_NAME ]]',
      image: '[[ CONTAINER_IMAGE ]]',
      url: '[[ SERVICE_URL ]]',
      portStr: '[[ HTTP_PORT ]]',
      portNum: -1,
      nested: [{ uri: '[[ DOCS_URI ]]' }],
      unchanged: 'regular-string',
    };

    const filled = fillPlaceholders(input);
    expect(filled.name).toBe('placeholder-app_name');
    expect(filled.image).toBe('registry.example.com/service:1.0.0');
    expect(filled.url).toBe('https://example.com');
    expect(filled.portStr).toBe('443');
    expect(filled.portNum).toBe(443);
    expect(filled.nested[0].uri).toBe('https://example.com');
    expect(filled.unchanged).toBe('regular-string');
  });
});

describe('DifferentialValidator', () => {
  const samplePattern: CalmPattern = {
    $schema: 'https://calm.finos.org/release/1.3/meta/calm.json',
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        prefixItems: [
          {
            allOf: [{ $ref: 'https://calm.finos.org/release/1.3/meta/core.json#/defs/node' }],
            required: ['unique-id', 'name', 'description', 'node-type', 'controls'],
          },
        ],
      },
    },
    required: ['nodes', 'relationships'],
  };

  const validArch: CalmArchitecture = {
    $schema: 'https://calm.finos.org/release/1.3/meta/calm.json',
    'unique-id': 'arch-1',
    name: 'Test Arch',
    nodes: [
      {
        'unique-id': 'api',
        'node-type': 'service',
        name: 'API',
        description: 'Service',
        controls: {
          auth: {
            description: 'Auth required',
            requirements: [
              {
                'requirement-url': 'https://example.com/auth',
                config: { enabled: true },
              },
            ],
          },
        },
      },
    ],
    relationships: [],
  };

  it('passes Gate 1 and Gate 2 for a compliant architecture', () => {
    const validator = new DifferentialValidator(samplePattern);
    expect(validator.validateBaseCalm(validArch)).toEqual([]);
    expect(validator.validatePattern(validArch)).toEqual([]);
  });

  it('rejects dangling relationship references and duplicate IDs in Gate 1', () => {
    const validator = new DifferentialValidator(samplePattern);
    const brokenArch: CalmArchitecture = {
      ...validArch,
      nodes: [
        ...validArch.nodes,
        {
          'unique-id': 'api',
          'node-type': 'service',
          name: 'Duplicate',
          description: 'Dup',
        },
      ],
      relationships: [
        {
          'unique-id': 'rel-1',
          'relationship-type': {
            connects: {
              source: { node: 'api' },
              destination: { node: 'nonexistent-node' },
            },
          },
        },
      ],
    };

    const calmErrors = validator.validateBaseCalm(brokenArch);
    expect(calmErrors.some((e) => e.includes('Duplicate unique-id: api'))).toBe(true);
    expect(calmErrors.some((e) => e.includes('does not exist'))).toBe(true);
  });

  it('rejects valid CALM architectures that violate pattern constraints in Gate 2', () => {
    const validator = new DifferentialValidator(samplePattern);
    const strippedArch: CalmArchitecture = {
      ...validArch,
      nodes: [
        {
          'unique-id': 'api',
          'node-type': 'service',
          name: 'API',
          description: 'Service',
        },
      ],
    };

    expect(validator.validateBaseCalm(strippedArch)).toEqual([]);
    expect(validator.validatePattern(strippedArch).length).toBeGreaterThan(0);
  });

  it('compiles legacy 1.0-rc1 and 1.0-rc2 pattern refs without MissingRefError', () => {
    const legacyPattern: CalmPattern = {
      $schema: 'https://calm.finos.org/release/1.0-rc2/meta/calm.json',
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          prefixItems: [
            {
              allOf: [{ $ref: 'https://calm.finos.org/release/1.0-rc2/meta/core.json#/defs/node' }],
              properties: {
                interfaces: {
                  type: 'array',
                  items: {
                    $ref: 'https://calm.finos.org/release/1.0-rc1/meta/interface.json#/defs/url-interface',
                  },
                },
              },
            },
          ],
        },
      },
    };

    expect(() => new DifferentialValidator(legacyPattern)).not.toThrow();
  });
});
