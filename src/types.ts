export interface CalmInterface {
  'unique-id': string;
  [key: string]: unknown;
}

export interface CalmControlRequirement {
  'requirement-url'?: string;
  'config-url'?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CalmControl {
  description?: string;
  requirements?: CalmControlRequirement[];
  [key: string]: unknown;
}

export type CalmControls = Record<string, CalmControl>;

export interface CalmNode {
  'unique-id': string;
  'node-type': string;
  name?: string;
  description?: string;
  interfaces?: CalmInterface[];
  controls?: CalmControls;
  [key: string]: unknown;
}

export interface CalmConnectsEndpoint {
  node: string;
  interfaces?: string[];
  [key: string]: unknown;
}

export interface CalmRelationshipType {
  connects?: {
    source: CalmConnectsEndpoint;
    destination: CalmConnectsEndpoint;
  };
  interacts?: {
    actor: string;
    nodes: string[];
  };
  'deployed-in'?: {
    container: string;
    nodes: string[];
  };
  'composed-of'?: {
    container: string;
    nodes: string[];
  };
  options?: unknown;
  [key: string]: unknown;
}

export interface CalmRelationship {
  'unique-id': string;
  description?: string;
  'relationship-type': CalmRelationshipType;
  protocol?: string;
  controls?: CalmControls;
  [key: string]: unknown;
}

export interface CalmArchitecture {
  $schema?: string;
  $id?: string;
  'unique-id'?: string;
  name?: string;
  description?: string;
  nodes: CalmNode[];
  relationships: CalmRelationship[];
  controls?: CalmControls;
  flows?: unknown[];
  [key: string]: unknown;
}

export type CalmPattern = Record<string, unknown>;

export type MutationOperatorId =
  | 'control-stripper'
  | 'protocol-downgrader'
  | 'rogue-edge-injector'
  | 'rogue-node-injector'
  | 'zone-escape'
  | 'interface-bypass'
  | 'standard-property-dropper';

export type MutationSeverity = 'critical' | 'high' | 'medium';

export interface MutantHighlight {
  removedNodeIds?: string[];
  addedNodeIds?: string[];
  removedRelIds?: string[];
  addedRelIds?: string[];
  modifiedNodeIds?: string[];
  modifiedRelIds?: string[];
  annotation?: string;
}

export interface Mutant {
  id: string;
  operator: MutationOperatorId;
  severity: MutationSeverity;
  targetType: 'node' | 'relationship' | 'architecture';
  targetId: string;
  description: string;
  architecture: CalmArchitecture;
  highlight: MutantHighlight;
  fixHint?: {
    kind:
      | 'require-property'
      | 'bound-array'
      | 'require-control-key'
      | 'require-protocol';
    targetKind: 'node' | 'relationship' | 'array';
    targetId: string;
    propertyName?: string;
    controlKey?: string;
  };
}

export type MutantOutcome = 'killed' | 'survived' | 'waived' | 'invalid-calm';

export interface WaiverEntry {
  mutantId?: string;
  operator?: MutationOperatorId;
  targetId?: string;
  pattern?: string;
  reason: string;
  owner?: string;
  expires?: string;
}

export interface WaiverFile {
  waivers: WaiverEntry[];
}

export interface MutationResult {
  mutant: Mutant;
  outcome: MutantOutcome;
  calmErrors: string[];
  patternErrors: string[];
  cliConfirmed?: boolean;
  waiver?: WaiverEntry;
}

export interface SchemaPatchOperation {
  op: 'add' | 'replace';
  path: string;
  value: unknown;
  reason: string;
  mutantId: string;
}

export interface MutationReport {
  patternPath: string;
  seedSource: 'generated' | 'provided';
  seedValidAgainstCalm: boolean;
  seedValidAgainstPattern: boolean;
  totalGenerated: number;
  validMutants: number;
  killed: number;
  survived: number;
  waived: number;
  invalidCalm: number;
  mutationScore: number;
  durationMs: number;
  results: MutationResult[];
  suggestedFixes: SchemaPatchOperation[];
}

export interface MutateOptions {
  patternPath: string;
  seedPath?: string;
  waiversPath?: string;
  urlMappingPath?: string;
  operators?: MutationOperatorId[];
  verifyCli?: boolean;
  minScore?: number;
}
