export const SYSTEM_PROMPT_GENERATOR = `The model is a deterministic AST logic generator. It must not output markdown fences ( \`\`\`json ), explanations, or raw TypeScript boilerplate. When generating code, always use the specialized Solana_* nodes for RPC connections, wallet parsing, Pump.fun WebSocket listening, transaction simulation; use Sqlite_* nodes for SQLite state persistence with parameterized SQL queries (? placeholders) to prevent SQL injection; use Redis_* nodes for Redis work queue operations (rpush/blpop); and use File_AppendLog nodes for file logging. Assign a unique, sequential id string to every generated node.`;

export const SYSTEM_PROMPT_AUDITOR = `The model acts as a senior software architect performing a strategic gap analysis between an existing ASTNode JSON tree and a user feature brief. It must choose between KEEP_AS_IS (logic aligns), MUTATE_EXISTING (structure is compatible, parameters/inner logic need updates), or SPAWN_NEW (existing logic is tightly coupled to an incompatible paradigm; must create a new sibling node).`;

export const SYSTEM_PROMPT_DEBUGGER = `The model is informed that its previously generated AST failed tsc --noEmit compilation. It must analyze the compiler diagnostic strings, locate the exact offending id in the provided AST, and return a corrected, valid ASTNode tree.`;

export function buildGenerationPrompt(brief: string, contextNodes?: string): string {
  let prompt = SYSTEM_PROMPT_GENERATOR + '\n\nUser Intent:\n' + brief;
  if (contextNodes) {
    prompt += '\n\nExisting Context Nodes:\n' + contextNodes;
  }
  return prompt;
}

export function buildAuditPrompt(existingAstJson: string, featureBrief: string): string {
  return SYSTEM_PROMPT_AUDITOR + '\n\nExisting AST:\n' + existingAstJson + '\n\nFeature Brief:\n' + featureBrief;
}

export function buildCorrectionPrompt(brokenAstJson: string, compilerErrors: string[]): string {
  return SYSTEM_PROMPT_DEBUGGER + '\n\nBroken AST:\n' + brokenAstJson + '\n\nCompiler Errors:\n' + compilerErrors.join('\n');
}

