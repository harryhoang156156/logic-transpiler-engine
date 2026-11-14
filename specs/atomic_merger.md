# Component Specification: `src/compiler/atomic_merger.ts`

## 1. Objective
Prevent logic gaps, dangling references, and partial overwrites by performing atomic, immutable AST replacements in memory. Applies `MUTATE_EXISTING` replacements and `SPAWN_NEW` insertions onto a root `ASTNode` tree as a single transactional operation.

## 2. Dependencies
* External: None
* Internal: `../schemas.js`

## 3. Required Exports & Logic

### A. Data Types
```typescript
export interface AtomicPatchOperation {
  action: 'REPLACE' | 'APPEND_TO_MODULE';
  targetNodeId?: string; // Required for REPLACE
  newNode: ASTNode;
}
```

### B. Core Functions
1. **`applyAtomicPatches(rootAst: ASTNode, operations: AtomicPatchOperation[]): ASTNode`**:
   * Deep-clones `rootAst` (e.g., via `structuredClone`) so failed operations never mutate the original state.
   * Validates that every `REPLACE` operation references an existing `targetNodeId` in the tree before modifying anything. If any ID is missing, throws an error immediately (atomic rollback).
   * Validates every `newNode` against `ASTNodeSchema.parse()`.
   * Recursively traverses all child arrays (`children`, `body`, `tryBranch`, `catchBranch`, `trueBranch`, `falseBranch`, `callbackBody`) to replace matching nodes in-place.
   * For `APPEND_TO_MODULE` operations, appends `newNode` into the root `ModuleContainer`'s `children` array (throws if root is not a `ModuleContainer`).
   * Validates the final merged tree with `ASTNodeSchema.parse()` and returns it.

## 4. Test Requirements (`tests/atomic_merger.test.ts`)
* Verify `REPLACE` swaps a deeply nested node by `id` while preserving sibling nodes and parent hierarchy.
* Verify `APPEND_TO_MODULE` adds a new function node cleanly to the root `ModuleContainer`.
* Verify atomicity: if a batch of 2 operations has 1 valid operation and 1 invalid `targetNodeId`, the function throws an error and leaves the input AST completely untouched.
