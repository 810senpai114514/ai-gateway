import { describe, expect, it } from 'vitest';
import { parseOpenAIResponsesRequest } from '../source/parsers';
import { geminiGenerateContentTargetAdapter } from './gemini-generate-content';

describe('geminiGenerateContentTargetAdapter', () => {
  it('flattens OpenAI Responses namespace tools when targeting Gemini', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'gemini-2.5-pro',
      input: 'Run JavaScript',
      tools: [
        {
          name: 'mcp__node_repl__',
          type: 'namespace',
          tools: [
            {
              name: 'js',
              type: 'function',
              parameters: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: {
                    type: 'string'
                  }
                },
                additionalProperties: false
              },
              description: 'Run JavaScript.'
            }
          ],
          description: 'Node REPL tools.'
        }
      ],
      tool_choice: {
        type: 'function',
        name: 'mcp__node_repl__.js'
      }
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = geminiGenerateContentTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {},
        url: '/v1beta/models/gemini-2.5-pro:generateContent'
      } as never,
      standardRequest: parsed.value,
      config: {
        geminiApiKey: 'sk-test',
        geminiBaseUrl: 'https://mock.local',
        geminiApiVersion: 'v1beta'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'mcp__node_repl___js',
            description: 'Run JavaScript.',
            parameters: {
              type: 'object',
              required: ['code'],
              properties: {
                code: {
                  type: 'string'
                }
              },
              additionalProperties: false
            }
          }
        ]
      }
    ]);
    expect(body.toolConfig).toEqual({
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: ['mcp__node_repl___js']
      }
    });
  });
});
