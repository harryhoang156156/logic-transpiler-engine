import { describe, it, expect } from 'vitest';
import { applyAtomicPatches, AtomicPatchOperation } from '../src/compiler/atomic_merger.js';
import { ASTNode, ModuleContainer, AsyncFunctionBlock, ExpressionBlock } from '../src/schemas.js';

describe('atomic_merger', () => {
  const createBaseAst = (): ModuleContainer => ({
    id: 'root_mod',
    type: 'ModuleContainer',
    moduleName: 'test_module',
    exports: ['mainFunction'],
    children: [
      {
        id: 'fn_1',
        type: 'AsyncFunctionBlock',
        functionName: 'mainFunction',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'expr_1',
            type: 'ExpressionBlock',
            codeSnippet: 'const x = 1;',
          },
          {
            id: 'try_1',
            type: 'TryCatchGuardian',
            tryBranch: [
              {
                id: 'expr_nested',
                type: 'ExpressionBlock',
                codeSnippet: 'console.log(x);',
              },
            ],
            catchBranch: [
              {
                id: 'expr_err',
                type: 'ExpressionBlock',
                codeSnippet: 'console.error(error);',
              },
            ],
            errorVariableName: 'error',
          },
        ],
      },
    ],
  });

  it('swaps a deeply nested node by id while preserving sibling nodes and parent hierarchy', () => {
    const baseAst = createBaseAst();
    const replacement: ExpressionBlock = {
      id: 'expr_nested_new',
      type: 'ExpressionBlock',
      codeSnippet: 'console.log("updated", x);',
    };

    const operations: AtomicPatchOperation[] = [
      {
        action: 'REPLACE',
        targetNodeId: 'expr_nested',
        newNode: replacement,
      },
    ];

    const result = applyAtomicPatches(baseAst, operations) as ModuleContainer;

    const fn = result.children[0] as AsyncFunctionBlock;
    expect(fn.body[0].id).toBe('expr_1'); // sibling preserved
    const tryBlock = fn.body[1] as any;
    expect(tryBlock.tryBranch[0].id).toBe('expr_nested_new');
    expect((tryBlock.tryBranch[0] as ExpressionBlock).codeSnippet).toBe('console.log("updated", x);');
    expect(tryBlock.catchBranch[0].id).toBe('expr_err'); // catch branch preserved
  });

  it('adds a new function node cleanly to the root ModuleContainer with APPEND_TO_MODULE', () => {
    const baseAst = createBaseAst();
    const newFunction: AsyncFunctionBlock = {
      id: 'fn_2',
      type: 'AsyncFunctionBlock',
      functionName: 'helperFunction',
      parameters: [{ name: 'val', tsType: 'string' }],
      returnType: 'Promise<void>',
      isExported: false,
      body: [
        {
          id: 'expr_helper',
          type: 'ExpressionBlock',
          codeSnippet: 'console.log(val);',
        },
      ],
    };

    const operations: AtomicPatchOperation[] = [
      {
        action: 'APPEND_TO_MODULE',
        newNode: newFunction,
      },
    ];

    const result = applyAtomicPatches(baseAst, operations) as ModuleContainer;

    expect(result.children.length).toBe(2);
    expect(result.children[0].id).toBe('fn_1');
    expect(result.children[1].id).toBe('fn_2');
    expect((result.children[1] as AsyncFunctionBlock).functionName).toBe('helperFunction');
  });

  it('allows APPEND_TO_MODULE after an earlier REPLACE operation that replaces root with a ModuleContainer', () => {
    const nonModuleRoot: ExpressionBlock = {
      id: 'initial_root',
      type: 'ExpressionBlock',
      codeSnippet: 'console.log("initial");',
    };

    const replacementRoot: ModuleContainer = {
      id: 'new_root_mod',
      type: 'ModuleContainer',
      moduleName: 'replaced_module',
      exports: [],
      children: [],
    };

    const appendNode: ExpressionBlock = {
      id: 'appended_expr',
      type: 'ExpressionBlock',
      codeSnippet: 'const z = 42;',
    };

    const operations: AtomicPatchOperation[] = [
      {
        action: 'REPLACE',
        targetNodeId: 'initial_root',
        newNode: replacementRoot,
      },
      {
        action: 'APPEND_TO_MODULE',
        newNode: appendNode,
      },
    ];

    const result = applyAtomicPatches(nonModuleRoot, operations) as ModuleContainer;
    expect(result.type).toBe('ModuleContainer');
    expect(result.id).toBe('new_root_mod');
    expect(result.children.length).toBe(1);
    expect(result.children[0].id).toBe('appended_expr');
  });

  it('preserves atomicity: if 1 operation is valid and 1 is invalid, throws and leaves input untouched', () => {
    const baseAst = createBaseAst();
    const originalSnapshot = JSON.parse(JSON.stringify(baseAst));

    const validNewNode: ExpressionBlock = {
      id: 'expr_valid',
      type: 'ExpressionBlock',
      codeSnippet: 'const y = 2;',
    };

    const invalidOpNode: ExpressionBlock = {
      id: 'expr_invalid',
      type: 'ExpressionBlock',
      codeSnippet: 'const z = 3;',
    };

    const operations: AtomicPatchOperation[] = [
      {
        action: 'REPLACE',
        targetNodeId: 'expr_1',
        newNode: validNewNode,
      },
      {
        action: 'REPLACE',
        targetNodeId: 'non_existent_node_id',
        newNode: invalidOpNode,
      },
    ];

    expect(() => applyAtomicPatches(baseAst, operations)).toThrow(
      /Target node id "non_existent_node_id" not found/
    );

    // Ensure the original AST was not mutated
    expect(baseAst).toEqual(originalSnapshot);
  });

  it('throws an error if APPEND_TO_MODULE is attempted on a non-ModuleContainer root', () => {
    const nonModuleRoot: ExpressionBlock = {
      id: 'expr_root',
      type: 'ExpressionBlock',
      codeSnippet: 'console.log("hello");',
    };

    const operations: AtomicPatchOperation[] = [
      {
        action: 'APPEND_TO_MODULE',
        newNode: {
          id: 'expr_appended',
          type: 'ExpressionBlock',
          codeSnippet: 'const a = 10;',
        },
      },
    ];

    expect(() => applyAtomicPatches(nonModuleRoot, operations)).toThrow(
      /Cannot append to module: root AST node type is "ExpressionBlock"/
    );
  });

  it('throws an error if a replacement newNode is not a valid ASTNode schema', () => {
    const baseAst = createBaseAst();

    const invalidNode = {
      id: 'broken_node',
      type: 'InvalidNodeType',
    } as unknown as ASTNode;

    const operations: AtomicPatchOperation[] = [
      {
        action: 'REPLACE',
        targetNodeId: 'expr_1',
        newNode: invalidNode,
      },
    ];

    expect(() => applyAtomicPatches(baseAst, operations)).toThrow();
  });
});
