import type { CalmPattern, MutationResult, SchemaPatchOperation } from './types.js';

interface SchemaLocation {
  pointer: string;
  schema: Record<string, unknown>;
}

function getAtPath(root: unknown, segments: string[]): unknown {
  let cur: unknown = root;
  for (const seg of segments) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function findItemSchemaByUniqueId(
  pattern: CalmPattern,
  collection: 'nodes' | 'relationships',
  uniqueId: string
): SchemaLocation | undefined {
  const props = pattern.properties as Record<string, unknown> | undefined;
  const arrSchema = props?.[collection] as Record<string, unknown> | undefined;
  if (!arrSchema) return undefined;

  const prefixItems = arrSchema.prefixItems;
  if (Array.isArray(prefixItems)) {
    for (let i = 0; i < prefixItems.length; i++) {
      const entry = prefixItems[i] as Record<string, unknown> | undefined;
      if (!entry) continue;
      const directId = (entry.properties as Record<string, unknown> | undefined)?.['unique-id'] as
        | { const?: string }
        | undefined;
      if (directId?.const === uniqueId) {
        return { pointer: `/properties/${collection}/prefixItems/${i}`, schema: entry };
      }

      for (const kw of ['oneOf', 'anyOf'] as const) {
        const branches = entry[kw];
        if (!Array.isArray(branches)) continue;
        for (let j = 0; j < branches.length; j++) {
          const b = branches[j] as Record<string, unknown> | undefined;
          const bId = (b?.properties as Record<string, unknown> | undefined)?.['unique-id'] as
            | { const?: string }
            | undefined;
          if (bId?.const === uniqueId) {
            return {
              pointer: `/properties/${collection}/prefixItems/${i}/${kw}/${j}`,
              schema: b!,
            };
          }
        }
      }
    }
  }

  const items = arrSchema.items as Record<string, unknown> | undefined;
  if (items && typeof items === 'object') {
    for (const kw of ['oneOf', 'anyOf'] as const) {
      const branches = items[kw];
      if (!Array.isArray(branches)) continue;
      for (let j = 0; j < branches.length; j++) {
        const b = branches[j] as Record<string, unknown> | undefined;
        const bId = (b?.properties as Record<string, unknown> | undefined)?.['unique-id'] as
          | { const?: string }
          | undefined;
        if (bId?.const === uniqueId) {
          return { pointer: `/properties/${collection}/items/${kw}/${j}`, schema: b! };
        }
      }
    }
  }

  return undefined;
}

export function suggestSchemaFixes(
  pattern: CalmPattern,
  results: MutationResult[]
): SchemaPatchOperation[] {
  const patches: SchemaPatchOperation[] = [];
  const seenPaths = new Set<string>();

  for (const res of results) {
    if (res.outcome !== 'survived' || !res.mutant.fixHint) continue;
    const hint = res.mutant.fixHint;

    if (hint.kind === 'bound-array') {
      const collection = hint.targetId === 'nodes' ? 'nodes' : 'relationships';
      const arrSchema = getAtPath(pattern, ['properties', collection]) as
        | Record<string, unknown>
        | undefined;
      if (!arrSchema) continue;

      if (arrSchema.items === undefined) {
        const patchPath = `/properties/${collection}/items`;
        if (!seenPaths.has(patchPath)) {
          seenPaths.add(patchPath);
          patches.push({
            op: 'add',
            path: patchPath,
            value: false,
            reason: `Close ${collection}[] against unapproved elements (fixes ${res.mutant.id})`,
            mutantId: res.mutant.id,
          });
        }
      }
      continue;
    }

    if (
      (hint.kind === 'require-property' || hint.kind === 'require-protocol') &&
      hint.propertyName &&
      (hint.targetKind === 'node' || hint.targetKind === 'relationship')
    ) {
      const collection = hint.targetKind === 'node' ? 'nodes' : 'relationships';
      const loc = findItemSchemaByUniqueId(pattern, collection, hint.targetId);
      if (!loc) continue;

      const existingReq = Array.isArray(loc.schema.required)
        ? (loc.schema.required as string[])
        : [];
      if (existingReq.includes(hint.propertyName)) continue;

      const patchPath = `${loc.pointer}/required`;
      if (seenPaths.has(patchPath)) {
        // Merge into already queued patch for the same required array
        const existingPatch = patches.find((p) => p.path === patchPath);
        if (existingPatch && Array.isArray(existingPatch.value)) {
          const arr = existingPatch.value as string[];
          if (!arr.includes(hint.propertyName)) {
            arr.push(hint.propertyName);
          }
        }
        continue;
      }

      seenPaths.add(patchPath);
      patches.push({
        op: Array.isArray(loc.schema.required) ? 'replace' : 'add',
        path: patchPath,
        value: [...existingReq, hint.propertyName],
        reason: `Require "${hint.propertyName}" on ${hint.targetKind} "${hint.targetId}" (fixes ${res.mutant.id})`,
        mutantId: res.mutant.id,
      });
    }
  }

  return patches;
}

export function applySchemaPatches(
  pattern: CalmPattern,
  patches: SchemaPatchOperation[]
): CalmPattern {
  const updated = structuredClone(pattern);

  for (const patch of patches) {
    const parts = patch.path
      .split('/')
      .slice(1)
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (parts.length === 0) continue;

    let cursor: unknown = updated;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!cursor || typeof cursor !== 'object') {
        cursor = undefined;
        break;
      }
      cursor = Array.isArray(cursor)
        ? cursor[Number(key)]
        : (cursor as Record<string, unknown>)[key];
    }

    if (cursor && typeof cursor === 'object') {
      const lastKey = parts[parts.length - 1];
      (cursor as Record<string, unknown>)[lastKey] = structuredClone(patch.value);
    }
  }

  return updated;
}
