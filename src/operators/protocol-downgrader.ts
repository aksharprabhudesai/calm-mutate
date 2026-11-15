import type { CalmArchitecture, Mutant } from '../types.js';

const DOWNGRADE_MAP: Record<string, string[]> = {
  mtls: ['HTTPS', 'HTTP'],
  https: ['HTTP'],
  tls: ['TCP'],
  wss: ['WS'],
  sftp: ['FTP'],
  ssh: ['TELNET'],
  amqps: ['AMQP'],
  ldaps: ['LDAP'],
};

export function generateProtocolDowngraderMutants(seed: CalmArchitecture): Mutant[] {
  const mutants: Mutant[] = [];

  for (let i = 0; i < seed.relationships.length; i++) {
    const rel = seed.relationships[i];
    if (!rel.protocol) continue;

    const normalized = rel.protocol.toLowerCase();
    const targets = DOWNGRADE_MAP[normalized] ?? [];

    for (const downgraded of targets) {
      const clone = structuredClone(seed);
      clone.relationships[i].protocol = downgraded;
      mutants.push({
        id: `protocol-downgrade-${rel['unique-id']}-${downgraded.toLowerCase()}`,
        operator: 'protocol-downgrader',
        severity: 'critical',
        targetType: 'relationship',
        targetId: rel['unique-id'],
        description: `Downgrade protocol on "${rel['unique-id']}" from "${rel.protocol}" to "${downgraded}"`,
        architecture: clone,
        highlight: {
          modifiedRelIds: [rel['unique-id']],
          annotation: `Protocol downgraded: ${rel.protocol} → ${downgraded}`,
        },
        fixHint: {
          kind: 'require-protocol',
          targetKind: 'relationship',
          targetId: rel['unique-id'],
          propertyName: 'protocol',
        },
      });
    }

    const removed = structuredClone(seed);
    delete removed.relationships[i].protocol;
    mutants.push({
      id: `protocol-remove-${rel['unique-id']}`,
      operator: 'protocol-downgrader',
      severity: 'high',
      targetType: 'relationship',
      targetId: rel['unique-id'],
      description: `Remove protocol field from relationship "${rel['unique-id']}" (was "${rel.protocol}")`,
      architecture: removed,
      highlight: {
        modifiedRelIds: [rel['unique-id']],
        annotation: `Protocol "${rel.protocol}" removed`,
      },
      fixHint: {
        kind: 'require-property',
        targetKind: 'relationship',
        targetId: rel['unique-id'],
        propertyName: 'protocol',
      },
    });
  }

  return mutants;
}
