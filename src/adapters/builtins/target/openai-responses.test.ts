import { describe, expect, it } from 'vitest';
import { parseAnthropicMessagesRequest, parseOpenAIResponsesRequest } from '../source/parsers';
import { openAIResponsesTargetAdapter } from './openai-responses';

describe('openAIResponsesTargetAdapter', () => {
  it('converts anthropic tool_use/tool_result history into OpenAI chat tool messages', () => {
    const parsed = parseAnthropicMessagesRequest({
      model: 'claude-3-5-sonnet-latest',
      stream: true,
      max_tokens: 64,
      messages: [
        { role: 'user', content: '先调用工具' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc',
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
              tool_use_id: 'toolu_abc',
              content: '{"temperature":22}'
            }
          ]
        }
      ]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never,
      targetProviderConfig: {
        type: 'openai_chat_completions'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: '先调用工具'
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'toolu_abc',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"Shanghai"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'toolu_abc',
        content: '{"temperature":22}'
      }
    ]);
  });

  it('converts Responses reasoning input into OpenAI chat reasoning fields', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'MiniMax-M2.7',
      input: [
        {
          type: 'reasoning',
          id: 'rs_123',
          status: 'completed',
          content: [
            {
              type: 'reasoning_text',
              text: 'previous reasoning'
            }
          ]
        },
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'previous answer'
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'next turn'
            }
          ]
        }
      ]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never,
      targetProviderConfig: {
        type: 'openai_chat_completions'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'previous reasoning',
        reasoning_details: [
          {
            type: 'reasoning.text',
            text: 'previous reasoning',
            format: 'openai-responses-v1',
            index: 0
          }
        ]
      },
      {
        role: 'assistant',
        content: 'previous answer'
      },
      {
        role: 'user',
        content: 'next turn'
      }
    ]);
  });

  it('passes explicit Responses thinking options into OpenAI chat targets', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'deepseek-v4-pro',
      reasoning: {
        effort: 'max'
      },
      thinking: {
        type: 'enabled'
      },
      output_config: {
        effort: 'low'
      },
      input: 'hello'
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never,
      targetProviderConfig: {
        type: 'openai_chat_completions'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.thinking).toEqual({
      type: 'enabled'
    });
    expect(body.output_config).toEqual({
      effort: 'low'
    });
  });

  it('maps Responses reasoning effort into OpenAI chat thinking options', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'deepseek-v4-pro',
      reasoning: {
        effort: 'max'
      },
      input: 'hello'
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never,
      targetProviderConfig: {
        type: 'openai_chat_completions'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.thinking).toEqual({
      type: 'enabled'
    });
    expect(body.output_config).toEqual({
      effort: 'max'
    });
  });

  it('keeps Responses reasoning on assistant tool call messages when targeting OpenAI chat', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'deepseek-v4-pro',
      input: [
        {
          type: 'reasoning',
          id: 'rs_123',
          status: 'completed',
          content: [
            {
              type: 'reasoning_text',
              text: 'need a tool'
            }
          ]
        },
        {
          type: 'function_call',
          call_id: 'call_weather',
          name: 'get_weather',
          arguments: '{"city":"Shanghai"}'
        },
        {
          type: 'function_call_output',
          call_id: 'call_weather',
          output: '{"temperature":22}'
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'continue'
            }
          ]
        }
      ]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never,
      targetProviderConfig: {
        type: 'openai_chat_completions'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_weather',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"Shanghai"}'
            }
          }
        ],
        reasoning_content: 'need a tool',
        reasoning_details: [
          {
            type: 'reasoning.text',
            text: 'need a tool',
            format: 'openai-responses-v1',
            index: 0
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_weather',
        content: '{"temperature":22}'
      },
      {
        role: 'user',
        content: 'continue'
      }
    ]);
  });

  it('enables reasoning_split automatically when targeting OpenAI chat/completions', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'MiniMax-M2.7',
      input: 'hello'
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never,
      targetProviderConfig: {
        type: 'openai_chat_completions'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(parsed.value.reasoning_split).toBeUndefined();
    expect(body.reasoning_split).toBe(true);
  });

  it('passes reasoning_split when targeting OpenAI chat/completions', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'MiniMax-M2.7',
      reasoning_split: true,
      input: 'hello'
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never,
      targetProviderConfig: {
        type: 'openai_chat_completions'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.reasoning_split).toBe(true);
  });

  it('flattens OpenAI Responses namespace tools when targeting OpenAI chat', () => {
    const parsed = parseOpenAIResponsesRequest({
      model: 'gpt-5.4',
      input: 'Run JavaScript',
      tools: [
        {
          name: 'mcp__node_repl__',
          type: 'namespace',
          tools: [
            {
              name: 'js',
              type: 'function',
              strict: false,
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
            },
            {
              name: 'js_reset',
              type: 'function',
              parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false
              },
              description: 'Reset JavaScript state.'
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

    const built = openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never,
      targetProviderConfig: {
        type: 'openai_chat_completions'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'mcp__node_repl___js',
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
          description: 'Run JavaScript.',
          strict: false
        }
      },
      {
        type: 'function',
        function: {
          name: 'mcp__node_repl___js_reset',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false
          },
          description: 'Reset JavaScript state.'
        }
      }
    ]);
    expect(body.tool_choice).toEqual({
      type: 'function',
      function: {
        name: 'mcp__node_repl___js'
      }
    });
  });
});
