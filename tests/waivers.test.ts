import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findMatchingWaiver,
  isWaiverExpired,
  loadWaivers,
  runMutationAudit,
  type CalmArchitecture,
  type CalmPattern,
  type Mutant,
} from '../src/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeDummyMutant(overrides: Partial<Mutant> = {}): Mutant {
  return {
    id: 'rogue-node-service',
    operator: 'rogue-node-injector',
    severity: 'high',
    targetType: 'node',
    targetId: 'rogue-unapproved-service',
    description: 'Append unapproved service node',
    architecture: { nodes: [], relationships: [] },
    ...overrides,
  };
}

describe('waivers', () => {
  it('validates waiver file structure and required fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calm-mutate-waiver-'));
    tempDirs.push(tmpDir);

    const badFile = path.join(tmpDir, 'bad.waivers.json');
    fs.writeFileSync(badFile, JSON.stringify({ waivers: [{ mutantId: 'x' }] }));
    expect(() => loadWaivers(badFile)).toThrow(/non-empty "reason"/);

    const noMatcherFile = path.join(tmpDir, 'nomatcher.waivers.json');
    fs.writeFileSync(noMatcherFile, JSON.stringify({ waivers: [{ reason: 'allowed' }] }));
    expect(() => loadWaivers(noMatcherFile)).toThrow(/mutantId" or "operator"/);
  });

  it('checks waiver expiration and pattern scope', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    expect(isWaiverExpired({ reason: 'ok', expires: '2026-11-14' }, now)).toBe(true);
    expect(isWaiverExpired({ reason: 'ok', expires: '2026-11-15' }, now)).toBe(false);
    expect(isWaiverExpired({ reason: 'ok', expires: '2026-12-31' }, now)).toBe(false);

    const mutant = makeDummyMutant();
    const matched = findMatchingWaiver(
      [
        {
          mutantId: 'rogue-node-service',
          pattern: 'other.pattern.json',
          reason: 'wrong pattern',
        },
        {
          mutantId: 'rogue-node-service',
          pattern: 'payment.pattern.json',
          reason: 'expired',
          expires: '2026-01-01',
        },
        {
          operator: 'rogue-node-injector',
          targetId: 'rogue-unapproved-service',
          pattern: 'payment.pattern.json',
          reason: 'intentionally extensible',
          owner: 'platform-arch',
          expires: '2026-12-31',
        },
      ],
      mutant,
      '/repo/patterns/payment.pattern.json',
      now
    );

    expect(matched?.reason).toBe('intentionally extensible');
  });

  it('marks waived survivors in runMutationAudit and excludes them from failures/fixes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calm-mutate-waiver-e2e-'));
    tempDirs.push(tmpDir);

    const pattern: CalmPattern = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        $schema: { type: 'string' },
        'unique-id': { type: 'string' },
        name: { type: 'string' },
        nodes: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          prefixItems: [
            {
              allOf: [{ $ref: 'https://calm.finos.org/release/1.3/meta/core.json#/defs/node' }],
              properties: { 'unique-id': { const: 'api' } },
              required: ['unique-id', 'name', 'description', 'node-type'],
            },
          ],
        },
        relationships: { type: 'array', maxItems: 0 },
      },
      required: ['nodes', 'relationships'],
    };

    const seed: CalmArchitecture = {
      $schema: 'https://calm.finos.org/release/1.3/meta/calm.json',
      'unique-id': 'waiver-demo',
      name: 'Waiver Demo',
      nodes: [
        {
          'unique-id': 'api',
          'node-type': 'service',
          name: 'API',
          description: 'Service',
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
      ],
      relationships: [],
    };

    const patternPath = path.join(tmpDir, 'demo.pattern.json');
    const seedPath = path.join(tmpDir, 'demo.architecture.json');
    const waiversPath = path.join(tmpDir, 'demo.waivers.json');

    fs.writeFileSync(patternPath, JSON.stringify(pattern, null, 2));
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
    fs.writeFileSync(
      waiversPath,
      JSON.stringify(
        {
          waivers: [
            {
              mutantId: 'control-strip-node-api',
              reason: 'Controls are enforced out-of-band by mesh policy',
              owner: 'security-arch',
            },
          ],
        },
        null,
        2
      )
    );

    const withoutWaiver = await runMutationAudit({ patternPath, seedPath });
    expect(withoutWaiver.survived).toBe(1);
    expect(withoutWaiver.waived).toBe(0);
    expect(withoutWaiver.mutationScore).toBeLessThan(100);
    expect(withoutWaiver.suggestedFixes.length).toBe(1);

    const withWaiver = await runMutationAudit({ patternPath, seedPath, waiversPath });
    expect(withWaiver.survived).toBe(0);
    expect(withWaiver.waived).toBe(1);
    expect(withWaiver.mutationScore).toBe(100);
    expect(withWaiver.suggestedFixes).toEqual([]);
  });
});
