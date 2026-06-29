import { Readable } from 'node:stream';
import { bench, describe } from 'vitest';
import { anthropicMessagesSourceAdapter } from '../adapters/builtins/source/anthropic-messages';
import { geminiGenerateContentSourceAdapter } from '../adapters/builtins/source/gemini-generate-content';
import { openAIChatCompletionsSourceAdapter } from '../adapters/builtins/source/openai-chat-completions';
import { openAIResponsesSourceAdapter } from '../adapters/builtins/source/openai-responses';
import {
  parseAnthropicMessagesRequest,
  parseGeminiGenerateContentRequest,
  parseOpenAIChatCompletionsRequest,
  parseOpenAIResponsesRequest
} from '../adapters/builtins/source/parsers';
import { anthropicMessagesTargetAdapter } from '../adapters/builtins/target/anthropic-messages';
import { geminiGenerateContentTargetAdapter } from '../adapters/builtins/target/gemini-generate-content';
import { openAIResponsesTargetAdapter } from '../adapters/builtins/target/openai-responses';
import type { Result, StandardRequest, StandardResponse } from '../types';
import {
  collectAnthropicNonStreamPayloadFromEventStream,
  collectOpenAINonStreamPayloadFromEventStream
} from './streaming-conversion';

describe('source request parsing benchmarks', () => {
  bench('parse OpenAI Responses request with tools, reasoning, and multimodal content', () => {
    assertOk(parseOpenAIResponsesRequest(openAIResponsesRequest));
  });

  bench('parse OpenAI Chat Completions request with tool calls and tool results', () => {
    assertOk(parseOpenAIChatCompletionsRequest(openAIChatCompletionsRequest));
  });

  bench('parse Anthropic Messages request with thinking, tools, and tool results', () => {
    assertOk(parseAnthropicMessagesRequest(anthropicMessagesRequest));
  });

  bench('parse Gemini generateContent request with function calls and responses', () => {
    assertOk(parseGeminiGenerateContentRequest(geminiGenerateContentRequest, 'gemini-2.5-pro'));
  });
});

describe('target request construction benchmarks', () => {
  bench('build OpenAI Responses request from standard request', () => {
    assertOk(openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest,
      config: openAIConfig
    }));
  });

  bench('build OpenAI Chat Completions request from standard request', () => {
    assertOk(openAIResponsesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest,
      config: openAIConfig,
      targetProviderConfig: {
        type: 'openai_chat_completions',
        openaiChatStreamUsage: 'include_usage'
      } as never
    }));
  });

  bench('build Anthropic Messages request from standard request', () => {
    assertOk(anthropicMessagesTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {}
      } as never,
      standardRequest,
      config: anthropicConfig
    }));
  });

  bench('build Gemini generateContent request from standard request', () => {
    assertOk(geminiGenerateContentTargetAdapter.buildRequestFromStandard({
      request: {
        headers: {},
        url: '/v1beta/models/gemini-2.5-pro:generateContent?alt=sse'
      } as never,
      standardRequest,
      config: geminiConfig
    }));
  });
});

describe('target response normalization benchmarks', () => {
  bench('convert OpenAI Responses payload to standard response', () => {
    assertOk(openAIResponsesTargetAdapter.toStandardResponse(openAIResponsesPayload));
  });

  bench('convert OpenAI Chat Completions payload to standard response', () => {
    assertOk(openAIResponsesTargetAdapter.toStandardResponse(openAIChatCompletionPayload));
  });

  bench('convert Anthropic Messages payload to standard response', () => {
    assertOk(anthropicMessagesTargetAdapter.toStandardResponse(anthropicMessagesPayload));
  });

  bench('convert Gemini generateContent payload to standard response', () => {
    assertOk(geminiGenerateContentTargetAdapter.toStandardResponse(geminiGenerateContentPayload));
  });
});

describe('source response formatting benchmarks', () => {
  bench('format standard response as OpenAI Responses payload', () => {
    const payload = openAIResponsesSourceAdapter.fromStandardResponse({
      request: {
        headers: {}
      } as never,
      response: standardResponse,
      standardRequest,
      source: {
        adapterKey: 'openai_responses'
      },
      config: openAIConfig
    });
    assertObject(payload);
  });

  bench('format standard response as OpenAI Chat Completions payload', () => {
    const payload = openAIChatCompletionsSourceAdapter.fromStandardResponse({
      request: {
        headers: {}
      } as never,
      response: standardResponse,
      source: {
        adapterKey: 'openai_chat'
      },
      config: openAIConfig
    });
    assertObject(payload);
  });

  bench('format standard response as Anthropic Messages payload', () => {
    const payload = anthropicMessagesSourceAdapter.fromStandardResponse({
      request: {
        headers: {}
      } as never,
      response: standardResponse,
      source: {
        adapterKey: 'anthropic_messages'
      },
      config: anthropicConfig
    });
    assertObject(payload);
  });

  bench('format standard response as Gemini generateContent payload', () => {
    const payload = geminiGenerateContentSourceAdapter.fromStandardResponse({
      request: {
        headers: {}
      } as never,
      response: standardResponse,
      source: {
        adapterKey: 'gemini_generate'
      },
      config: geminiConfig
    });
    assertObject(payload);
  });
});

