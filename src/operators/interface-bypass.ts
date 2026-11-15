import type { CalmArchitecture, Mutant } from '../types.js';

export function generateInterfaceBypassMutants(seed: CalmArchitecture): Mutant[] {
  const mutants: Mutant[] = [];

  for (let i = 0; i < seed.nodes.length; i++) {
    const node = seed.nodes[i];
    if (!node.interfaces || node.interfaces.length === 0) continue;

    // Only drop interfaces if no relationship references them (otherwise Gate 1 Base CALM may fail)
    const clone = structuredClone(seed);
    delete clone.nodes[i].interfaces;
    mutants.push({
      id: `interface-strip-node-${node['unique-id']}`,
      operator: 'interface-bypass',
      severity: 'medium',
      targetType: 'node',
      targetId: node['unique-id'],
      description: `Remove interfaces[] from node "${node['unique-id']}"`,
      architecture: clone,
      highlight: {
        modifiedNodeIds: [node['unique-id']],
        annotation: `Stripped interfaces[] from "${node['unique-id']}"`,
      },
      fixHint: {
        kind: 'require-property',
        targetKind: 'node',
        targetId: node['unique-id'],
        propertyName: 'interfaces',
      },
    });
  }

  for (let i = 0; i < seed.relationships.length; i++) {
    const rel = seed.relationships[i];
    const connects = rel['relationship-type'].connects;
    if (!connects) continue;

    if (connects.destination.interfaces && connects.destination.interfaces.length > 0) {
      const clone = structuredClone(seed);
      delete clone.relationships[i]['relationship-type'].connects!.destination.interfaces;
      mutants.push({
        id: `interface-bypass-dest-${rel['unique-id']}`,
        operator: 'interface-bypass',
        severity: 'medium',
        targetType: 'relationship',
        targetId: rel['unique-id'],
        description: `Remove destination interfaces[] from connects relationship "${rel['unique-id']}"`,
        architecture: clone,
        highlight: {
          modifiedRelIds: [rel['unique-id']],
          annotation: `Destination interfaces bypassed on "${rel['unique-id']}"`,
        },
      });
    }
  }

  return mutants;
}
