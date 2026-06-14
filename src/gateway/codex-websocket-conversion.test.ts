import { describe, expect, it } from 'vitest';
import { transformClientMessageToCodexRequest } from './codex-websocket-conversion';

describe('transformClientMessageToCodexRequest', () => {
  it('passes through response.create payload', () => {
    const payload = JSON.stringify({
      type: 'response.create',
      model: 'gpt-5',
      input: 'hello'
    });

    const result = transformClientMessageToCodexRequest(payload);
    expect(result.kind).toBe('passthrough');
    if (result.kind !== 'passthrough') {
      return;
    }

    expect(result.payload).toBe(payload);
  });

  it('converts openai chat request into response.create', () => {
    const result = transformClientMessageToCodexRequest(
      JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are concise.'
          },
          {
            role: 'user',
            content: 'hello'
          }
        ]
      })
    );

    expect(result.kind).toBe('converted');
    if (result.kind !== 'converted') {
      return;
    }

    const body = JSON.parse(result.payload) as Record<string, unknown>;
    expect(body.type).toBe('response.create');
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.instructions).toBe('You are concise.');
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }]
      }
    ]);
  });

  it('converts anthropic messages request into response.create', () => {
    const result = transformClientMessageToCodexRequest(
      JSON.stringify({
        anthropic_version: '2023-06-01',
        model: 'claude-3-5-sonnet',
        max_tokens: 128,
        messages: [
          {
            role: 'user',
            content: '请总结下面内容'
          }
        ]
      })
    );

    expect(result.kind).toBe('converted');
    if (result.kind !== 'converted') {
      return;
    }

    const body = JSON.parse(result.payload) as Record<string, unknown>;
    expect(body.type).toBe('response.create');
    expect(body.model).toBe('claude-3-5-sonnet');
    expect(body.max_output_tokens).toBe(128);
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '请总结下面内容' }]
      }
    ]);
  });

  it('converts gemini request into response.create', () => {
    const result = transformClientMessageToCodexRequest(
      JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: '你好' }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 64
        }
      })
    );

    expect(result.kind).toBe('converted');
    if (result.kind !== 'converted') {
      return;
    }

    const body = JSON.parse(result.payload) as Record<string, unknown>;
    expect(body.type).toBe('response.create');
    expect(body.max_output_tokens).toBe(64);
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '你好' }]
      }
    ]);
  });

  it('wraps openai responses body as response.create and defaults stream=true', () => {
    const result = transformClientMessageToCodexRequest(
      JSON.stringify({
        model: 'gpt-5',
        input: 'ping'
      })
    );

    expect(result.kind).toBe('converted');
    if (result.kind !== 'converted') {
      return;
    }

    const body = JSON.parse(result.payload) as Record<string, unknown>;
    expect(body).toEqual({
      type: 'response.create',
      model: 'gpt-5',
      input: 'ping',
      stream: true
    });
  });

  it('returns error when explicit source adapter payload is invalid', () => {
    const result = transformClientMessageToCodexRequest(
      JSON.stringify({
        source_adapter: 'openai_chat',
        body: {
          messages: []
        }
      })
    );

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') {
      return;
    }

    expect(result.message).toContain('non-empty messages array');
  });
});
