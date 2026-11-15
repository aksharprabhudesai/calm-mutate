import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applySchemaPatches,
  renderCounterexampleSvg,
  runMutationAudit,
  suggestSchemaFixes,
  type CalmArchitecture,
  type CalmPattern,
} from '../src/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('fix-suggester, svg-renderer, and runMutationAudit', () => {
  it('detects surviving mutants, suggests patches, and raises score when applied', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calm-mutate-test-'));
    tempDirs.push(tmpDir);

    const weakPattern: CalmPattern = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        $schema: { type: 'string' },
        'unique-id': { type: 'string' },
        name: { type: 'string' },
        nodes: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          prefixItems: [
            {
              allOf: [{ $ref: 'https://calm.finos.org/release/1.3/meta/core.json#/defs/node' }],
              properties: { 'unique-id': { const: 'gateway' } },
              required: ['unique-id', 'name', 'description', 'node-type'],
            },
            {
              allOf: [{ $ref: 'https://calm.finos.org/release/1.3/meta/core.json#/defs/node' }],
              properties: { 'unique-id': { const: 'db' } },
              required: ['unique-id', 'name', 'description', 'node-type'],
            },
          ],
        },
        relationships: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          prefixItems: [
            {
              allOf: [
                { $ref: 'https://calm.finos.org/release/1.3/meta/core.json#/defs/relationship' },
              ],
              properties: {
                protocol: { enum: ['HTTPS'] },
              },
              required: ['unique-id', 'description', 'relationship-type', 'protocol'],
            },
          ],
        },
      },
      required: ['nodes', 'relationships'],
    };

    const seed: CalmArchitecture = {
      $schema: 'https://calm.finos.org/release/1.3/meta/calm.json',
      'unique-id': 'demo-arch',
      name: 'Demo Arch',
      nodes: [
        {
          'unique-id': 'gateway',
          'node-type': 'service',
          name: 'Gateway',
          description: 'API Gateway',
          controls: {
            auth: {
              description: 'Auth',
              requirements: [
                {
                  'requirement-url': 'https://example.com/auth',
                  config: { enabled: true },
                },
              ],
            },
          },
        },
        {
          'unique-id': 'db',
          'node-type': 'database',
          name: 'Database',
          description: 'Postgres',
        },
      ],
      relationships: [
        {
          'unique-id': 'gw-to-db',
          description: 'Connects gateway to DB',
          protocol: 'HTTPS',
          'relationship-type': {
            connects: {
              source: { node: 'gateway' },
              destination: { node: 'db' },
            },
          },
        },
      ],
    };

    const patternPath = path.join(tmpDir, 'weak.pattern.json');
    const seedPath = path.join(tmpDir, 'seed.architecture.json');
    fs.writeFileSync(patternPath, JSON.stringify(weakPattern, null, 2));
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));

    const report = await runMutationAudit({
      patternPath,
      seedPath,
    });

    expect(report.seedValidAgainstCalm).toBe(true);
    expect(report.seedValidAgainstPattern).toBe(true);
    expect(report.survived).toBeGreaterThanOrEqual(1);
    expect(report.mutationScore).toBeLessThan(100);

    const controlSurvivor = report.results.find(
      (r) => r.outcome === 'survived' && r.mutant.operator === 'control-stripper'
    );
    expect(controlSurvivor).toBeDefined();

    const svg = renderCounterexampleSvg(controlSurvivor!.mutant);
    expect(svg).toContain('<svg');
    expect(svg).toContain('gateway');
    expect(svg).toContain('db');

    const fixes = suggestSchemaFixes(weakPattern, report.results);
    expect(fixes.length).toBeGreaterThanOrEqual(1);

    const hardened = applySchemaPatches(weakPattern, fixes);
    const hardenedPath = path.join(tmpDir, 'hardened.pattern.json');
    fs.writeFileSync(hardenedPath, JSON.stringify(hardened, null, 2));

    const hardenedReport = await runMutationAudit({
      patternPath: hardenedPath,
      seedPath,
    });
    expect(hardenedReport.mutationScore).toBeGreaterThan(report.mutationScore);
  });
});
