import type { CalmArchitecture, Mutant } from '../types.js';

const CORE_NODE_KEYS = new Set([
  'unique-id',
  'node-type',
  'name',
  'description',
  'interfaces',
  'controls',
]);

export function generatePropertyDropperMutants(seed: CalmArchitecture): Mutant[] {
  const mutants: Mutant[] = [];

  for (let i = 0; i < seed.nodes.length; i++) {
    const node = seed.nodes[i];
    const customKeys = Object.keys(node).filter((k) => !CORE_NODE_KEYS.has(k));
    for (const key of customKeys.slice(0, 2)) {
      const clone = structuredClone(seed);
      delete clone.nodes[i][key];
      mutants.push({
        id: `prop-drop-node-${node['unique-id']}-${key}`,
        operator: 'standard-property-dropper',
        severity: 'medium',
        targetType: 'node',
        targetId: node['unique-id'],
        description: `Drop property "${key}" from node "${node['unique-id']}"`,
        architecture: clone,
        highlight: {
          modifiedNodeIds: [node['unique-id']],
          annotation: `Dropped property "${key}"`,
        },
        fixHint: {
          kind: 'require-property',
          targetKind: 'node',
          targetId: node['unique-id'],
          propertyName: key,
        },
      });
    }
  }

  return mutants;
}
