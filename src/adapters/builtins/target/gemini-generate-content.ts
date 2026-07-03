import type { StandardRequestInputContent, StandardRequestInputMessage, TargetAdapter } from '../../../types';
import { err, ok } from '../../../types';
import { asString, collectStandardInputMessages, isObject } from '../../../utils';
import { buildGeminiUrl } from '../common';
import { parseGeminiToStandardResponse } from './shared';
import { flattenStandardTools, mapStandardToolNameToTargetName, mapToolChoiceFunctionName } from './tools';

const geminiSchemaStringKeys = new Set(['description', 'format', 'title']);
const geminiSchemaNumberKeys = new Set(['maximum', 'minimum', 'maxItems', 'minItems']);
const geminiSchemaArrayKeys = new Set(['enum', 'required', 'propertyOrdering']);

interface GeminiContentConversionState {
  toolNamesById: Map<string, string>;
}

export const geminiGenerateContentTargetAdapter: TargetAdapter = {
  provider: 'gemini',
  buildRequestFromStandard(input) {
    const model = input.standardRequest.model;
    if (!model) {
      return err('Model is required for Gemini target.');
    }

    const urlResult = buildGeminiUrl(
      input.request,
      model,
      'generateContent',
      input.config.geminiApiVersion,
      input.config
    );
    if (!urlResult.ok) {
      return urlResult;
    }

    const generationConfig: Record<string, unknown> = {};
    if (input.standardRequest.temperature !== undefined) {
      generationConfig.temperature = input.standardRequest.temperature;
    }

    if (input.standardRequest.top_p !== undefined) {
      generationConfig.topP = input.standardRequest.top_p;
    }

    if (input.standardRequest.max_output_tokens !== undefined) {
      generationConfig.maxOutputTokens = input.standardRequest.max_output_tokens;
    }

    if (input.standardRequest.stop !== undefined) {
      generationConfig.stopSequences = Array.isArray(input.standardRequest.stop)
        ? input.standardRequest.stop
        : [input.standardRequest.stop];
    }

    const body: Record<string, unknown> = {
      contents: standardInputToGeminiContents(input.standardRequest.input, input.standardRequest.tools)
    };

    if ((body.contents as unknown[]).length === 0) {
      body.contents = [{ role: 'user', parts: [{ text: '' }] }];
    }

    if (input.standardRequest.instructions) {
      body.systemInstruction = {
        parts: [{ text: input.standardRequest.instructions }]
      };
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    const toolsDisabled = isGeminiToolChoiceNone(input.standardRequest.tool_choice);
    const tools = toolsDisabled ? undefined : mapStandardToolsToGeminiTools(input.standardRequest.tools);
    if (tools) {
      body.tools = tools;
    }

    const toolConfig = mapStandardToolChoiceToGeminiToolConfig(
      input.standardRequest.tool_choice,
      input.standardRequest.tools
    );
    if (toolConfig) {
      body.toolConfig = toolConfig;
    }

    return ok({
      url: urlResult.value,
      headers: {
        'content-type': 'application/json'
      },
      body
    });
  },
  toStandardResponse(payload) {
    return parseGeminiToStandardResponse(payload);
  }
};

function standardInputToGeminiContents(
  input: string | StandardRequestInputMessage[],
  tools?: unknown[]
): Array<Record<string, unknown>> {
  const state: GeminiContentConversionState = {
    toolNamesById: new Map()
  };

  return collectStandardInputMessages(input).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: standardContentToGeminiParts(message.content, tools, state)
  }));
}

function standardContentToGeminiParts(
  content: StandardRequestInputContent[],
  tools: unknown[] | undefined,
  state: GeminiContentConversionState
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  const pendingText: string[] = [];
  const flushText = () => {
    const text = pendingText.join('\n').trim();
    pendingText.length = 0;
    if (text) {
      parts.push({ text });
    }
  };

  for (const item of content) {
    if (item.type === 'input_text') {
      if (item.text.trim()) {
        pendingText.push(item.text);
      }
      continue;
    }

    flushText();

    if (item.type === 'reasoning') {
      const reasoningPart = standardReasoningToGeminiThoughtPart(item);
      if (reasoningPart) {
        parts.push(reasoningPart);
      }
      continue;
    }

    if (item.type === 'tool_use') {
      const targetName = mapStandardToolNameToTargetName(item.name, tools);
      state.toolNamesById.set(item.id, targetName);
      parts.push({
        functionCall: {
          name: targetName,
          args: normalizeGeminiFunctionCallArgs(item.input)
        }
      });
      continue;
    }

    if (item.type !== 'tool_result') {
      continue;
    }

    if (item.result_format === 'web_search') {
      parts.push({
        text: `web_search result:\n${item.content}`
      });
      continue;
    }

    const response: Record<string, unknown> = {
      content: item.content
    };
    if (item.is_error !== undefined) {
      response.is_error = item.is_error;
    }

    parts.push({
      functionResponse: {
        name:
          state.toolNamesById.get(item.tool_use_id) ??
          mapStandardToolNameToTargetName(item.tool_use_id, tools),
        response
      }
    });
  }

  flushText();

  return parts.length > 0 ? parts : [{ text: '' }];
}

function standardReasoningToGeminiThoughtPart(
  item: Extract<StandardRequestInputContent, { type: 'reasoning' }>
): Record<string, unknown> | undefined {
  const text = standardReasoningText(item);
  return text ? { text, thought: true } : undefined;
}

