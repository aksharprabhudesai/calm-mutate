import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import Ajv2020Import, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import type { CalmArchitecture, CalmPattern } from './types.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020 = (Ajv2020Import as any).default ?? Ajv2020Import;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats = (addFormatsImport as any).default ?? addFormatsImport;

const ORDERED_FILES = [
  'units.json',
  'control-requirement.json',
  'control.json',
  'interface.json',
  'flow.json',
  'core.json',
  'timeline.json',
  'decorators.json',
  'evidence.json',
  'calm.json',
];

function collectCalmRefPrefixes(obj: unknown, prefixes = new Set<string>()): Set<string> {
  if (!obj || typeof obj !== 'object') return prefixes;
  if (Array.isArray(obj)) {
    for (const item of obj) collectCalmRefPrefixes(item, prefixes);
    return prefixes;
  }
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if ((key === '$ref' || key === '$schema') && typeof val === 'string') {
      const match = val.match(/^(https:\/\/calm\.finos\.org\/[^#]+\/meta\/)/);
      if (match) prefixes.add(match[1]);
    } else {
      collectCalmRefPrefixes(val, prefixes);
    }
  }
  return prefixes;
}

export function resolveCalmCliBin(): string {
  const pkgPath = require.resolve('@finos/calm-cli/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.calm ?? 'dist/index.js';
  return path.resolve(path.dirname(pkgPath), binRel);
}

function loadVersionedSchemas(): Map<string, Map<string, Record<string, unknown>>> {
  const byPrefix = new Map<string, Map<string, Record<string, unknown>>>();

  // 1. Load exact versioned schemas bundled in @finos/calm-cli (1.0, 1.1, 1.2, 1.3, draft/*)
  try {
    const cliPkg = require.resolve('@finos/calm-cli/package.json');
    const calmRoot = path.join(path.dirname(cliPkg), 'dist', 'calm');
    for (const channel of ['release', 'draft']) {
      const channelDir = path.join(calmRoot, channel);
      if (!fs.existsSync(channelDir)) continue;
      for (const ver of fs.readdirSync(channelDir)) {
        const metaDir = path.join(channelDir, ver, 'meta');
        if (!fs.existsSync(metaDir)) continue;
        const prefix = `https://calm.finos.org/${channel}/${ver}/meta/`;
        const files = new Map<string, Record<string, unknown>>();
        for (const file of fs.readdirSync(metaDir)) {
          if (!file.endsWith('.json')) continue;
          files.set(
            file,
            JSON.parse(fs.readFileSync(path.join(metaDir, file), 'utf8')) as Record<string, unknown>
          );
        }
        byPrefix.set(prefix, files);
      }
    }
  } catch {
    // Fallback below
  }

  // 2. Ensure @finos/calm-schema 1.3 is always present
  const schemaPkg = require.resolve('@finos/calm-schema/package.json');
  const schemaDir = path.join(path.dirname(schemaPkg), 'schema');
  const fallbackFiles = new Map<string, Record<string, unknown>>();
  for (const file of fs.readdirSync(schemaDir)) {
    if (!file.endsWith('.json')) continue;
    fallbackFiles.set(
      file,
      JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8')) as Record<string, unknown>
    );
  }
  if (!byPrefix.has('https://calm.finos.org/release/1.3/meta/')) {
    byPrefix.set('https://calm.finos.org/release/1.3/meta/', fallbackFiles);
  }

  return byPrefix;
}

function createCalmAjv(extraPrefixes: Set<string>): InstanceType<typeof Ajv2020> {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: true,
  });
  addFormats(ajv);

  const byPrefix = loadVersionedSchemas();

  // Register every bundled versioned schema cleanly in dependency order
  for (const [prefix, files] of byPrefix.entries()) {
    for (const fileName of ORDERED_FILES) {
      const schemaObj = files.get(fileName);
      if (!schemaObj) continue;
      const id = (schemaObj.$id as string | undefined) ?? `${prefix}${fileName}`;
      if (!ajv.getSchema(id)) {
        ajv.addSchema(schemaObj, id);
      }
    }
  }

  // Alias any extra prefixes (e.g. 1.0-rc1, 1.0-rc2) to closest matching version
  for (const prefix of extraPrefixes) {
    if (byPrefix.has(prefix)) continue;
    const baseFiles = prefix.includes('/1.0')
      ? byPrefix.get('https://calm.finos.org/release/1.0/meta/') ??
        byPrefix.get('https://calm.finos.org/release/1.3/meta/')!
      : byPrefix.get('https://calm.finos.org/release/1.3/meta/')!;

    for (const fileName of ORDERED_FILES) {
      const schemaObj = baseFiles.get(fileName);
      if (!schemaObj) continue;
      const aliasId = `${prefix}${fileName}`;
      if (!ajv.getSchema(aliasId)) {
        const cloned: Record<string, unknown> = { ...schemaObj, $id: aliasId };
        // Legacy 1.0-rc1/1.0-rc2 interface.json included specific interface defs removed in 1.0 final
        if (fileName === 'interface.json' && prefix.includes('/1.0-rc')) {
          const existingDefs = (cloned.defs as Record<string, unknown>) ?? {};
          const legacyInterfaceDef = {
            type: 'object',
            properties: { 'unique-id': { type: 'string' } },
            required: ['unique-id'],
            additionalProperties: true,
          };
          cloned.defs = {
            'url-interface': legacyInterfaceDef,
            'host-port-interface': legacyInterfaceDef,
            'port-interface': legacyInterfaceDef,
            'container-image-interface': legacyInterfaceDef,
            'jdbc-interface': legacyInterfaceDef,
            'queue-interface': legacyInterfaceDef,
            'topic-interface': legacyInterfaceDef,
            ...existingDefs,
          };
        }
        ajv.addSchema(cloned, aliasId);
      }
    }
  }

  return ajv;
}

function formatAjvErrors(validateFn: ValidateFunction): string[] {
  if (!validateFn.errors || validateFn.errors.length === 0) return [];
  return validateFn.errors.map(
    (err) => `${err.instancePath || '/'} ${err.message ?? 'schema validation failed'}`
  );
}

function checkReferentialIntegrity(arch: CalmArchitecture): string[] {
  const errors: string[] = [];
  if (!Array.isArray(arch.nodes) || !Array.isArray(arch.relationships)) {
    return ['Architecture must contain nodes and relationships arrays'];
  }

  const nodeIds = new Set<string>();
  const allIds = new Set<string>();

  for (const node of arch.nodes) {
    const id = node['unique-id'];
    if (!id) {
      errors.push('Node missing unique-id');
      continue;
    }
    if (allIds.has(id)) {
      errors.push(`Duplicate unique-id: ${id}`);
    }
    allIds.add(id);
    nodeIds.add(id);
  }

  for (const rel of arch.relationships) {
    const id = rel['unique-id'];
    if (!id) {
      errors.push('Relationship missing unique-id');
      continue;
    }
    if (allIds.has(id)) {
      errors.push(`Duplicate unique-id: ${id}`);
    }
    allIds.add(id);

    const rt = rel['relationship-type'];
    if (!rt) continue;

    if (rt.connects) {
      if (!nodeIds.has(rt.connects.source.node)) {
        errors.push(
          `Relationship ${id}: connects.source.node "${rt.connects.source.node}" does not exist`
        );
      }
      if (!nodeIds.has(rt.connects.destination.node)) {
        errors.push(
          `Relationship ${id}: connects.destination.node "${rt.connects.destination.node}" does not exist`
        );
      }
    }
    if (rt.interacts) {
      if (!nodeIds.has(rt.interacts.actor)) {
        errors.push(`Relationship ${id}: interacts.actor "${rt.interacts.actor}" does not exist`);
      }
      for (const n of rt.interacts.nodes ?? []) {
        if (!nodeIds.has(n)) errors.push(`Relationship ${id}: interacts node "${n}" does not exist`);
      }
    }
    for (const groupKey of ['deployed-in', 'composed-of'] as const) {
      const group = rt[groupKey];
      if (group) {
        if (!nodeIds.has(group.container)) {
          errors.push(
            `Relationship ${id}: ${groupKey}.container "${group.container}" does not exist`
          );
        }
        for (const n of group.nodes ?? []) {
          if (!nodeIds.has(n)) {
            errors.push(`Relationship ${id}: ${groupKey} node "${n}" does not exist`);
          }
        }
      }
    }
  }

  return errors;
}

export class DifferentialValidator {
  private readonly calmValidate: ValidateFunction;
  private readonly patternValidate: ValidateFunction;

  constructor(pattern: CalmPattern, urlMappingPath?: string) {
    const prefixes = collectCalmRefPrefixes(pattern);
    const ajv = createCalmAjv(prefixes);

    if (urlMappingPath) {
      const absMapping = path.resolve(urlMappingPath);
      const mappingDir = path.dirname(absMapping);
      const mapping = JSON.parse(fs.readFileSync(absMapping, 'utf8')) as Record<string, string>;
      for (const [url, relPath] of Object.entries(mapping)) {
        const targetFile = path.resolve(mappingDir, relPath);
        const schemaObj = JSON.parse(fs.readFileSync(targetFile, 'utf8')) as Record<string, unknown>;
        if (!ajv.getSchema(url)) {
          ajv.addSchema({ ...schemaObj, $id: url }, url);
        }
      }
    }

    const calmSchema = ajv.getSchema('https://calm.finos.org/release/1.3/meta/calm.json');
    if (!calmSchema) {
      throw new Error('Failed to load bundled @finos/calm-schema calm.json');
    }
    this.calmValidate = calmSchema;

    const patternCopy = structuredClone(pattern);
    if (typeof patternCopy.$id === 'string' && ajv.getSchema(patternCopy.$id)) {
      delete patternCopy.$id;
    }
    this.patternValidate = ajv.compile(patternCopy);
  }

  validateBaseCalm(arch: CalmArchitecture): string[] {
    const valid = this.calmValidate(arch);
    const schemaErrors = valid ? [] : formatAjvErrors(this.calmValidate);
    const refErrors = checkReferentialIntegrity(arch);
    return [...schemaErrors, ...refErrors];
  }

  validatePattern(arch: CalmArchitecture): string[] {
    const valid = this.patternValidate(arch);
    return valid ? [] : formatAjvErrors(this.patternValidate);
  }
}

export async function verifyWithCalmCli(
  patternPath: string,
  arch: CalmArchitecture,
  urlMappingPath?: string
): Promise<{ hasErrors: boolean; rawOutput: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calm-mutate-cli-'));
  const tmpArch = path.join(tmpDir, 'mutant.architecture.json');
  try {
    fs.writeFileSync(tmpArch, JSON.stringify(arch, null, 2), 'utf8');
    const cliBin = resolveCalmCliBin();
    try {
      const args = ['validate', '-p', path.resolve(patternPath), '-a', tmpArch];
      if (urlMappingPath) {
        args.push('-u', path.resolve(urlMappingPath));
      }
      const { stdout, stderr } = await execFileAsync(process.execPath, [cliBin, ...args], {
        timeout: 15000,
      });
      const combined = `${stdout}\n${stderr}`;
      const hasErrors = /"hasErrors":\s*true/.test(combined);
      return { hasErrors, rawOutput: combined };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return {
        hasErrors: true,
        rawOutput: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`,
      };
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
