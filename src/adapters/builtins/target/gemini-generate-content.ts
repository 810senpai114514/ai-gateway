import type { StandardRequestInputContent, StandardRequestInputMessage, TargetAdapter } from '../../../types';
import { err, ok } from '../../../types';
import { asString, collectStandardInputMessages, isObject } from '../../../utils';
import { buildGeminiUrl } from '../common';
import { parseGeminiToStandardResponse } from './shared';
import { flattenStandardTools, mapStandardToolNameToTargetName, mapToolChoiceFunctionName } from './tools';

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
  return collectStandardInputMessages(input).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: standardContentToGeminiParts(message.content, tools)
  }));
}

function standardContentToGeminiParts(
  content: StandardRequestInputContent[],
  tools?: unknown[]
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  const text = content
    .map((item) => (item.type === 'input_text' ? item.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  if (text) {
    parts.push({ text });
  }

  for (const item of content) {
    if (item.type === 'tool_use') {
      parts.push({
        functionCall: {
          name: mapStandardToolNameToTargetName(item.name, tools),
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

    parts.push({
      functionResponse: {
        name: item.tool_use_id,
        response: {
          content: item.content
        }
      }
    });
  }

  return parts.length > 0 ? parts : [{ text: '' }];
}

function mapStandardToolsToGeminiTools(tools: unknown[] | undefined): Record<string, unknown>[] | undefined {
  const functionDeclarations = flattenStandardTools(tools).map((tool) => {
    const declaration: Record<string, unknown> = {
      name: tool.targetName,
      parameters: tool.parameters
    };
    if (tool.description) {
      declaration.description = tool.description;
    }

    return declaration;
  });

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;
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