describe('stream collection benchmarks', () => {
  bench('collect OpenAI Responses event stream into non-stream payload', async () => {
    const payload = await collectOpenAINonStreamPayloadFromEventStream(createSseResponse(openAIResponsesSseFrames));
    assertContains(payload.output_text, 'Benchmark response chunk 119');
  });

  bench('collect OpenAI Chat Completions event stream into non-stream payload', async () => {
    const payload = await collectOpenAINonStreamPayloadFromEventStream(createSseResponse(openAIChatSseFrames));
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
    assertObject(choice);
  });

  bench('collect Anthropic Messages event stream into non-stream payload', async () => {
    const payload = await collectAnthropicNonStreamPayloadFromEventStream(createSseResponse(anthropicSseFrames));
    assertContains(payload.model, 'claude');
  });
});

const toolParameters = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
  },
  required: ['city'],
  additionalProperties: false
};

const standardTools = [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get current weather.',
    parameters: toolParameters
  },
  {
    name: 'mcp__node_repl__',
    type: 'namespace',
    tools: [
      {
        name: 'js',
        type: 'function',
        description: 'Run JavaScript.',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string' }
          },
          required: ['code'],
          additionalProperties: false
        }
      }
    ]
  }
];

const openAIResponsesRequest = {
  model: 'gpt-5.4',
  instructions: 'Answer concisely and call tools when useful.',
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Compare weather in Shanghai and San Francisco.' },
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        }
      ]
    },
    {
      type: 'reasoning',
      id: 'rs_bench',
      status: 'completed',
      summary: [{ type: 'summary_text', text: 'Need two weather lookups.' }],
      content: [{ type: 'reasoning_text', text: 'Call weather API for both cities.' }]
    },
    {
      type: 'function_call',
      call_id: 'call_weather_shanghai',
      name: 'get_weather',
      arguments: '{"city":"Shanghai","unit":"celsius"}'
    },
    {
      type: 'function_call_output',
      call_id: 'call_weather_shanghai',
      output: '{"temperature":28,"condition":"humid"}'
    }
  ],
  tools: standardTools,
  tool_choice: 'auto',
  temperature: 0.2,
  max_output_tokens: 512,
  reasoning: {
    effort: 'medium'
  }
};

const openAIChatCompletionsRequest = {
  model: 'gpt-5.4',
  messages: [
    { role: 'system', content: 'You are a benchmark assistant.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Compare weather in Shanghai and San Francisco.' },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        }
      ]
    },
    {
      role: 'assistant',
      content: '',
      reasoning_content: 'Need a weather lookup.',
      tool_calls: [
        {
          id: 'call_weather_shanghai',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"city":"Shanghai","unit":"celsius"}'
          }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'call_weather_shanghai',
      content: '{"temperature":28,"condition":"humid"}'
    }
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather.',
        parameters: toolParameters
      }
    }
  ],
  tool_choice: 'required',
  stream: true,
  max_tokens: 512
};

const anthropicMessagesRequest = {
  model: 'claude-sonnet-4-5',
  system: 'You are a benchmark assistant.',
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Compare weather in Shanghai and San Francisco.' }]
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'Need a weather lookup.',
          signature: 'sig_bench'
        },
        {
          type: 'tool_use',
          id: 'toolu_weather_shanghai',
          name: 'get_weather',
          input: {
            city: 'Shanghai',
            unit: 'celsius'
          }
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_weather_shanghai',
          content: '{"temperature":28,"condition":"humid"}'
        }
      ]
    }
  ],
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather.',
      input_schema: toolParameters
    }
  ],
  tool_choice: {
    type: 'auto'
  },
  max_tokens: 512,
  stream: true
};

