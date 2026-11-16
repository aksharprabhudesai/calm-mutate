import fs from 'node:fs';
import path from 'node:path';
import type {
  CalmPattern,
  MutateOptions,
  MutationReport,
  MutationResult,
} from './types.js';
import { DifferentialValidator, verifyWithCalmCli } from './validator.js';
import { resolveSeedArchitecture } from './seed.js';
import { ALL_OPERATORS, generateMutants } from './operators/index.js';
import { suggestSchemaFixes } from './fix-suggester.js';
import { findMatchingWaiver, loadWaivers } from './waivers.js';

export async function runMutationAudit(options: MutateOptions): Promise<MutationReport> {
  const start = performance.now();
  const absPatternPath = path.resolve(options.patternPath);
  const pattern = JSON.parse(fs.readFileSync(absPatternPath, 'utf8')) as CalmPattern;
  const waivers = options.waiversPath ? loadWaivers(options.waiversPath) : [];

  const { architecture: seed, seedSource } = await resolveSeedArchitecture(
    absPatternPath,
    options.seedPath,
    options.urlMappingPath
  );

  const validator = new DifferentialValidator(pattern, options.urlMappingPath);
  const seedCalmErrors = validator.validateBaseCalm(seed);
  const seedPatternErrors = validator.validatePattern(seed);

  const operators = options.operators ?? ALL_OPERATORS;
  const mutants = generateMutants(seed, operators);

  const results: MutationResult[] = [];
  let killed = 0;
  let survived = 0;
  let waived = 0;
  let invalidCalm = 0;

  for (const mutant of mutants) {
    const calmErrors = validator.validateBaseCalm(mutant.architecture);
    if (calmErrors.length > 0) {
      invalidCalm++;
      results.push({
        mutant,
        outcome: 'invalid-calm',
        calmErrors,
        patternErrors: [],
      });
      continue;
    }

    const patternErrors = validator.validatePattern(mutant.architecture);
    if (patternErrors.length === 0) {
      let cliConfirmed: boolean | undefined;
      let outcome: 'survived' | 'killed' | 'waived' = 'survived';

      if (options.verifyCli) {
        const cliRes = await verifyWithCalmCli(
          absPatternPath,
          mutant.architecture,
          options.urlMappingPath
        );
        cliConfirmed = !cliRes.hasErrors;
        if (cliRes.hasErrors) {
          outcome = 'killed';
        }
      }

      let matchedWaiver;
      if (outcome === 'survived' && waivers.length > 0) {
        matchedWaiver = findMatchingWaiver(waivers, mutant, absPatternPath);
        if (matchedWaiver) {
          outcome = 'waived';
        }
      }

      if (outcome === 'survived') {
        survived++;
      } else if (outcome === 'waived') {
        waived++;
      } else {
        killed++;
      }

      results.push({
        mutant,
        outcome,
        calmErrors: [],
        patternErrors: outcome === 'killed' ? ['Rejected by @finos/calm-cli validate'] : [],
        cliConfirmed,
        waiver: matchedWaiver,
      });
    } else {
      killed++;
      results.push({
        mutant,
        outcome: 'killed',
        calmErrors: [],
        patternErrors,
      });
    }
  }

  const validMutants = killed + survived + waived;
  const mutationScore =
    validMutants === 0 ? 0 : Math.round(((killed + waived) / validMutants) * 1000) / 10;

  const suggestedFixes = suggestSchemaFixes(pattern, results);
  const durationMs = Math.round(performance.now() - start);

  return {
    patternPath: absPatternPath,
    seedSource,
    seedValidAgainstCalm: seedCalmErrors.length === 0,
    seedValidAgainstPattern: seedPatternErrors.length === 0,
    totalGenerated: mutants.length,
    validMutants,
    killed,
    survived,
    waived,
    invalidCalm,
    mutationScore,
    durationMs,
    results,
    suggestedFixes,
  };
}
