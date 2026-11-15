#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import {
  ALL_OPERATORS,
  applySchemaPatches,
  renderCounterexampleSvg,
  runMutationAudit,
  type CalmPattern,
  type MutationOperatorId,
  type MutationReport,
} from './index.js';

function formatTextReport(report: MutationReport, showFixes: boolean): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`calm-mutate — Adversarial Conformance Report`);
  lines.push(`Pattern:  ${report.patternPath}`);
  lines.push(
    `Seed:     ${report.seedSource} (valid CALM: ${report.seedValidAgainstCalm}, valid Pattern: ${report.seedValidAgainstPattern})`
  );
  lines.push(
    `Score:    ${report.mutationScore}% (${report.killed}/${report.validMutants} valid mutants killed, ${report.survived} survived, ${report.invalidCalm} invalid-calm skipped) [${report.durationMs}ms]`
  );
  lines.push('');

  const survivors = report.results.filter((r) => r.outcome === 'survived');
  if (survivors.length === 0) {
    lines.push('PASS: All valid adversarial mutants were rejected by the pattern.');
  } else {
    lines.push(`SURVIVING MUTANTS (${survivors.length} pattern bypasses):`);
    for (const res of survivors) {
      const m = res.mutant;
      const cliTag = res.cliConfirmed ? ' [cli-confirmed]' : '';
      lines.push(
        `  [SURVIVED] (${m.severity.toUpperCase()}) [${m.operator}] ${m.description}${cliTag}`
      );
    }
  }

  if (showFixes && report.suggestedFixes.length > 0) {
    lines.push('');
    lines.push(`SUGGESTED SCHEMA FIXES (${report.suggestedFixes.length} JSON Patch operations):`);
    for (const fix of report.suggestedFixes) {
      lines.push(`  - ${fix.op.toUpperCase()} ${fix.path} => ${JSON.stringify(fix.value)}`);
      lines.push(`    Reason: ${fix.reason}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function toSarif(report: MutationReport): Record<string, unknown> {
  const survivors = report.results.filter((r) => r.outcome === 'survived');
  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'calm-mutate',
            version: '0.1.0',
            informationUri: 'https://github.com/aksharprabhudesai/calm-mutate',
          },
        },
        results: survivors.map((s) => ({
          ruleId: `calm-mutate/${s.mutant.operator}`,
          level: s.mutant.severity === 'medium' ? 'warning' : 'error',
          message: {
            text: `Pattern allowed adversarial mutant (${s.mutant.id}): ${s.mutant.description}`,
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: path.basename(report.patternPath),
                },
              },
            },
          ],
        })),
      },
    ],
  };
}

const program = new Command();
program
  .name('calm-mutate')
  .description('Adversarial conformance & mutation testing for FINOS CALM Patterns')
  .version('0.1.0')
  .requiredOption('-p, --pattern <path>', 'Path to CALM .pattern.json file')
  .option('-a, --seed <path>', 'Optional conforming architecture JSON seed (auto-generated if omitted)')
  .option('--operators <list>', `Comma-separated operators (${ALL_OPERATORS.join(',')})`)
  .option('--min-score <number>', 'Minimum required mutation score (0-100)', '0')
  .option('--format <type>', 'Output format: text | json | sarif', 'text')
  .option('--out-dir <dir>', 'Write surviving mutant JSONs (and SVGs with --svg) to directory')
  .option('--svg', 'Export SVG counterexample diagrams for surviving mutants to --out-dir', false)
  .option('--fix', 'Print suggested JSON Patch fixes for surviving mutants', false)
  .option('--apply-fix <path>', 'Write a hardened copy of the pattern with suggested fixes applied')
  .option('--verify-cli', 'Cross-verify surviving mutants with @finos/calm-cli validate', false)
  .action(async (opts) => {
    const operators = opts.operators
      ? (String(opts.operators)
          .split(',')
          .map((s) => s.trim()) as MutationOperatorId[])
      : undefined;

    const report = await runMutationAudit({
      patternPath: opts.pattern,
      seedPath: opts.seed,
      operators,
      verifyCli: Boolean(opts.verifyCli),
    });

    if (opts.outDir) {
      const outDir = path.resolve(opts.outDir);
      fs.mkdirSync(outDir, { recursive: true });
      const survivors = report.results.filter((r) => r.outcome === 'survived');
      for (const s of survivors) {
        fs.writeFileSync(
          path.join(outDir, `${s.mutant.id}.architecture.json`),
          JSON.stringify(s.mutant.architecture, null, 2),
          'utf8'
        );
        if (opts.svg) {
          fs.writeFileSync(
            path.join(outDir, `${s.mutant.id}.svg`),
            renderCounterexampleSvg(s.mutant),
            'utf8'
          );
        }
      }
      fs.writeFileSync(
        path.join(outDir, 'mutation-report.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    }

    if (opts.applyFix && report.suggestedFixes.length > 0) {
      const origPattern = JSON.parse(fs.readFileSync(report.patternPath, 'utf8')) as CalmPattern;
      const patched = applySchemaPatches(origPattern, report.suggestedFixes);
      fs.writeFileSync(path.resolve(opts.applyFix), JSON.stringify(patched, null, 2), 'utf8');
    }

    if (opts.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else if (opts.format === 'sarif') {
      console.log(JSON.stringify(toSarif(report), null, 2));
    } else {
      console.log(formatTextReport(report, Boolean(opts.fix)));
    }

    const minScore = Number(opts.minScore ?? 0);
    if (report.mutationScore < minScore) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
