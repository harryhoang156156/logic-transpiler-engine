import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runEnginePipeline } from '../src/main.js';
import { ASTNode } from '../src/schemas.js';

describe('main pipeline', () => {
  it('runs greenfield with correction loop', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-test-'));
    const outputPath = path.join(tmpDir, 'output.ts');

    let attempts = 0;
    const clientOverride = {
      chat: {
        completions: {
          create: async () => {
            attempts++;
            if (attempts === 1) {
              const brokenNode: ASTNode = {
                id: 'mod_1',
                type: 'ModuleContainer',
                moduleName: 'Test',
                exports: [],
                children: [
                  {
                    id: 'exp_1',
                    type: 'ExpressionBlock',
                    codeSnippet: 'const x: number = "not a number";',
                  },
                ],
              };
              return { choices: [{ message: { content: JSON.stringify({ ast: brokenNode }) } }] };
            } else {
              const fixedNode: ASTNode = {
                id: 'mod_1',
                type: 'ModuleContainer',
                moduleName: 'Test',
                exports: [],
                children: [
                  {
                    id: 'exp_1',
                    type: 'ExpressionBlock',
                    codeSnippet: 'const x: number = 42;',
                  },
                ],
              };
              return { choices: [{ message: { content: JSON.stringify({ ast: fixedNode }) } }] };
            }
          },
        },
      },
    };

    const res = await runEnginePipeline({
      brief: 'Create a simple constant',
      outputFilePath: outputPath,
      maxRetries: 3,
      clientOverride,
    });

    expect(res.success).toBe(true);
    expect(res.attempts).toBe(2);
    const fileContent = await fs.readFile(outputPath, 'utf8');
    expect(fileContent).toContain('const x: number = 42;');
  });

  it('auto-wraps a bare AsyncFunctionBlock into a ModuleContainer in greenfield mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-test-'));
    const outputPath = path.join(tmpDir, 'output.ts');

    const bareFunction: ASTNode = {
      id: 'fn_1',
      type: 'AsyncFunctionBlock',
      functionName: 'main',
      parameters: [],
      returnType: 'Promise<void>',
      isExported: true,
      body: [
        {
          id: 'exp_1',
          type: 'ExpressionBlock',
          codeSnippet: 'console.log("hello");',
        },
      ],
    };

    const clientOverride = {
      chat: {
        completions: {
          create: async () => {
            return { choices: [{ message: { content: JSON.stringify({ ast: bareFunction }) } }] };
          },
        },
      },
    };

    const res = await runEnginePipeline({
      brief: 'Create a main function',
      outputFilePath: outputPath,
      maxRetries: 1,
      clientOverride,
    });

    expect(res.success).toBe(true);
    const fileContent = await fs.readFile(outputPath, 'utf8');
    expect(fileContent).toContain('async function main');
    expect(fileContent).toContain('console.log("hello");');
  });
});
