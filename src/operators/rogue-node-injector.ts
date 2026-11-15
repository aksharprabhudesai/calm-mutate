import type { CalmArchitecture, Mutant } from '../types.js';

export function generateRogueNodeMutants(seed: CalmArchitecture): Mutant[] {
  const mutants: Mutant[] = [];

  const withRogueService = structuredClone(seed);
  const rogueNodeId = 'rogue-unapproved-service';
  withRogueService.nodes.push({
    'unique-id': rogueNodeId,
    'node-type': 'service',
    name: 'Rogue External Service',
    description: 'Unapproved service injected to test nodes array bounds',
  });

  mutants.push({
    id: 'rogue-node-service',
    operator: 'rogue-node-injector',
    severity: 'high',
    targetType: 'node',
    targetId: rogueNodeId,
    description: `Append unapproved service node "${rogueNodeId}" to nodes[]`,
    architecture: withRogueService,
    highlight: {
      addedNodeIds: [rogueNodeId],
      annotation: `Unapproved node injected: ${rogueNodeId}`,
    },
    fixHint: {
      kind: 'bound-array',
      targetKind: 'array',
      targetId: 'nodes',
    },
  });

  const withRogueLlm = structuredClone(seed);
  const rogueLlmId = 'rogue-shadow-llm';
  withRogueLlm.nodes.push({
    'unique-id': rogueLlmId,
    'node-type': 'ai:llm',
    name: 'Shadow Unapproved LLM',
    description: 'Shadow AI endpoint injected to test nodes/relationships bounds',
  });
  if (seed.nodes.length > 0) {
    const firstId = seed.nodes[0]['unique-id'];
    const exfilId = 'rogue-llm-exfil';
    withRogueLlm.relationships.push({
      'unique-id': exfilId,
      description: 'Unapproved outbound connection to shadow LLM',
      protocol: 'HTTP',
      'relationship-type': {
        connects: {
          source: { node: firstId },
          destination: { node: rogueLlmId },
        },
      },
    });
    mutants.push({
      id: 'rogue-node-shadow-llm',
      operator: 'rogue-node-injector',
      severity: 'critical',
      targetType: 'node',
      targetId: rogueLlmId,
      description: `Append shadow AI node "${rogueLlmId}" and outbound HTTP edge from "${firstId}"`,
      architecture: withRogueLlm,
      highlight: {
        addedNodeIds: [rogueLlmId],
        addedRelIds: [exfilId],
        annotation: `Shadow LLM exfiltration: ${firstId} → ${rogueLlmId}`,
      },
      fixHint: {
        kind: 'bound-array',
        targetKind: 'array',
        targetId: 'nodes',
      },
    });
  }

  return mutants;
}
