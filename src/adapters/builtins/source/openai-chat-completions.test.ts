import { describe, expect, it } from 'vitest';
import { openAIChatCompletionsSourceAdapter } from './openai-chat-completions';

describe('openAIChatCompletionsSourceAdapter', () => {
  it('enables reasoning_split automatically for passthrough chat/completions requests', () => {
    const body = {
      model: 'MiniMax-M2.7',
      messages: [
        {
          role: 'user',
          content: 'hello'
        }
      ]
    };

    const built = openAIChatCompletionsSourceAdapter.buildPassthroughRequest({
      request: {
        headers: {}
      } as never,
      body,
      source: {
        adapterKey: 'openai_chat'
      },
      config: {
        openaiApiKey: 'sk-test',
        openaiBaseUrl: 'https://mock.local/v1'
      } as never
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    expect(body).not.toHaveProperty('reasoning_split');
    expect(built.value).toMatchObject({
      url: 'https://mock.local/v1/chat/completions',
      body: {
        model: 'MiniMax-M2.7',
        messages: body.messages,
        reasoning_split: true
      }
    });
  });
});
