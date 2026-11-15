import type { CalmArchitecture, CalmNode, Mutant } from '../types.js';

const ENTRY_TYPES = new Set(['actor', 'webclient', 'ai:agent', 'ai:orchestrator', 'system']);
const SENSITIVE_TYPES = new Set([
  'database',
  'data-asset',
  'ai:llm',
  'ai:mcp-server',
  'ai:vector-store',
  'ai:memory',
]);

function isContainerNode(node: CalmNode, seed: CalmArchitecture): boolean {
  return seed.relationships.some(
    (r) =>
      r['relationship-type']['deployed-in']?.container === node['unique-id'] ||
      r['relationship-type']['composed-of']?.container === node['unique-id']
  );
}

export function generateRogueEdgeMutants(seed: CalmArchitecture): Mutant[] {
  const mutants: Mutant[] = [];
  const existingPairs = new Set<string>();

  for (const rel of seed.relationships) {
    const c = rel['relationship-type'].connects;
    if (c) existingPairs.add(`${c.source.node}->${c.destination.node}`);
  }

  const nonContainers = seed.nodes.filter((n) => !isContainerNode(n, seed));
  const sources = nonContainers.filter((n) => ENTRY_TYPES.has(n['node-type']));
  const targets = nonContainers.filter((n) => SENSITIVE_TYPES.has(n['node-type']));

  const candidatePairs: Array<{ src: CalmNode; dst: CalmNode; label: string }> = [];

  for (const src of sources) {
    for (const dst of targets) {
      if (src['unique-id'] !== dst['unique-id'] && !existingPairs.has(`${src['unique-id']}->${dst['unique-id']}`)) {
        candidatePairs.push({
          src,
          dst,
          label: `bypass (${src['node-type']} → ${dst['node-type']})`,
        });
      }
    }
  }

  // Fallback if no entry->sensitive pair existed: pick first unconnected pair
  if (candidatePairs.length === 0 && nonContainers.length >= 2) {
    for (let i = 0; i < nonContainers.length && candidatePairs.length < 2; i++) {
      for (let j = nonContainers.length - 1; j > i && candidatePairs.length < 2; j--) {
        const src = nonContainers[i];
        const dst = nonContainers[j];
        if (!existingPairs.has(`${src['unique-id']}->${dst['unique-id']}`)) {
          candidatePairs.push({ src, dst, label: 'undeclared shortcut edge' });
        }
      }
    }
  }

  for (const { src, dst, label } of candidatePairs.slice(0, 3)) {
    const clone = structuredClone(seed);
    const rogueId = `rogue-edge-${src['unique-id']}-to-${dst['unique-id']}`;
    clone.relationships.push({
      'unique-id': rogueId,
      description: `Adversarial rogue ${label}`,
      protocol: 'HTTP',
      'relationship-type': {
        connects: {
          source: { node: src['unique-id'] },
          destination: { node: dst['unique-id'] },
        },
      },
    });
    mutants.push({
      id: rogueId,
      operator: 'rogue-edge-injector',
      severity: 'critical',
      targetType: 'relationship',
      targetId: rogueId,
      description: `Inject rogue HTTP edge "${src['unique-id']}" → "${dst['unique-id']}" (${label})`,
      architecture: clone,
      highlight: {
        addedRelIds: [rogueId],
        annotation: `Rogue HTTP bypass: ${src['unique-id']} → ${dst['unique-id']}`,
      },
      fixHint: {
        kind: 'bound-array',
        targetKind: 'array',
        targetId: 'relationships',
      },
    });
  }

  return mutants;
}
