import type { CalmArchitecture, Mutant } from '../types.js';

export function generateZoneEscapeMutants(seed: CalmArchitecture): Mutant[] {
  const mutants: Mutant[] = [];

  for (let i = 0; i < seed.relationships.length; i++) {
    const rel = seed.relationships[i];
    for (const kind of ['deployed-in', 'composed-of'] as const) {
      const group = rel['relationship-type'][kind];
      if (!group || !Array.isArray(group.nodes) || group.nodes.length === 0) continue;

      const escapedNodeId = group.nodes[0];
      const clone = structuredClone(seed);
      clone.relationships[i]['relationship-type'][kind]!.nodes = group.nodes.slice(1);

      mutants.push({
        id: `zone-escape-${rel['unique-id']}-${escapedNodeId}`,
        operator: 'zone-escape',
        severity: 'high',
        targetType: 'relationship',
        targetId: rel['unique-id'],
        description: `Remove "${escapedNodeId}" from ${kind} container "${group.container}" in "${rel['unique-id']}"`,
        architecture: clone,
        highlight: {
          modifiedNodeIds: [escapedNodeId],
          modifiedRelIds: [rel['unique-id']],
          annotation: `Node "${escapedNodeId}" escaped ${kind} "${group.container}"`,
        },
      });
    }
  }

  return mutants;
}
