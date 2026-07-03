import { describe, expect, it } from 'vitest';
import { formatAnthropicMessagesResponse } from '../source/formatters';
import { parseAnthropicMessagesRequest, parseOpenAIResponsesRequest } from '../source/parsers';
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
              }
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

  it('sanitizes tool schemas to the Gemini schema subset', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'gemini-2.5-pro',
      input: 'Run tool',
      tools: [
        {
          name: 'complex_tool',
          type: 'function',
          parameters: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            additionalProperties: false,
            propertyNames: { pattern: '^[a-z]+$' },
            required: ['items', 'mode'],
            properties: {
              items: {
                type: 'array',
                additionalProperties: false,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    count: {
                      type: 'integer',
                      exclusiveMinimum: 0,
                      minimum: 0
                    }
                  }
                }
              },
              mode: {
                anyOf: [
                  { type: 'string', enum: ['fast'] },
                  { const: 'safe' }
                ]
              },
              maybe: {
                type: ['string', 'null']
              }
            }
          }
        }
      ]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = geminiGenerateContentTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {},
        url: '/v1beta/models/gemini-2.5-pro:generateContent?beta=tools-2024-04-04'
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
            name: 'complex_tool',
            parameters: {
              type: 'object',
              required: ['items', 'mode'],
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      count: {
                        type: 'integer',
                        minimum: 0
                      }
                    }
                  }
                },
                mode: {
                  anyOf: [
                    { type: 'string', enum: ['fast'] },
                    { enum: ['safe'] }
                  ]
                },
                maybe: {
                  nullable: true,
                  type: 'string'
                }
              }
            }
          }
        ]
      }
    ]);
    expect(built.value.url).toBe('https://mock.local/v1beta/models/gemini-2.5-pro:generateContent?key=sk-test');
  });

  it('maps Anthropic thinking and tool calls into Gemini content parts', () => {
    const parsed = parseAnthropicMessagesRequest({
      model: 'gemini-2.5-pro',
      max_tokens: 1024,
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather.',
          input_schema: {
            type: 'object',
            required: ['city'],
            properties: {
              city: {
                type: 'string'
              }
            }
          }
        }
      ],
      messages: [
        {
          role: 'user',
          content: 'Weather in Shanghai?'
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Need to call the weather tool.',
              signature: 'anthropic-signature'
            },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'get_weather',
              input: {
                city: 'Shanghai'
              }
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'Sunny, 28 C.'
            }
          ]
        }
      ]
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
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'Weather in Shanghai?' }]
      },
      {
        role: 'model',
        parts: [
          {
            text: 'Need to call the weather tool.',
            thought: true
          },
          {
            functionCall: {
              name: 'get_weather',
              args: {
                city: 'Shanghai'
              }
            }
          }
        ]
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'get_weather',
              response: {
                content: 'Sunny, 28 C.'
              }
            }
          }
        ]
      }
    ]);
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'get_weather',
            description: 'Get weather.',
            parameters: {
              type: 'object',
              required: ['city'],
              properties: {
                city: {
                  type: 'string'
                }
              }
            }
          }
        ]
      }
    ]);
  });

  it('maps Gemini thought and function calls back into Anthropic tool_use responses', () => {
    const parsed = geminiGenerateContentTargetAdapter.toStandardResponse({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                text: 'Need to call the weather tool.',
                thought: true
              },
              {
                functionCall: {
                  name: 'get_weather',
                  args: {
                    city: 'Shanghai'
                  }
                }
              }
            ]
          },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 8,
        totalTokenCount: 20
      },
      modelVersion: 'gemini-2.5-pro'
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.value.output_text).toBe('');
    expect(parsed.value.output).toEqual([
      expect.objectContaining({
        type: 'reasoning',
        content: [
          {
            type: 'reasoning_text',
            text: 'Need to call the weather tool.'
          }
        ]
      }),
      expect.objectContaining({
        type: 'function_call',
        name: 'get_weather',
        arguments: '{"city":"Shanghai"}'
      })
    ]);

    const anthropic = formatAnthropicMessagesResponse(parsed.value);
    expect(anthropic.stop_reason).toBe('tool_use');
    expect(anthropic.content).toEqual([
      {
        type: 'thinking',
        thinking: 'Need to call the weather tool.'
      },
      {
        type: 'tool_use',
        id: expect.any(String),
        name: 'get_weather',
        input: {
          city: 'Shanghai'
        }
      }
    ]);
  });
});
