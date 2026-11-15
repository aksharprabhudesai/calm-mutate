import type { CalmArchitecture, Mutant, MutationOperatorId } from '../types.js';
import { generateControlStripperMutants } from './control-stripper.js';
import { generateProtocolDowngraderMutants } from './protocol-downgrader.js';
import { generateRogueEdgeMutants } from './rogue-edge-injector.js';
import { generateRogueNodeMutants } from './rogue-node-injector.js';
import { generateZoneEscapeMutants } from './zone-escape.js';
import { generateInterfaceBypassMutants } from './interface-bypass.js';
import { generatePropertyDropperMutants } from './property-dropper.js';

export const ALL_OPERATORS: MutationOperatorId[] = [
  'control-stripper',
  'protocol-downgrader',
  'rogue-edge-injector',
  'rogue-node-injector',
  'zone-escape',
  'interface-bypass',
  'standard-property-dropper',
];

export function generateMutants(
  seed: CalmArchitecture,
  enabledOperators: MutationOperatorId[] = ALL_OPERATORS
): Mutant[] {
  const enabled = new Set(enabledOperators);
  const mutants: Mutant[] = [];

  if (enabled.has('control-stripper')) mutants.push(...generateControlStripperMutants(seed));
  if (enabled.has('protocol-downgrader')) mutants.push(...generateProtocolDowngraderMutants(seed));
  if (enabled.has('rogue-edge-injector')) mutants.push(...generateRogueEdgeMutants(seed));
  if (enabled.has('rogue-node-injector')) mutants.push(...generateRogueNodeMutants(seed));
  if (enabled.has('zone-escape')) mutants.push(...generateZoneEscapeMutants(seed));
  if (enabled.has('interface-bypass')) mutants.push(...generateInterfaceBypassMutants(seed));
  if (enabled.has('standard-property-dropper')) mutants.push(...generatePropertyDropperMutants(seed));

  return mutants;
}
