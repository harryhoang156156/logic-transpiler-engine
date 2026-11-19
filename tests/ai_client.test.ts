import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASTNodeSchema } from '../src/schemas.js';
import { requestAstGeneration, requestAstCorrection, generateStructuredOutput } from '../src/client/ai_client.js';

describe('ai_client', () => {
  const mockClient = {
    chat: {
      completions: {
        create: vi.fn()
      }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateStructuredOutput', () => {
    it('should call OpenAI with correct parameters and return validated result', async () => {
      const mockSchema = z.object({
        type: z.literal('TestNode'),
        value: z.string()
      });
      
      const validResponse = { type: 'TestNode', value: 'test' };
      
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(validResponse) } }]
      });

      const result = await generateStructuredOutput({
        systemInstruction: 'test system',
        userPrompt: 'test user',
        schema: mockSchema,
        clientOverride: mockClient
      });

      expect(result).toEqual(validResponse);
      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'kilo-auto/free',
          messages: [
            { role: 'system', content: 'test system' },
            { role: 'user', content: 'test user' }
          ],
          response_format: expect.objectContaining({
            type: 'json_schema',
            json_schema: expect.objectContaining({
              name: 'ast_output',
              strict: true
            })
          })
        })
      );
    });

    it('should throw validation error for schema-violating response', async () => {
      const mockSchema = z.object({
        type: z.literal('TestNode'),
        value: z.string()
      });
      
      const invalidResponse = { type: 'WrongType', value: 123 };
      
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(invalidResponse) } }]
      });

      await expect(generateStructuredOutput({
        systemInstruction: 'test',
        userPrompt: 'test',
        schema: mockSchema,
        clientOverride: mockClient
      })).rejects.toThrow();
    });

    it('should throw error for invalid JSON response', async () => {
      const mockSchema = z.object({ type: z.string() });
      
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'not valid json' } }]
      });

      await expect(generateStructuredOutput({
        systemInstruction: 'test',
        userPrompt: 'test',
        schema: mockSchema,
        clientOverride: mockClient
      })).rejects.toThrow('Failed to parse LLM response as JSON');
    });

    it('should throw error for empty response', async () => {
      const mockSchema = z.object({ type: z.string() });
      
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '' } }]
      });

      await expect(generateStructuredOutput({
        systemInstruction: 'test',
        userPrompt: 'test',
        schema: mockSchema,
        clientOverride: mockClient
      })).rejects.toThrow('LLM returned empty response');
    });
  });

  describe('requestAstGeneration', () => {
    it('should call generateStructuredOutput with correct prompts and ASTNodeSchema', async () => {
      const validAst = {
        id: 'test-1',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: []
      };
      
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(validAst) } }]
      });

      const result = await requestAstGeneration('test brief', 'context json', mockClient);

      expect(result).toEqual(validAst);
      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ 
              role: 'user',
              content: expect.stringContaining('User Intent:\ntest brief')
            })
          ])
        })
      );
    });

    it('should include context when provided', async () => {
      const validAst = {
        id: 'test-1',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: []
      };
      
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(validAst) } }]
      });

      await requestAstGeneration('test brief', 'existing context', mockClient);

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ 
              role: 'user',
              content: expect.stringContaining('Existing Context Nodes:\nexisting context')
            })
          ])
        })
      );
    });
  });

  describe('requestAstCorrection', () => {
    it('should call generateStructuredOutput with broken AST and errors', async () => {
      const brokenAst = {
        id: 'broken-1',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: []
      };
      
      const fixedAst = {
        id: 'fixed-1',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: ['fixed'],
        children: []
      };
      
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(fixedAst) } }]
      });

      const result = await requestAstCorrection(brokenAst, ['error 1', 'error 2'], mockClient);

      expect(result).toEqual(fixedAst);
      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ 
              role: 'user',
              content: expect.stringContaining('Broken AST:')
            }),
            expect.objectContaining({ 
              role: 'user',
              content: expect.stringContaining('Compiler Errors:')
            })
          ])
        })
      );
    });
  });
});

// Need to import z for the test
import { z } from 'zod';
