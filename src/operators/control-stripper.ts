import type { CalmArchitecture, Mutant } from '../types.js';

export function generateControlStripperMutants(seed: CalmArchitecture): Mutant[] {
  const mutants: Mutant[] = [];

  for (let i = 0; i < seed.nodes.length; i++) {
    const node = seed.nodes[i];
    if (!node.controls || Object.keys(node.controls).length === 0) continue;

    const strippedAll = structuredClone(seed);
    delete strippedAll.nodes[i].controls;
    mutants.push({
      id: `control-strip-node-${node['unique-id']}`,
      operator: 'control-stripper',
      severity: 'critical',
      targetType: 'node',
      targetId: node['unique-id'],
      description: `Remove all controls from node "${node['unique-id']}" (${Object.keys(node.controls).join(', ')})`,
      architecture: strippedAll,
      highlight: {
        modifiedNodeIds: [node['unique-id']],
        annotation: `Stripped controls [${Object.keys(node.controls).join(', ')}]`,
      },
      fixHint: {
        kind: 'require-property',
        targetKind: 'node',
        targetId: node['unique-id'],
        propertyName: 'controls',
      },
    });

    const controlKeys = Object.keys(node.controls);
    if (controlKeys.length > 1) {
      for (const key of controlKeys) {
        const strippedOne = structuredClone(seed);
        delete strippedOne.nodes[i].controls![key];
        mutants.push({
          id: `control-strip-node-${node['unique-id']}-${key}`,
          operator: 'control-stripper',
          severity: 'critical',
          targetType: 'node',
          targetId: node['unique-id'],
          description: `Remove control "${key}" from node "${node['unique-id']}"`,
          architecture: strippedOne,
          highlight: {
            modifiedNodeIds: [node['unique-id']],
            annotation: `Stripped control "${key}"`,
          },
          fixHint: {
            kind: 'require-control-key',
            targetKind: 'node',
            targetId: node['unique-id'],
            controlKey: key,
          },
        });
      }
    }
  }

  for (let i = 0; i < seed.relationships.length; i++) {
    const rel = seed.relationships[i];
    if (!rel.controls || Object.keys(rel.controls).length === 0) continue;

    const strippedAll = structuredClone(seed);
    delete strippedAll.relationships[i].controls;
    mutants.push({
      id: `control-strip-rel-${rel['unique-id']}`,
      operator: 'control-stripper',
      severity: 'critical',
      targetType: 'relationship',
      targetId: rel['unique-id'],
      description: `Remove all controls from relationship "${rel['unique-id']}" (${Object.keys(rel.controls).join(', ')})`,
      architecture: strippedAll,
      highlight: {
        modifiedRelIds: [rel['unique-id']],
        annotation: `Stripped controls [${Object.keys(rel.controls).join(', ')}]`,
      },
      fixHint: {
        kind: 'require-property',
        targetKind: 'relationship',
        targetId: rel['unique-id'],
        propertyName: 'controls',
      },
    });
  }

  if (seed.controls && Object.keys(seed.controls).length > 0) {
    const strippedTop = structuredClone(seed);
    delete strippedTop.controls;
    mutants.push({
      id: 'control-strip-architecture',
      operator: 'control-stripper',
      severity: 'critical',
      targetType: 'architecture',
      targetId: seed['unique-id'] ?? 'architecture',
      description: `Remove top-level architecture controls (${Object.keys(seed.controls).join(', ')})`,
      architecture: strippedTop,
      highlight: {
        annotation: `Stripped top-level controls`,
      },
      fixHint: {
        kind: 'require-property',
        targetKind: 'array',
        targetId: 'root',
        propertyName: 'controls',
      },
    });
  }

  return mutants;
}
