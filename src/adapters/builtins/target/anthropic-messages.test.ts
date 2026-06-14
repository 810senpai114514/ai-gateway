import { describe, expect, it } from 'vitest';
import { parseOpenAIChatCompletionsRequest, parseOpenAIResponsesRequest } from '../source/parsers';
import { anthropicMessagesTargetAdapter } from './anthropic-messages';

describe('anthropicMessagesTargetAdapter', () => {
  it('sets a default max_tokens when converted request does not provide one', () => {
    const parsed = parseOpenAIChatCompletionsRequest({
      model: 'glm-5',
      messages: [{ role: 'user', content: 'what is your knowledge cutoff date' }]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = anthropicMessagesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        anthropicApiKey: 'sk-test',
        anthropicBaseUrl: 'https://mock.local'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.max_tokens).toBe(1024);
  });

  it('keeps max_tokens from chat/completions request when provided', () => {
    const parsed = parseOpenAIChatCompletionsRequest({
      model: 'glm-5',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = anthropicMessagesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        anthropicApiKey: 'sk-test',
        anthropicBaseUrl: 'https://mock.local'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.max_tokens).toBe(256);
  });

  it('passes through stream=true for anthropic upstream streaming', () => {
    const parsed = parseOpenAIChatCompletionsRequest({
      model: 'glm-5',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = anthropicMessagesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        anthropicApiKey: 'sk-test',
        anthropicBaseUrl: 'https://mock.local'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.stream).toBe(true);
  });

  it('maps tools, tool_choice, assistant tool_calls, and tool messages into anthropic messages', () => {
    const parsed = parseOpenAIChatCompletionsRequest({
      model: 'glm-5',
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather.',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string' }
              },
              required: ['city']
            }
          }
        }
      ],
      tool_choice: {
        type: 'function',
        function: {
          name: 'get_weather'
        }
      },
      messages: [
        { role: 'user', content: 'What is the weather in Shanghai?' },
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
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_weather',
          content: '{"temperature":22}'
        }
      ]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = anthropicMessagesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        anthropicApiKey: 'sk-test',
        anthropicBaseUrl: 'https://mock.local'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        name: 'get_weather',
        description: 'Get current weather.',
        input_schema: {
          type: 'object',
          properties: {
            city: { type: 'string' }
          },
          required: ['city']
        }
      }
    ]);
    expect(body.tool_choice).toEqual({
      type: 'tool',
      name: 'get_weather'
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What is the weather in Shanghai?'
          }
        ]
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_weather',
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
            tool_use_id: 'call_weather',
            content: '{"temperature":22}'
          }
        ]
      }
    ]);
  });

  it('maps chat reasoning_details into Anthropic thinking blocks before tool_use', () => {
    const parsed = parseOpenAIChatCompletionsRequest({
      model: 'MiniMax-M2.7',
      messages: [
        { role: 'user', content: 'Use a tool' },
        {
          role: 'assistant',
          content: '',
          reasoning_content: 'interleaved thinking',
          reasoning_details: [
            {
              type: 'reasoning.text',
              text: 'interleaved thinking',
              format: 'anthropic-claude-v1',
              signature: 'sig_123',
              index: 0
            }
          ],
          tool_calls: [
            {
              id: 'call_weather',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"city":"Shanghai"}'
              }
            }
          ]
        }
      ]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = anthropicMessagesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        anthropicApiKey: 'sk-test',
        anthropicBaseUrl: 'https://mock.local'
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
        content: [
          {
            type: 'text',
            text: 'Use a tool'
          }
        ]
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'interleaved thinking',
            signature: 'sig_123'
          },
          {
            type: 'tool_use',
            id: 'call_weather',
            name: 'get_weather',
            input: {
              city: 'Shanghai'
            }
          }
        ]
      }
    ]);
  });

  it('flattens OpenAI Responses namespace tools when targeting Anthropic', () => {
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
      ]
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const built = anthropicMessagesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest: parsed.value,
      config: {
        anthropicApiKey: 'sk-test',
        anthropicBaseUrl: 'https://mock.local'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const body = built.value.body as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        name: 'mcp__node_repl___js',
        description: 'Run JavaScript.',
        input_schema: {
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
    ]);
  });
});
