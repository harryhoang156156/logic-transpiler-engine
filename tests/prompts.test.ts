import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT_GENERATOR, SYSTEM_PROMPT_AUDITOR, SYSTEM_PROMPT_DEBUGGER, buildGenerationPrompt, buildAuditPrompt, buildCorrectionPrompt } from '../src/client/prompts.js';

describe('prompts', () => {
  it('SYSTEM_PROMPT_GENERATOR is non-empty and contains required keywords', () => {
    expect(SYSTEM_PROMPT_GENERATOR).toBeTruthy();
    expect(SYSTEM_PROMPT_GENERATOR).toContain('deterministic AST logic generator');
    expect(SYSTEM_PROMPT_GENERATOR).toContain('Solana_');
    expect(SYSTEM_PROMPT_GENERATOR).toContain('Sqlite_');
    expect(SYSTEM_PROMPT_GENERATOR).toContain('Redis_');
    expect(SYSTEM_PROMPT_GENERATOR).toContain('? placeholders');
    expect(SYSTEM_PROMPT_GENERATOR).toContain('unique, sequential id');
  });

  it('SYSTEM_PROMPT_AUDITOR is non-empty and contains required keywords', () => {
    expect(SYSTEM_PROMPT_AUDITOR).toBeTruthy();
    expect(SYSTEM_PROMPT_AUDITOR).toContain('senior software architect');
    expect(SYSTEM_PROMPT_AUDITOR).toContain('KEEP_AS_IS');
    expect(SYSTEM_PROMPT_AUDITOR).toContain('MUTATE_EXISTING');
    expect(SYSTEM_PROMPT_AUDITOR).toContain('SPAWN_NEW');
  });

  it('SYSTEM_PROMPT_DEBUGGER is non-empty and contains required keywords', () => {
    expect(SYSTEM_PROMPT_DEBUGGER).toBeTruthy();
    expect(SYSTEM_PROMPT_DEBUGGER).toContain('tsc --noEmit');
    expect(SYSTEM_PROMPT_DEBUGGER).toContain('compiler diagnostic strings');
    expect(SYSTEM_PROMPT_DEBUGGER).toContain('offending id');
    expect(SYSTEM_PROMPT_DEBUGGER).toContain('corrected, valid ASTNode');
  });

  it('buildGenerationPrompt formats brief and optional context', () => {
    const brief = 'Add a new feature';
    const result = buildGenerationPrompt(brief);
    expect(result).toContain('User Intent:');
    expect(result).toContain(brief);
    expect(result).toContain('\n\nUser Intent:\n');
    expect(result).not.toContain('\\n');
    const resultWithContext = buildGenerationPrompt(brief, 'existing node');
    expect(resultWithContext).toContain('Existing Context Nodes:');
    expect(resultWithContext).toContain('existing node');
    expect(resultWithContext).toContain('\n\nExisting Context Nodes:\n');
    expect(resultWithContext).not.toContain('\\n');
  });

  it('buildAuditPrompt formats existingAstJson and featureBrief', () => {
    const ast = '{"id":"1"}';
    const brief = 'Update something';
    const result = buildAuditPrompt(ast, brief);
    expect(result).toContain('Existing AST:');
    expect(result).toContain(ast);
    expect(result).toContain('Feature Brief:');
    expect(result).toContain(brief);
    expect(result).toContain('\n\nExisting AST:\n');
    expect(result).toContain('\n\nFeature Brief:\n');
    expect(result).not.toContain('\\n');
  });

  it('buildCorrectionPrompt formats brokenAstJson and compilerErrors', () => {
    const broken = '{"id":"2"}';
    const errors = ['Error 1', 'Error 2'];
    const result = buildCorrectionPrompt(broken, errors);
    expect(result).toContain('Broken AST:');
    expect(result).toContain(broken);
    expect(result).toContain('Compiler Errors:');
    expect(result).toContain('Error 1');
    expect(result).toContain('Error 2');
    expect(result).toContain('\n\nBroken AST:\n');
    expect(result).toContain('\n\nCompiler Errors:\n');
    expect(result).toContain('Error 1\nError 2');
    expect(result).not.toContain('\\n');
  });
});
