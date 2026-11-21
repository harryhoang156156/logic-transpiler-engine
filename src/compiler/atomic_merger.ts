import { ASTNode, ASTNodeSchema } from '../schemas.js';

export interface AtomicPatchOperation {
  action: 'REPLACE' | 'APPEND_TO_MODULE';
  targetNodeId?: string; // Required for REPLACE
  newNode: ASTNode;
}

const CHILD_ARRAY_KEYS = [
  'children',
  'body',
  'tryBranch',
  'catchBranch',
  'trueBranch',
  'falseBranch',
  'callbackBody',
] as const;

function collectNodeIds(node: ASTNode, ids: Set<string>): void {
  ids.add(node.id);

  for (const key of CHILD_ARRAY_KEYS) {
    if (key in node) {
      const children = (node as any)[key];
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child && typeof child === 'object' && 'id' in child) {
            collectNodeIds(child as ASTNode, ids);
          }
        }
      }
    }
  }
}

function replaceNodeInTree(
  currentNode: ASTNode,
  targetId: string,
  replacementNode: ASTNode
): boolean {
  for (const key of CHILD_ARRAY_KEYS) {
    if (key in currentNode) {
      const children = (currentNode as any)[key];
      if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child && child.id === targetId) {
            children[i] = replacementNode;
            return true;
          }
          if (child && typeof child === 'object') {
            const replaced = replaceNodeInTree(child as ASTNode, targetId, replacementNode);
            if (replaced) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

export function applyAtomicPatches(
  rootAst: ASTNode,
  operations: AtomicPatchOperation[]
): ASTNode {
  // Deep clone to ensure atomic transaction isolation
  const clonedAst: ASTNode = structuredClone(rootAst);

  // Validate all new nodes up front
  for (const op of operations) {
    ASTNodeSchema.parse(op.newNode);
  }

  // Check preconditions before modifying
  const existingIds = new Set<string>();
  collectNodeIds(clonedAst, existingIds);

  for (const op of operations) {
    if (op.action === 'REPLACE') {
      if (!op.targetNodeId) {
        throw new Error('AtomicPatchOperation with action "REPLACE" must have targetNodeId.');
      }
      if (!existingIds.has(op.targetNodeId)) {
        throw new Error(`Target node id "${op.targetNodeId}" not found in AST.`);
      }
    } else if (op.action === 'APPEND_TO_MODULE') {
      if (clonedAst.type !== 'ModuleContainer') {
        throw new Error(
          `Cannot append to module: root AST node type is "${clonedAst.type}", expected "ModuleContainer".`
        );
      }
    } else {
      throw new Error(`Unknown action: "${(op as any).action}".`);
    }
  }

  // Apply operations
  for (const op of operations) {
    if (op.action === 'REPLACE') {
      const targetId = op.targetNodeId!;
      if (clonedAst.id === targetId) {
        // Replacing the root node itself
        return ASTNodeSchema.parse(op.newNode);
      }
      const replaced = replaceNodeInTree(clonedAst, targetId, op.newNode);
      if (!replaced) {
        throw new Error(`Failed to replace node with id "${targetId}".`);
      }
    } else if (op.action === 'APPEND_TO_MODULE') {
      (clonedAst as any).children.push(op.newNode);
    }
  }

  return ASTNodeSchema.parse(clonedAst);
}