function standardReasoningText(
  item: Extract<StandardRequestInputContent, { type: 'reasoning' }>
): string {
  const directText = [item.text, item.summary].filter(Boolean).join('\n').trim();
  if (directText) {
    return directText;
  }

  if (!Array.isArray(item.reasoning_details)) {
    return '';
  }

  return item.reasoning_details
    .map((detail) => {
      if (typeof detail === 'string') {
        return detail;
      }
      if (!isPlainRecord(detail)) {
        return '';
      }
      return (
        asString(detail.thinking) ||
        asString(detail.text) ||
        asString(detail.reasoning) ||
        asString(detail.summary) ||
        ''
      );
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function mapStandardToolsToGeminiTools(tools: unknown[] | undefined): Record<string, unknown>[] | undefined {
  const functionDeclarations = flattenStandardTools(tools).map((tool) => {
    const declaration: Record<string, unknown> = {
      name: tool.targetName,
      parameters: sanitizeGeminiFunctionParameters(tool.parameters)
    };
    if (tool.description) {
      declaration.description = tool.description;
    }

    return declaration;
  });

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;
}

function sanitizeGeminiFunctionParameters(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeGeminiSchema(value);
  return isPlainRecord(sanitized) ? sanitized : { type: 'object', properties: {} };
}

function sanitizeGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeGeminiSchema(item))
      .filter((item) => item !== undefined);
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (key === 'type') {
      assignGeminiSchemaType(output, rawValue);
      continue;
    }

    if (key === 'properties') {
      const properties = sanitizeGeminiSchemaProperties(rawValue);
      if (properties) {
        output.properties = properties;
      }
      continue;
    }

    if (key === 'items') {
      const items = sanitizeGeminiSchemaItems(rawValue);
      if (items) {
        output.items = items;
      }
      continue;
    }

    if (key === 'anyOf' || key === 'any_of') {
      const anyOf = sanitizeGeminiSchemaArray(rawValue);
      if (anyOf) {
        output[key] = anyOf;
      }
      continue;
    }

    if (key === 'nullable') {
      if (typeof rawValue === 'boolean') {
        output.nullable = rawValue;
      }
      continue;
    }

    if (key === 'const') {
      if (typeof rawValue === 'string') {
        output.enum = [rawValue];
      }
      continue;
    }

    if (geminiSchemaStringKeys.has(key)) {
      if (typeof rawValue === 'string') {
        output[key] = rawValue;
      }
      continue;
    }

    if (geminiSchemaNumberKeys.has(key)) {
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        output[key] = rawValue;
      }
      continue;
    }

    if (geminiSchemaArrayKeys.has(key)) {
      if (Array.isArray(rawValue)) {
        output[key] = rawValue;
      }
      continue;
    }
  }

  return output;
}

function assignGeminiSchemaType(target: Record<string, unknown>, value: unknown): void {
  if (typeof value === 'string') {
    target.type = value;
    return;
  }

  if (!Array.isArray(value)) {
    return;
  }

  const types = value.filter((item): item is string => typeof item === 'string');
  const nonNullTypes = types.filter((item) => item.toLowerCase() !== 'null');
  if (types.length !== nonNullTypes.length) {
    target.nullable = true;
  }
  if (nonNullTypes.length > 0) {
    target.type = nonNullTypes[0];
  }
}

function sanitizeGeminiSchemaProperties(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const properties: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(value)) {
    const sanitized = sanitizeGeminiSchema(schema);
    if (isPlainRecord(sanitized)) {
      properties[name] = sanitized;
    }
  }

  return Object.keys(properties).length > 0 ? properties : undefined;
}

function sanitizeGeminiSchemaItems(value: unknown): Record<string, unknown> | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const sanitized = sanitizeGeminiSchema(candidate);
  return isPlainRecord(sanitized) ? sanitized : undefined;
}

function sanitizeGeminiSchemaArray(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item) => sanitizeGeminiSchema(item))
    .filter((item) => isPlainRecord(item));

  return items.length > 0 ? items : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

function mapStandardToolChoiceToGeminiToolConfig(
  toolChoice: unknown,
  tools?: unknown[]
): Record<string, unknown> | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (typeof toolChoice === 'string') {
    if (toolChoice === 'none') {
      return createGeminiFunctionCallingConfig('NONE');
    }

    if (toolChoice === 'auto') {
      return createGeminiFunctionCallingConfig('AUTO');
    }

    if (toolChoice === 'required' || toolChoice === 'any') {
      return createGeminiFunctionCallingConfig('ANY');
    }

    return undefined;
  }

  if (!isObject(toolChoice)) {
    return undefined;
  }

  const type = asString(toolChoice.type);
  if (type === 'none') {
    return createGeminiFunctionCallingConfig('NONE');
  }

  if (type === 'auto') {
    return createGeminiFunctionCallingConfig('AUTO');
  }

  if (type === 'any' || type === 'required') {
    return createGeminiFunctionCallingConfig('ANY');
  }

  const name = mapToolChoiceFunctionName(toolChoice, tools);
  if (name) {
    return createGeminiFunctionCallingConfig('ANY', [name]);
  }

  return undefined;
}

function createGeminiFunctionCallingConfig(
  mode: 'NONE' | 'AUTO' | 'ANY',
  allowedFunctionNames?: string[]
): Record<string, unknown> {
  const functionCallingConfig: Record<string, unknown> = { mode };
  if (allowedFunctionNames && allowedFunctionNames.length > 0) {
    functionCallingConfig.allowedFunctionNames = allowedFunctionNames;
  }

  return { functionCallingConfig };
}

function isGeminiToolChoiceNone(toolChoice: unknown): boolean {
  if (toolChoice === 'none') {
    return true;
  }

  if (!isObject(toolChoice)) {
    return false;
  }

  return asString(toolChoice.type) === 'none';
}

function normalizeGeminiFunctionCallArgs(value: unknown): Record<string, unknown> {
  if (isObject(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
