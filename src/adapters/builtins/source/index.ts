import type { SourceAdapter } from '../../../types';
import { anthropicMessagesSourceAdapter } from './anthropic-messages';
import { geminiGenerateContentSourceAdapter } from './gemini-generate-content';
import { geminiStreamGenerateContentSourceAdapter } from './gemini-stream-generate-content';
import { openAIChatCompletionsSourceAdapter } from './openai-chat-completions';
import { openAIResponsesSourceAdapter } from './openai-responses';

export function createBuiltinSourceAdapters(): SourceAdapter[] {
  return [
    openAIResponsesSourceAdapter,
    openAIChatCompletionsSourceAdapter,
    anthropicMessagesSourceAdapter,
    geminiGenerateContentSourceAdapter,
    geminiStreamGenerateContentSourceAdapter
  ];
}
