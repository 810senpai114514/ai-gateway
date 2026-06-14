import { describe, expect, it } from 'vitest';
import { anthropicMessagesTargetAdapter } from '../target/anthropic-messages';
import { openAIResponsesTargetAdapter } from '../target/openai-responses';
import { openAIResponsesSourceAdapter } from './openai-responses';
import { parseOpenAIResponsesRequest } from './parsers';

describe('openAIResponsesSourceAdapter', () => {
  it('restores namespace fields for tool calls returned by another protocol', () => {
    const requestResult = parseOpenAIResponsesRequest({
      model: 'gpt-5.4',
      input: 'Inspect Slack',
      tools: [
        {
          name: 'mcp__computer_use__',
          type: 'namespace',
          tools: [
            {
              name: 'get_app_state',
              type: 'function',
              parameters: {
                type: 'object',
                properties: {
                  app: {
                    type: 'string'
                  }
                },
                required: ['app'],
                additionalProperties: false
              }
            }
          ]
        }
      ]
    });

    expect(requestResult.ok).toBe(true);
    if (!requestResult.ok) {
      return;
    }

    const responseResult = anthropicMessagesTargetAdapter.toStandardResponse({
      id: 'msg_123',
      model: 'claude-3-5-sonnet-latest',
      content: [
        {
          type: 'tool_use',
          id: 'call_66d2f83901fa4f8fa34f74be',
          name: 'mcp__computer_use__.get_app_state',
          input: {
            app: 'Slack'
          }
        }
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5
      },
      stop_reason: 'tool_use'
    });

    expect(responseResult.ok).toBe(true);
    if (!responseResult.ok) {
      return;
    }

    const payload = openAIResponsesSourceAdapter.fromStandardResponse({
      request: {
        headers: {}
      } as never,
      response: responseResult.value,
      standardRequest: requestResult.value,
      source: {
        adapterKey: 'openai_responses'
      },
      config: {} as never
    }) as Record<string, unknown>;

    expect(payload.output).toEqual([
      {
        id: 'call_66d2f83901fa4f8fa34f74be',
        type: 'function_call',
        call_id: 'call_66d2f83901fa4f8fa34f74be',
        name: 'get_app_state',
        namespace: 'mcp__computer_use__',
        arguments: '{"app":"Slack"}',
        status: 'completed'
      }
    ]);
  });

  it('restores namespace fields for normalized chat tool names', () => {
    const requestResult = parseOpenAIResponsesRequest({
      model: 'gpt-5.4',
      input: 'Inspect Slack',
      tools: [
        {
          name: 'mcp__computer_use__',
          type: 'namespace',
          tools: [
            {
              name: 'get_app_state',
              type: 'function',
              parameters: {
                type: 'object',
                properties: {
                  app: {
                    type: 'string'
                  }
                },
                required: ['app'],
                additionalProperties: false
              }
            }
          ]
        }
      ]
    });

    expect(requestResult.ok).toBe(true);
    if (!requestResult.ok) {
      return;
    }

    const responseResult = openAIResponsesTargetAdapter.toStandardResponse({
      id: 'chatcmpl_123',
      object: 'chat.completion',
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_app_state',
                type: 'function',
                function: {
                  name: 'mcp__computer_use___get_app_state',
                  arguments: '{"app":"Slack"}'
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15
      }
    });

    expect(responseResult.ok).toBe(true);
    if (!responseResult.ok) {
      return;
    }

    const payload = openAIResponsesSourceAdapter.fromStandardResponse({
      request: {
        headers: {}
      } as never,
      response: responseResult.value,
      standardRequest: requestResult.value,
      source: {
        adapterKey: 'openai_responses'
      },
      config: {} as never
    }) as Record<string, unknown>;

    expect(payload.output).toEqual([
      {
        id: 'call_app_state',
        type: 'function_call',
        call_id: 'call_app_state',
        name: 'get_app_state',
        namespace: 'mcp__computer_use__',
        arguments: '{"app":"Slack"}',
        status: 'completed'
      }
    ]);
  });

  it('does not split dotted tool names unless the request declared a matching namespace', () => {
    const requestResult = parseOpenAIResponsesRequest({
      model: 'gpt-5.4',
      input: 'Inspect Slack',
      tools: [
        {
          name: 'other_namespace',
          type: 'namespace',
          tools: [
            {
              name: 'read',
              type: 'function',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          ]
        }
      ]
    });

    expect(requestResult.ok).toBe(true);
    if (!requestResult.ok) {
      return;
    }

    const responseResult = anthropicMessagesTargetAdapter.toStandardResponse({
      id: 'msg_123',
      model: 'claude-3-5-sonnet-latest',
      content: [
        {
          type: 'tool_use',
          id: 'call_66d2f83901fa4f8fa34f74be',
          name: 'mcp__computer_use__.get_app_state',
          input: {
            app: 'Slack'
          }
        }
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5
      },
      stop_reason: 'tool_use'
    });

    expect(responseResult.ok).toBe(true);
    if (!responseResult.ok) {
      return;
    }

    const payload = openAIResponsesSourceAdapter.fromStandardResponse({
      request: {
        headers: {}
      } as never,
      response: responseResult.value,
      standardRequest: requestResult.value,
      source: {
        adapterKey: 'openai_responses'
      },
      config: {} as never
    }) as Record<string, unknown>;

    expect(payload.output).toEqual([
      {
        id: 'call_66d2f83901fa4f8fa34f74be',
        type: 'function_call',
        call_id: 'call_66d2f83901fa4f8fa34f74be',
        name: 'mcp__computer_use__.get_app_state',
        arguments: '{"app":"Slack"}',
        status: 'completed'
      }
    ]);
  });
});
