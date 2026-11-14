# Component Specification: `src/ingestion/gap_analyzer.ts`

## 1. Objective
Implement the Autonomous Logic Auditor. Compares an ingested `ASTNode` JSON graph against a user's feature brief and forces the LLM to output a structured resolution plan (`KEEP_AS_IS`, `MUTATE_EXISTING`, or `SPAWN_NEW`) for every module/function node, preventing blind overwrites or logic gaps.

## 2. Dependencies
* External: None
* Internal: `../schemas.js`, `../client/ai_client.js`, `../client/prompts.js`

## 3. Required Exports & Logic

### A. Core Functions
1. **`analyzeCodeGaps(existingAst: ASTNode, featureBrief: string, clientOverride?: any): Promise<GapAnalysisReport>`**:
   * Serializes `existingAst` into formatted JSON.
   * Calls `generateStructuredOutput` from `ai_client.ts` passing `SYSTEM_PROMPT_AUDITOR`, `buildAuditPrompt(serializedAst, featureBrief)`, and `GapAnalysisReportSchema`.
   * Validates that every `targetNodeId` referenced in `MUTATE_EXISTING` or `KEEP_AS_IS` actually exists within `existingAst` (using a recursive ID-collector helper). Throws an error if the LLM hallucinates a non-existent `targetNodeId`.
2. **`extractTargetSubgraphs(rootAst: ASTNode, report: GapAnalysisReport): Map<string, ASTNode>`**:
   * Helper function that locates and extracts the exact `ASTNode` subtrees marked as `MUTATE_EXISTING` so they can be passed cleanly into `requestAstGeneration` for isolated modification.

## 4. Test Requirements (`tests/gap_analyzer.test.ts`)
* Mock `clientOverride` to return a valid `GapAnalysisReport` referencing IDs present in a sample `ASTNode` tree; verify `analyzeCodeGaps` succeeds and `extractTargetSubgraphs` returns the exact matching subtrees.
* Mock `clientOverride` to return a `targetNodeId` that does not exist in the input AST; verify `analyzeCodeGaps` throws a validation error.
