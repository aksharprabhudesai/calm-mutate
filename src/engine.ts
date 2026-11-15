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

export async function runMutationAudit(options: MutateOptions): Promise<MutationReport> {
  const start = performance.now();
  const absPatternPath = path.resolve(options.patternPath);
  const pattern = JSON.parse(fs.readFileSync(absPatternPath, 'utf8')) as CalmPattern;

  const { architecture: seed, seedSource } = await resolveSeedArchitecture(
    absPatternPath,
    options.seedPath
  );

  const validator = new DifferentialValidator(pattern);
  const seedCalmErrors = validator.validateBaseCalm(seed);
  const seedPatternErrors = validator.validatePattern(seed);

  const operators = options.operators ?? ALL_OPERATORS;
  const mutants = generateMutants(seed, operators);

  const results: MutationResult[] = [];
  let killed = 0;
  let survived = 0;
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
      let outcome: 'survived' | 'killed' = 'survived';

      if (options.verifyCli) {
        const cliRes = await verifyWithCalmCli(absPatternPath, mutant.architecture);
        cliConfirmed = !cliRes.hasErrors;
        if (cliRes.hasErrors) {
          outcome = 'killed';
        }
      }

      if (outcome === 'survived') {
        survived++;
      } else {
        killed++;
      }

      results.push({
        mutant,
        outcome,
        calmErrors: [],
        patternErrors: outcome === 'killed' ? ['Rejected by @finos/calm-cli validate'] : [],
        cliConfirmed,
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

  const validMutants = killed + survived;
  const mutationScore =
    validMutants === 0 ? 100 : Math.round((killed / validMutants) * 1000) / 10;

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
    invalidCalm,
    mutationScore,
    durationMs,
    results,
    suggestedFixes,
  };
}
