import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ASTNode } from './schemas.js';
import { requestAstGeneration, requestAstCorrection } from './client/ai_client.js';
import { parseTypeScriptFile } from './ingestion/parser.js';
import { analyzeCodeGaps, extractTargetSubgraphs } from './ingestion/gap_analyzer.js';
import { emitTypeScript } from './compiler/ts_emitter.js';
import { applyAtomicPatches, AtomicPatchOperation } from './compiler/atomic_merger.js';
import { verifyTypeScriptCode } from './verification/compiler_guard.js';

export interface EnginePipelineOptions {
  brief?: string;
  specFilePath?: string;
  overviewFilePath?: string;
  sourceFilePath?: string;
  outputFilePath?: string;
  maxRetries?: number;
  auditOnly?: boolean;
  clientOverride?: any;
}

export async function runEnginePipeline(options: EnginePipelineOptions): Promise<{ success: boolean; finalCode: string; attempts: number }> {
  dotenv.config();
  const maxRetries = options.maxRetries ?? 3;

  if (!options.auditOnly && !options.outputFilePath) {
    throw new Error('outputFilePath is required unless auditOnly is true');
  }

  let effectiveBrief = '';
  if (options.overviewFilePath) {
    try {
      const overviewContent = await fs.readFile(options.overviewFilePath, 'utf8');
      effectiveBrief += overviewContent + '\n\n';
    } catch (err) {}
  }
  if (options.specFilePath) {
    try {
      const specContent = await fs.readFile(options.specFilePath, 'utf8');
      effectiveBrief += specContent + '\n\n';
    } catch (err) {}
  }
  if (options.brief) {
    effectiveBrief += options.brief;
  }

  if (!effectiveBrief.trim()) {
    throw new Error('Instruction brief or specFilePath must yield non-empty instructions');
  }

  let currentAst: ASTNode;

  if (options.auditOnly) {
    if (!options.sourceFilePath) {
      throw new Error('sourceFilePath is required for audit-only mode');
    }
    const rootAst = await parseTypeScriptFile(options.sourceFilePath);
    const report = await analyzeCodeGaps(rootAst, effectiveBrief, options.clientOverride);
    const serializedReport = JSON.stringify(report, null, 2);
    if (options.outputFilePath) {
      await fs.mkdir(path.dirname(options.outputFilePath), { recursive: true });
      await fs.writeFile(options.outputFilePath, serializedReport, 'utf8');
    }
    return { success: true, finalCode: serializedReport, attempts: 0 };
  } else if (options.sourceFilePath) {
    let fileExists = false;
    try {
      await fs.access(options.sourceFilePath);
      fileExists = true;
    } catch {}

    if (fileExists) {
      const rootAst = await parseTypeScriptFile(options.sourceFilePath);
      const report = await analyzeCodeGaps(rootAst, effectiveBrief, options.clientOverride);
      const subgraphs = extractTargetSubgraphs(rootAst, report);
      const patches: AtomicPatchOperation[] = [];

      for (const actionItem of report.actions) {
        if (actionItem.resolution === 'KEEP_AS_IS') {
          continue;
        } else if (actionItem.resolution === 'MUTATE_EXISTING') {
          const subBrief = actionItem.specificationForMutation || actionItem.reasoning;
          const contextJson = subgraphs.has(actionItem.targetNodeId) ? JSON.stringify(subgraphs.get(actionItem.targetNodeId)) : undefined;
          const newNode = await requestAstGeneration(subBrief, contextJson, options.clientOverride);
          patches.push({
            action: 'REPLACE',
            targetNodeId: actionItem.targetNodeId,
            newNode,
          });
        } else if (actionItem.resolution === 'SPAWN_NEW') {
          const subBrief = actionItem.specificationForMutation || actionItem.reasoning;
          const newNode = await requestAstGeneration(subBrief, undefined, options.clientOverride);
          patches.push({
            action: 'APPEND_TO_MODULE',
            newNode,
          });
        }
      }

      currentAst = applyAtomicPatches(rootAst, patches);
    } else {
      currentAst = await requestAstGeneration(effectiveBrief, undefined, options.clientOverride);
    }
  } else {
    currentAst = await requestAstGeneration(effectiveBrief, undefined, options.clientOverride);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const emittedCode = emitTypeScript(currentAst);
    const verification = await verifyTypeScriptCode(emittedCode, process.cwd());

    if (verification.success) {
      if (options.outputFilePath) {
        await fs.mkdir(path.dirname(options.outputFilePath), { recursive: true });
        await fs.writeFile(options.outputFilePath, emittedCode, 'utf8');
      }
      return { success: true, finalCode: emittedCode, attempts: attempt };
    }

    if (attempt < maxRetries) {
      currentAst = await requestAstCorrection(currentAst, verification.errors, options.clientOverride);
    } else {
      throw new Error(`Compiler guard failed after ${maxRetries} attempts:\n${verification.errors.join('\n')}`);
    }
  }

  throw new Error('Pipeline failed to emit verified code');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  };

  if (args.includes('--help')) {
    console.log(`Usage: node src/main.ts --out <path> [--spec <path>] [--overview <path>] [--brief <text>] [--src <path>] [--retries <number>] [--audit-only]`);
    process.exit(0);
  }

  const outPath = getArg('--out');
  const specPath = getArg('--spec');
  const overviewPath = getArg('--overview');
  const brief = getArg('--brief');
  const srcPath = getArg('--src');
  const retriesStr = getArg('--retries');
  const auditOnly = args.includes('--audit-only');

  runEnginePipeline({
    outputFilePath: outPath,
    specFilePath: specPath,
    overviewFilePath: overviewPath,
    brief,
    sourceFilePath: srcPath,
    maxRetries: retriesStr ? parseInt(retriesStr, 10) : undefined,
    auditOnly,
  })
    .then((res) => {
      console.log(`Pipeline succeeded in ${res.attempts} attempts.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Pipeline failed:', err);
      process.exit(1);
    });
}
