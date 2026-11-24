import ts from 'typescript';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface VerificationResult {
  success: boolean;
  errors: string[];
}

export async function verifyTypeScriptCode(
  code: string,
  projectRootDir?: string
): Promise<VerificationResult> {
  const baseDir = projectRootDir ?? os.tmpdir();
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const tempFileName = `temp_verification_${Date.now()}_${randomSuffix}.ts`;
  const tempFilePath = path.join(baseDir, tempFileName);

  try {
    await fs.writeFile(tempFilePath, code, 'utf-8');

    const compilerOptions: ts.CompilerOptions = {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
    };

    const program = ts.createProgram([tempFilePath], compilerOptions);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    if (diagnostics.length === 0) {
      return {
        success: true,
        errors: [],
      };
    }

    const errors: string[] = diagnostics.map((diag) => {
      let lineInfo = '';
      if (diag.file && diag.start !== undefined) {
        const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
        lineInfo = `Line ${line + 1}:${character + 1} - `;
      }
      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      return `${lineInfo}TS${diag.code}: ${message}`;
    });

    return {
      success: false,
      errors,
    };
  } finally {
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // Ignore cleanup error if file was already removed or never created
    }
  }
}

