import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { verifyTypeScriptCode } from '../src/verification/compiler_guard.js';

describe('compiler_guard', () => {
  it('returns success: true for valid TypeScript code', async () => {
    const validCode = `const x: number = 42;\nexport { x };\n`;
    const result = await verifyTypeScriptCode(validCode, process.cwd());

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns success: false with formatted diagnostics for type mismatch', async () => {
    const invalidCode = `const x: number = "not_a_number";\nexport { x };\n`;
    const result = await verifyTypeScriptCode(invalidCode, process.cwd());

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((err) => err.includes('TS2322'))).toBe(true);
  });

  it('works when projectRootDir is omitted and defaults to os.tmpdir()', async () => {
    const validCode = `const greeting: string = "hello world";\nexport { greeting };\n`;
    const result = await verifyTypeScriptCode(validCode);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('detects syntax errors properly', async () => {
    const brokenSyntax = `const broken = {;\n`;
    const result = await verifyTypeScriptCode(brokenSyntax, process.cwd());

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
