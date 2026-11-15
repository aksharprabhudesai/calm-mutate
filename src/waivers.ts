import fs from 'node:fs';
import path from 'node:path';
import type { Mutant, WaiverEntry, WaiverFile } from './types.js';

export function loadWaivers(waiversPath: string): WaiverEntry[] {
  const absPath = path.resolve(waiversPath);
  const raw = JSON.parse(fs.readFileSync(absPath, 'utf8')) as Partial<WaiverFile>;
  if (!raw || !Array.isArray(raw.waivers)) {
    throw new Error(`Invalid waiver file "${absPath}": expected { "waivers": [...] }`);
  }

  for (let i = 0; i < raw.waivers.length; i++) {
    const entry = raw.waivers[i];
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid waiver entry at index ${i} in "${absPath}"`);
    }
    if (!entry.reason || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`Waiver entry at index ${i} in "${absPath}" must include a non-empty "reason"`);
    }
    if (!entry.mutantId && !entry.operator) {
      throw new Error(
        `Waiver entry at index ${i} in "${absPath}" must specify at least "mutantId" or "operator"`
      );
    }
  }

  return raw.waivers;
}

export function isWaiverExpired(waiver: WaiverEntry, now: Date = new Date()): boolean {
  if (!waiver.expires) return false;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(waiver.expires)
    ? `${waiver.expires}T23:59:59.999Z`
    : waiver.expires;
  const expiryMs = Date.parse(normalized);
  if (Number.isNaN(expiryMs)) {
    throw new Error(`Invalid waiver expires date: "${waiver.expires}"`);
  }
  return now.getTime() > expiryMs;
}

function matchesPatternScope(waiverPattern: string | undefined, absPatternPath: string): boolean {
  if (!waiverPattern) return true;
  const normalizedTarget = absPatternPath.replace(/\\/g, '/');
  const normalizedScope = waiverPattern.replace(/\\/g, '/');
  return (
    path.basename(normalizedTarget) === normalizedScope ||
    normalizedTarget === normalizedScope ||
    normalizedTarget.endsWith(`/${normalizedScope}`)
  );
}

export function findMatchingWaiver(
  waivers: WaiverEntry[],
  mutant: Mutant,
  absPatternPath: string,
  now: Date = new Date()
): WaiverEntry | undefined {
  for (const waiver of waivers) {
    if (!matchesPatternScope(waiver.pattern, absPatternPath)) continue;
    if (isWaiverExpired(waiver, now)) continue;
    if (waiver.mutantId && waiver.mutantId !== mutant.id) continue;
    if (waiver.operator && waiver.operator !== mutant.operator) continue;
    if (waiver.targetId && waiver.targetId !== mutant.targetId) continue;
    return waiver;
  }
  return undefined;
}
