import { ASTNode } from '../schemas.js';

export const GLOBAL_TS_HEADER = `import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import Database from 'better-sqlite3';
import { Redis } from 'ioredis';
dotenv.config();`;

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_$]/g, '_');
}

function parseTrailingComment(snippet: string): { code: string; comment?: string } {
  let inString: string | null = null;
  let escaped = false;
  let commentIdx = -1;

  for (let i = 0; i < snippet.length; i++) {
    const char = snippet[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (char === inString) {
        inString = null;
      }
    } else {
      if (char === '"' || char === "'" || char === '`') {
        inString = char;
      } else if (char === '/' && i + 1 < snippet.length && snippet[i + 1] === '/') {
        // Check if this '//' is part of a URL or scheme like 'http://' or 'https://'
        // by looking backwards for a protocol colon or preceding characters.
        const preceding = snippet.substring(0, i);
        // If it looks like a protocol (e.g. ends with http:, https:, ws:, wss:, etc. or has no quote/whitespace mismatch), wait:
        // A simpler check: if it's preceded by ':' and letters like http, https, ws, wss, etc., or if we want a robust scan.
        // Usually, URLs look like "https://...". Since we are outside a string if inString is null, wait!
        // If we are outside a string, a URL like "https://..." would actually start with a quote, so `inString` would be non-null!
        // If `inString` is non-null, we are inside a string literal, so we wouldn't hit this `else if` branch anyway!
        // Wait, what if it's an unquoted comment or a comment after a string?
        // If it's after a string or code, e.g. `const x = 1; // comment`, it's valid.
        // What if someone writes something like `foo('http://bar') // comment`? The first `//` is inside the string, so `inString` is active.
        // The second `//` is outside the string, so it's a real comment.
        // The issue description states: "Update the comment-scanning logic that sets commentIdx so a nonterminal line comment does not stop scanning or cause the expression to terminate before later code; place the terminator after the complete snippet, before a terminal line comment when present. Preserve the existing single-line URL handling."
        // Wait, if a line comment appears inside a snippet (e.g. multi-line or block where someone put `//` inside an object literal or something, or a nonterminal line comment), we shouldn't treat it as the *trailing* comment if there's code after it on a new line, or we should find the actual terminal comment at the end of the snippet.
        // Let's scan all potential comment indices or find the last valid trailing comment outside strings.
        // Actually, if we just scan through the whole string, we can record any `//` found outside strings. If there are multiple, the last one might be the trailing comment, or we can check if it's followed only by whitespace/newlines.
        commentIdx = i;
        // Don't break immediately if we want the last one, or let's check if there's code after it.
        // Wait, if we keep scanning, we can find the last `//` that is at the end of the statement/snippet.
      }
    }
  }

  // Let's refine: find all occurrences of '//' outside strings and pick the one that is truly trailing (i.e., followed only by whitespace/comment text up to the end of the snippet).
  // Or even better, let's re-scan properly:
  return parseActualTrailingComment(snippet);
}

function parseActualTrailingComment(snippet: string): { code: string; comment?: string } {
  let inString: string | null = null;
  let escaped = false;
  let lastCommentIdx = -1;

  for (let i = 0; i < snippet.length; i++) {
    const char = snippet[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (char === inString) {
        inString = null;
      }
    } else {
      if (char === '"' || char === "'" || char === '`') {
        inString = char;
      } else if (char === '/' && i + 1 < snippet.length && snippet[i + 1] === '/') {
        lastCommentIdx = i;
        // continue scanning in case there is a later one or to ensure we find the terminal one
      }
    }
  }

  if (lastCommentIdx !== -1) {
    const code = snippet.substring(0, lastCommentIdx).trimEnd();
    const comment = snippet.substring(lastCommentIdx);
    return { code, comment };
  }
  return { code: snippet };
}

