import * as ts from 'typescript';
import * as fs from 'node:fs/promises';
import { ASTNode, ASTNodeSchema, ModuleContainer } from '../schemas.js';

let nodeIdCounter = 0;

function generateNodeId(): string {
  nodeIdCounter += 1;
  return `node_${nodeIdCounter}`;
}

function resetNodeIdCounter(): void {
  nodeIdCounter = 0;
}

function parseParameter(param: ts.ParameterDeclaration, sourceFile: ts.SourceFile): { name: string; tsType: string } {
  const name = param.name.getText(sourceFile);
  const tsType = param.type ? param.type.getText(sourceFile) : 'any';
  return { name, tsType };
}

function hasUnsupportedParameterSyntax(node: ts.FunctionDeclaration): boolean {
  return node.parameters.some(
    (param) =>
      param.initializer !== undefined ||
      param.questionToken !== undefined ||
      param.dotDotDotToken !== undefined,
  );
}

function parseFunctionDeclaration(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile): ASTNode {
  const isAsync = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  const functionName = node.name?.getText(sourceFile) ?? 'anonymous';
  const parameters = node.parameters.map(p => parseParameter(p, sourceFile));
  const returnType = node.type ? node.type.getText(sourceFile) : 'Promise<void>';
  const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

  const body: ASTNode[] = [];
  if (node.body) {
    for (const statement of node.body.statements) {
      const parsed = parseStatement(statement, sourceFile);
      if (parsed) {
        body.push(parsed);
      }
    }
  }

  return {
    id: generateNodeId(),
    type: 'AsyncFunctionBlock',
    functionName,
    parameters,
    returnType,
    isExported,
    body,
  };
}

function parseTryStatement(node: ts.TryStatement, sourceFile: ts.SourceFile): ASTNode {
  const tryBranch: ASTNode[] = [];
  if (node.tryBlock) {
    for (const statement of node.tryBlock.statements) {
      const parsed = parseStatement(statement, sourceFile);
      if (parsed) {
        tryBranch.push(parsed);
      }
    }
  }

  const catchBranch: ASTNode[] = [];
  let errorVariableName = 'error';
  if (node.catchClause) {
    if (node.catchClause.variableDeclaration) {
      errorVariableName = node.catchClause.variableDeclaration.name.getText(sourceFile);
    }
    if (node.catchClause.block) {
      for (const statement of node.catchClause.block.statements) {
        const parsed = parseStatement(statement, sourceFile);
        if (parsed) {
          catchBranch.push(parsed);
        }
      }
    }
  }

  return {
    id: generateNodeId(),
    type: 'TryCatchGuardian',
    tryBranch,
    catchBranch,
    errorVariableName,
  };
}

function parseIfStatement(node: ts.IfStatement, sourceFile: ts.SourceFile): ASTNode {
  const conditionExpression = node.expression.getText(sourceFile);
  
  const trueBranch: ASTNode[] = [];
  if (ts.isBlock(node.thenStatement)) {
    for (const statement of node.thenStatement.statements) {
      const parsed = parseStatement(statement, sourceFile);
      if (parsed) {
        trueBranch.push(parsed);
      }
    }
  } else {
    const parsed = parseStatement(node.thenStatement, sourceFile);
    if (parsed) {
      trueBranch.push(parsed);
    }
  }

  let falseBranch: ASTNode[] | undefined;
  if (node.elseStatement) {
    falseBranch = [];
    if (ts.isBlock(node.elseStatement)) {
      for (const statement of node.elseStatement.statements) {
        const parsed = parseStatement(statement, sourceFile);
        if (parsed) {
          falseBranch.push(parsed);
        }
      }
    } else if (ts.isIfStatement(node.elseStatement)) {
      const parsed = parseIfStatement(node.elseStatement, sourceFile);
      falseBranch.push(parsed);
    } else {
      const parsed = parseStatement(node.elseStatement, sourceFile);
      if (parsed) {
        falseBranch.push(parsed);
      }
    }
  }

  return {
    id: generateNodeId(),
    type: 'ConditionalBranch',
    conditionExpression,
    trueBranch,
    falseBranch,
  };
}

