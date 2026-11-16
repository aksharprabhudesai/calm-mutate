import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { resolveCalmCliBin } from './validator.js';
import type { CalmArchitecture } from './types.js';

const PLACEHOLDER_RE = /^\[\[\s*([A-Z0-9_]+)\s*\]\]$/;

export function fillPlaceholders<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const match = value.match(PLACEHOLDER_RE);
    if (!match) return value;
    const key = match[1];
    if (key.includes('IMAGE')) return 'registry.example.com/service:1.0.0' as unknown as T;
    if (key.includes('URL') || key.includes('URI')) return 'https://example.com' as unknown as T;
    if (key.includes('PORT')) return '443' as unknown as T;
    return `placeholder-${key.toLowerCase()}` as unknown as T;
  }
  if (typeof value === 'number') {
    return (value === -1 ? 443 : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => fillPlaceholders(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = fillPlaceholders(v);
    }
    return out as T;
  }
  return value;
}

function runCalmGenerate(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const cliBin = resolveCalmCliBin();
    const child = spawn(process.execPath, [cliBin, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`calm generate timed out after 15000ms: ${stderr}`));
    }, 15000);

    // Auto-select default choices if calm generate prompts interactively for oneOf/anyOf
    const promptInterval = setInterval(() => {
      if (!child.stdin.destroyed) {
        child.stdin.write('\n');
      }
    }, 50);

    child.on('error', (err) => {
      clearTimeout(timer);
      clearInterval(promptInterval);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(promptInterval);
      if (!child.stdin.destroyed) {
        child.stdin.end();
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`calm generate exited with code ${code}: ${stderr}`));
      }
    });
  });
}

export async function resolveSeedArchitecture(
  patternPath: string,
  seedPath?: string,
  urlMappingPath?: string
): Promise<{ architecture: CalmArchitecture; seedSource: 'generated' | 'provided' }> {
  if (seedPath) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(seedPath), 'utf8')) as CalmArchitecture;
    return { architecture: raw, seedSource: 'provided' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calm-mutate-seed-'));
  const tmpOut = path.join(tmpDir, 'seed.architecture.json');
  try {
    const args = ['generate', '-p', path.resolve(patternPath), '-o', tmpOut];
    if (urlMappingPath) {
      args.push('-u', path.resolve(urlMappingPath));
    }
    await runCalmGenerate(args);
    const raw = JSON.parse(fs.readFileSync(tmpOut, 'utf8')) as CalmArchitecture;
    return {
      architecture: fillPlaceholders(raw),
      seedSource: 'generated',
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
