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
  let terminalCommentIdx = -1;

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
        const newlineIdx = snippet.indexOf('\n', i + 2);
        if (newlineIdx === -1) {
          terminalCommentIdx = i;
          break;
        } else {
          const remainder = snippet.substring(newlineIdx + 1);
          if (remainder.trim().length === 0) {
            terminalCommentIdx = i;
            break;
          } else {
            i = newlineIdx;
            continue;
          }
        }
      }
    }
  }

  if (terminalCommentIdx !== -1) {
    const code = snippet.substring(0, terminalCommentIdx).trimEnd();
    const comment = snippet.substring(terminalCommentIdx);
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
      if (snippet.startsWith('import ')) {
        return `${pad}${snippet};\n`;
      }
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