function parseLoopStatement(node: ts.ForOfStatement | ts.WhileStatement, sourceFile: ts.SourceFile): ASTNode {
  let loopType: 'forOf' | 'while' = 'while';
  let loopHeader = '';

  if (ts.isForOfStatement(node)) {
    loopType = 'forOf';
    const iterator = node.initializer.getText(sourceFile);
    const iterable = node.expression.getText(sourceFile);
    loopHeader = `${iterator} of ${iterable}`;
  } else if (ts.isWhileStatement(node)) {
    loopType = 'while';
    loopHeader = node.expression.getText(sourceFile);
  }

  const body: ASTNode[] = [];
  if (ts.isBlock(node.statement)) {
    for (const statement of node.statement.statements) {
      const parsed = parseStatement(statement, sourceFile);
      if (parsed) {
        body.push(parsed);
      }
    }
  } else {
    const parsed = parseStatement(node.statement, sourceFile);
    if (parsed) {
      body.push(parsed);
    }
  }

  return {
    id: generateNodeId(),
    type: 'LoopInterval',
    loopType,
    loopHeader,
    body,
  };
}

function parseExpressionBlock(node: ts.Statement, sourceFile: ts.SourceFile): ASTNode {
  let codeSnippet = node.getText(sourceFile);
  const isLoopWithEmptyBody =
    (ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node)) &&
    ts.isEmptyStatement(node.statement);

  if (!isLoopWithEmptyBody) {
    codeSnippet = codeSnippet.replace(/;\s*$/, '');
  }

  return {
    id: generateNodeId(),
    type: 'ExpressionBlock',
    codeSnippet,
  };
}

function parseStatement(node: ts.Statement, sourceFile: ts.SourceFile): ASTNode | null {
  // Preserve import declarations as ExpressionBlocks so imports are retained
  if (ts.isImportDeclaration(node)) {
    return parseExpressionBlock(node, sourceFile);
  }

  if (ts.isFunctionDeclaration(node)) {
    if ((node.typeParameters && node.typeParameters.length > 0) || hasUnsupportedParameterSyntax(node)) {
      return parseExpressionBlock(node, sourceFile);
    }
    return parseFunctionDeclaration(node, sourceFile);
  }

  if (ts.isTryStatement(node)) {
    if (node.finallyBlock) {
      return parseExpressionBlock(node, sourceFile);
    }
    return parseTryStatement(node, sourceFile);
  }

  if (ts.isIfStatement(node)) {
    return parseIfStatement(node, sourceFile);
  }

  if (ts.isForOfStatement(node) || ts.isWhileStatement(node)) {
    if (ts.isForOfStatement(node) && node.awaitModifier) {
      return parseExpressionBlock(node, sourceFile);
    }
    return parseLoopStatement(node, sourceFile);
  }

  return parseExpressionBlock(node, sourceFile);
}

export function parseTypeScriptCode(sourceCode: string, moduleName?: string): ASTNode {
  resetNodeIdCounter();

  const sourceFile = ts.createSourceFile(
    'ingested.ts',
    sourceCode,
    ts.ScriptTarget.ES2022,
    true
  );

  const children: ASTNode[] = [];

  for (const statement of sourceFile.statements) {
    const parsed = parseStatement(statement, sourceFile);
    if (parsed) {
      children.push(parsed);
    }
  }

  const moduleContainer: ModuleContainer = {
    id: generateNodeId(),
    type: 'ModuleContainer',
    moduleName: moduleName ?? 'ingested',
    exports: [],
    children,
  };

  return ASTNodeSchema.parse(moduleContainer);
}

export async function parseTypeScriptFile(filePath: string): Promise<ASTNode> {
  const sourceCode = await fs.readFile(filePath, 'utf-8');
  return parseTypeScriptCode(sourceCode, filePath);
}