const geminiGenerateContentRequest = {
  contents: [
    {
      role: 'user',
      parts: [{ text: 'Compare weather in Shanghai and San Francisco.' }]
    },
    {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'get_weather',
            args: {
              city: 'Shanghai',
              unit: 'celsius'
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
              content: '{"temperature":28,"condition":"humid"}'
            }
          }
        }
      ]
    }
  ],
  systemInstruction: {
    parts: [{ text: 'You are a benchmark assistant.' }]
  },
  tools: [
    {
      functionDeclarations: [
        {
          name: 'get_weather',
          description: 'Get current weather.',
          parameters: toolParameters
        }
      ]
    }
  ],
  toolConfig: {
    functionCallingConfig: {
      mode: 'ANY',
      allowedFunctionNames: ['get_weather']
    }
  },
  generationConfig: {
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 512,
    stopSequences: ['END']
  }
};

const standardRequest = assertOk(parseOpenAIResponsesRequest(openAIResponsesRequest));

const standardResponse: StandardResponse = {
  id: 'resp_bench',
  object: 'response',
  status: 'completed',
  model: 'gpt-5.4',
  output_text: 'Shanghai is warmer and more humid than San Francisco.',
  output: [
    {
      id: 'rs_bench',
      type: 'reasoning',
      status: 'completed',
      summary: [{ type: 'summary_text', text: 'Compared weather tool results.' }],
      content: [{ type: 'reasoning_text', text: 'Use both tool results and summarize differences.' }],
      reasoning_details: [
        {
          type: 'reasoning.text',
          text: 'Use both tool results and summarize differences.',
          format: 'openai-responses-v1',
          index: 0
        }
      ]
    },
    {
      id: 'msg_bench',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: 'Shanghai is warmer and more humid than San Francisco.',
          annotations: []
        }
      ]
    },
    {
      id: 'call_weather_sf',
      type: 'function_call',
      call_id: 'call_weather_sf',
      name: 'get_weather',
      arguments: '{"city":"San Francisco","unit":"celsius"}',
      status: 'completed'
    }
  ],
  usage: {
    input_tokens: 180,
    output_tokens: 64,
    total_tokens: 244,
    cache_read_tokens: 48,
    cache_write_tokens: 12,
    server_tool_use: {
      web_search_requests: 1
    }
  },
  finish_reason: 'tool_calls'
};

const openAIResponsesPayload = {
  id: 'resp_bench',
  object: 'response',
  status: 'completed',
  model: 'gpt-5.4',
  output_text: 'The benchmark response combines reasoning, text, and a tool call.',
  output: [
    {
      id: 'rs_bench',
      type: 'reasoning',
      status: 'completed',
      summary: [{ type: 'summary_text', text: 'Need one additional weather lookup.' }],
      content: [{ type: 'reasoning_text', text: 'Ask the weather tool for San Francisco.' }]
    },
    {
      id: 'msg_bench',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: 'The benchmark response combines reasoning, text, and a tool call.',
          annotations: []
        }
      ]
    },
    {
      id: 'call_weather_sf',
      type: 'function_call',
      call_id: 'call_weather_sf',
      name: 'get_weather',
      arguments: '{"city":"San Francisco","unit":"celsius"}',
      status: 'completed'
    }
  ],
  usage: {
    input_tokens: 180,
    output_tokens: 35,
    total_tokens: 215,
    input_tokens_details: {
      cached_tokens: 64,
      cache_creation_tokens: 12
    }
  }
};

const openAIChatCompletionPayload = {
  id: 'chatcmpl_bench',
  object: 'chat.completion',
  model: 'gpt-5.4',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'The benchmark response combines text and a tool call.',
        tool_calls: [
          {
            id: 'call_weather_sf',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"San Francisco","unit":"celsius"}'
            }
          }
        ],
        reasoning_content: 'Need one additional weather lookup.'
      },
      finish_reason: 'tool_calls'
    }
  ],
  usage: {
    prompt_tokens: 180,
    completion_tokens: 35,
    total_tokens: 215,
    prompt_tokens_details: {
      cached_tokens: 64
    }
  }
};

const anthropicMessagesPayload = {
  id: 'msg_bench',
  model: 'claude-sonnet-4-5',
  role: 'assistant',
  content: [
    {
      type: 'thinking',
      thinking: 'Need one additional weather lookup.',
      signature: 'sig_bench'
    },
    {
      type: 'text',
      text: 'The benchmark response combines text and a tool call.'
    },
    {
      type: 'tool_use',
      id: 'toolu_weather_sf',
      name: 'get_weather',
      input: {
        city: 'San Francisco',
        unit: 'celsius'
      }
    }
  ],
  stop_reason: 'tool_use',
  usage: {
    input_tokens: 180,
    output_tokens: 35,
    cache_read_input_tokens: 64,
    cache_creation_input_tokens: 12,
    server_tool_use: {
      web_search_requests: 1
    }
  }
};