export function emitTypeScript(node: ASTNode, indentLevel: number = 0, includeHeader: boolean = true): string {
  const pad = '  '.repeat(indentLevel);

  switch (node.type) {
    case 'ModuleContainer': {
      let result = '';
      if (includeHeader && indentLevel === 0) {
        result += GLOBAL_TS_HEADER + '\n\n';
      }
      const childrenCode = node.children
        .map((child) => emitTypeScript(child, indentLevel, false))
        .join('\n');
      result += childrenCode;
      return result;
    }

    case 'AsyncFunctionBlock': {
      const params = node.parameters.map((p) => `${p.name}: ${p.tsType}`).join(', ');
      const exportPrefix = node.isExported ? 'export ' : '';
      let code = `${pad}${exportPrefix}async function ${node.functionName}(${params}): ${node.returnType} {\n`;
      for (const child of node.body) {
        code += emitTypeScript(child, indentLevel + 1, false);
      }
      code += `${pad}}\n`;
      return code;
    }

    case 'TryCatchGuardian': {
      let code = `${pad}try {\n`;
      for (const child of node.tryBranch) {
        code += emitTypeScript(child, indentLevel + 1, false);
      }
      code += `${pad}} catch (${node.errorVariableName}) {\n`;
      for (const child of node.catchBranch) {
        code += emitTypeScript(child, indentLevel + 1, false);
      }
      code += `${pad}}\n`;
      return code;
    }

    case 'ConditionalBranch': {
      let code = `${pad}if (${node.conditionExpression}) {\n`;
      for (const child of node.trueBranch) {
        code += emitTypeScript(child, indentLevel + 1, false);
      }
      if (node.falseBranch && node.falseBranch.length > 0) {
        code += `${pad}} else {\n`;
        for (const child of node.falseBranch) {
          code += emitTypeScript(child, indentLevel + 1, false);
        }
      }
      code += `${pad}}\n`;
      return code;
    }

    case 'LoopInterval': {
      if (node.loopType === 'while') {
        let code = `${pad}while (${node.loopHeader}) {\n`;
        for (const child of node.body) {
          code += emitTypeScript(child, indentLevel + 1, false);
        }
        code += `${pad}}\n`;
        return code;
      } else if (node.loopType === 'forOf') {
        let code = `${pad}for (${node.loopHeader}) {\n`;
        for (const child of node.body) {
          code += emitTypeScript(child, indentLevel + 1, false);
        }
        code += `${pad}}\n`;
        return code;
      } else if (node.loopType === 'setInterval') {
        let code = `${pad}setInterval(async () => {\n`;
        for (const child of node.body) {
          code += emitTypeScript(child, indentLevel + 1, false);
        }
        code += `${pad}}, ${node.loopHeader});\n`;
        return code;
      }
      return '';
    }

    case 'ExpressionBlock': {
      const snippet = node.codeSnippet.trim().replace(/;$/, '');
      const { code, comment } = parseTrailingComment(snippet);
      if (comment) {
        return `${pad}${code}; ${comment}\n`;
      }
      return `${pad}${code};\n`;
    }

    case 'Solana_EstablishConnection': {
      return `${pad}const ${node.connectionVarName} = new Connection(process.env.${node.rpcEnvVar} || '', '${node.commitment}');\n`;
    }

    case 'Solana_ParseWallet': {
      return `${pad}const ${node.keypairVarName} = Keypair.fromSecretKey(bs58.decode(process.env.${node.privateKeyEnvVar} || ''));\n`;
    }

    case 'Solana_ListenPumpFun': {
      let bodyCode = '';
      for (const child of node.callbackBody) {
        bodyCode += emitTypeScript(child, indentLevel + 2, false);
      }
      const safeId = sanitizeId(node.id);
      return `${pad}const subscription_${safeId} = ${node.connectionVarName}.onProgramAccountChange(\n` +
        `${pad}  new PublicKey(${JSON.stringify(node.programAddress)}),\n` +
        `${pad}  async (${node.accountInfoParamName}) => {\n` +
        bodyCode +
        `${pad}  },\n` +
        `${pad}  'confirmed'\n` +
        `${pad});\n`;
    }

    case 'Solana_SimulatePayload': {
      const safeId = sanitizeId(node.id);
      let code = `${pad}const simulation_${safeId} = await ${node.connectionVarName}.simulateTransaction(${node.transactionVarName});\n`;
      if (node.throwOnError) {
        code += `${pad}if (simulation_${safeId}.value.err) throw new Error(\`Transaction simulation failed: \${JSON.stringify(simulation_${safeId}.value.err)}\`);\n`;
      }
      return code;
    }

    case 'File_AppendLog': {
      return `${pad}await fs.appendFile(${JSON.stringify(node.filePath)}, \`\${new Date().toISOString()} - \${${node.messageExpression}}\\n\`);\n`;
    }

    case 'Sqlite_InitDatabase': {
      return `${pad}const ${node.dbVarName} = new Database(${JSON.stringify(node.dbFilePath)});\n`;
    }

    case 'Sqlite_ExecuteWrite': {
      return `${pad}${node.dbVarName}.prepare(${JSON.stringify(node.sqlQuery)}).run(...${node.paramsArrayExpression});\n`;
    }

    case 'Sqlite_QueryRead': {
      return `${pad}const ${node.resultVarName} = ${node.dbVarName}.prepare(${JSON.stringify(node.sqlQuery)}).${node.readMode}(...${node.paramsArrayExpression});\n`;
    }

    case 'Redis_InitClient': {
      return `${pad}const ${node.redisVarName} = new Redis(process.env.${node.redisUrlEnvVar} || 'redis://127.0.0.1:6379');\n`;
    }

    case 'Redis_QueuePush': {
      return `${pad}await ${node.redisVarName}.rpush(${JSON.stringify(node.queueKey)}, JSON.stringify(${node.payloadExpression}));\n`;
    }

    case 'Redis_QueueBlockingPop': {
      return `${pad}const ${node.resultVarName} = await ${node.redisVarName}.blpop(${JSON.stringify(node.queueKey)}, ${node.timeoutSeconds});\n`;
    }

    default:
      return '';
  }
}