const geminiGenerateContentPayload = {
  candidates: [
    {
      index: 0,
      content: {
        role: 'model',
        parts: [
          {
            text: 'The benchmark response combines text with Gemini usage metadata.'
          }
        ]
      },
      finishReason: 'STOP'
    }
  ],
  usageMetadata: {
    promptTokenCount: 180,
    candidatesTokenCount: 35,
    totalTokenCount: 215,
    cachedContentTokenCount: 64
  },
  modelVersion: 'gemini-2.5-pro'
};

const openAIResponsesSseFrames = [
  'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_bench","object":"response","model":"gpt-5.4"}}\n\n',
  ...Array.from({ length: 120 }, (_, index) => {
    const text = `Benchmark response chunk ${index}. `;
    return `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: 'response.output_text.delta',
      output_index: 0,
      content_index: 0,
      item_id: 'msg_bench',
      delta: text
    })}\n\n`;
  }),
  `event: response.output_item.done\ndata: ${JSON.stringify({
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: 'msg_bench',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: Array.from({ length: 120 }, (_, index) => `Benchmark response chunk ${index}. `).join(''),
          annotations: []
        }
      ]
    }
  })}\n\n`,
  'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_bench","object":"response","model":"gpt-5.4","status":"completed","output":[],"usage":{"input_tokens":120,"output_tokens":80,"total_tokens":200}}}\n\n',
  'data: [DONE]\n\n'
];

const openAIChatSseFrames = [
  'data: {"id":"chatcmpl_bench","object":"chat.completion.chunk","model":"gpt-5.4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
  ...Array.from({ length: 120 }, (_, index) => {
    const text = `Benchmark chat chunk ${index}. `;
    return `data: ${JSON.stringify({
      id: 'chatcmpl_bench',
      object: 'chat.completion.chunk',
      model: 'gpt-5.4',
      choices: [
        {
          index: 0,
          delta: {
            content: text
          },
          finish_reason: null
        }
      ]
    })}\n\n`;
  }),
  'data: {"id":"chatcmpl_bench","object":"chat.completion.chunk","model":"gpt-5.4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":80,"total_tokens":200}}\n\n',
  'data: [DONE]\n\n'
];

const anthropicSseFrames = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_bench","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"usage":{"input_tokens":120,"output_tokens":0,"cache_read_input_tokens":32}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
  ...Array.from({ length: 20 }, (_, index) => {
    return `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'thinking_delta',
        thinking: `Thinking chunk ${index}. `
      }
    })}\n\n`;
  }),
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
  ...Array.from({ length: 120 }, (_, index) => {
    return `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'text_delta',
        text: `Benchmark Anthropic chunk ${index}. `
      }
    })}\n\n`;
  }),
  'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_weather_sf","name":"get_weather","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"San Francisco\\",\\"unit\\":\\"celsius\\"}"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":80,"cache_creation_input_tokens":12,"server_tool_use":{"web_search_requests":1}}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
];

const openAIConfig = {
  openaiApiKey: 'sk-test',
  openaiBaseUrl: 'https://mock.local',
  auth: {
    enabled: false
  }
} as never;

const anthropicConfig = {
  anthropicApiKey: 'sk-test',
  anthropicBaseUrl: 'https://mock.local',
  auth: {
    enabled: false
  }
} as never;

const geminiConfig = {
  geminiApiKey: 'sk-test',
  geminiBaseUrl: 'https://mock.local',
  geminiApiVersion: 'v1beta'
} as never;

assertOk(parseOpenAIChatCompletionsRequest(openAIChatCompletionsRequest));
assertOk(parseAnthropicMessagesRequest(anthropicMessagesRequest));
assertOk(parseGeminiGenerateContentRequest(geminiGenerateContentRequest, 'gemini-2.5-pro'));
assertOk(openAIResponsesTargetAdapter.toStandardResponse(openAIResponsesPayload));
assertOk(openAIResponsesTargetAdapter.toStandardResponse(openAIChatCompletionPayload));
assertOk(anthropicMessagesTargetAdapter.toStandardResponse(anthropicMessagesPayload));
assertOk(geminiGenerateContentTargetAdapter.toStandardResponse(geminiGenerateContentPayload));

function assertOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.value;
}

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected object benchmark result.');
  }
}

function assertContains(value: unknown, needle: string): void {
  if (typeof value !== 'string' || !value.includes(needle)) {
    throw new Error(`Expected benchmark result to contain ${needle}.`);
  }
}

function createSseResponse(frames: string[]): Response {
  const body = Readable.from(frames);
  return new Response(body as never, {
    headers: {
      'content-type': 'text/event-stream'
    }
  });
}
