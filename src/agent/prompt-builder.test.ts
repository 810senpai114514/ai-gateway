import { describe, expect, it } from 'vitest';
import {
  buildModelInputText,
  buildSystemPrompt,
  parseTriggerToolResult,
  type ParsedTriggerToolResult
} from './prompt-builder';
import type { AgentEvent, AgentSessionState, AgentToolDefinition } from './types';

function createSession(): AgentSessionState {
  return {
    sessionId: 'session-1',
    agentId: 'agent-1',
    systemPrompt: 'You are a coding assistant.',
    model: 'openai/gpt-4o-mini',
    allowedTools: ['searchTool'],
    memoryRefs: ['keep the current failure mode in mind'],
    messages: [],
    pendingToolCalls: {
      'call-1': {
        toolCallId: 'call-1',
        toolName: 'searchTool',
        arguments: { mode: 'broad', query: 'gateway agent' },
        status: 'error',
        requestedAt: '2026-04-10T10:00:02.000Z',
        completedAt: '2026-04-10T10:00:03.000Z',
        error: 'Search returned irrelevant results'
      }
    },
    taskState: {
      id: 'session-1',
      goal: 'Continue debugging why searchTool returns the wrong result.',
      activeStep: 'Retry with a narrower search query',
      constraints: ['Do not repeat the broad search path'],
      done: ['Observed one failed broad search'],
      todo: ['Try a narrower query'],
      status: 'running'
    },
    guards: {
      doNotRepeat: ['Do not repeat searchTool {"mode":"broad","query":"gateway agent"}'],
      doNotForget: ['Latest failure: broad search returned irrelevant results'],
      doNotViolate: ['Do not go down the previous path again']
    },
    transcriptWindow: {
      items: [
        {
          type: 'user',
          text: 'Do not go down the previous path again.'
        },
        {
          type: 'assistant',
          text: 'I will inspect why the previous path failed first.'
        },
        {
          type: 'tool_call',
          tool: 'searchTool',
          args: '{"mode":"broad","query":"gateway agent"}'
        },
        {
          type: 'failure',
          text: 'searchTool failed: Search returned irrelevant results'
        }
      ]
    },
    lastEventOffset: 0,
    updatedAt: '2026-04-10T10:00:04.000Z'
  };
}

function createUserInputEvent(text: string): AgentEvent {
  return {
    id: 'event-user-1',
    type: 'USER_INPUT',
    sessionId: 'session-1',
    timestamp: '2026-04-10T10:00:05.000Z',
    correlationId: 'corr-1',
    payload: {
      text
    }
  };
}

function createToolResultEvent(overrides: Partial<Record<string, unknown>> = {}): AgentEvent {
  return {
    id: 'event-tool-1',
    type: 'TOOL_RESULT',
    sessionId: 'session-1',
    timestamp: '2026-04-10T10:00:06.000Z',
    correlationId: 'corr-1',
    payload: {
      toolCallId: 'call-1',
      toolName: 'searchTool',
      status: 'error',
      error: 'Search returned irrelevant results',
      ...overrides
    }
  };
}

const TOOLS: AgentToolDefinition[] = [
  {
    name: 'searchTool',
    description: 'Search indexed agent data'
  }
];

describe('prompt-builder', () => {
  it('builds the prompt from task, guards, and recent trajectory only', () => {
    const session = createSession();
    const prompt = buildModelInputText(
      createUserInputEvent('Keep investigating the wrong search result.'),
      session,
      24,
      undefined,
      TOOLS
    );

    expect(prompt).toContain('<task>');
    expect(prompt).toContain('<guards>');
    expect(prompt).toContain('<recent_trajectory>');
    expect(prompt).toContain('goal: Continue debugging why searchTool returns the wrong result.');
    expect(prompt).toContain('do_not_repeat:');
    expect(prompt).toContain('[tool_call searchTool]');
    expect(prompt).toContain('searchTool failed: Search returned irrelevant results');
    expect(prompt).not.toContain('Recoverable Context Workspace');
    expect(prompt).not.toContain('hydratedContext');
  });

  it('prefers raw transcript text when present', () => {
    const session = createSession();
    session.transcriptWindow.items = [
      {
        type: 'tool_call',
        tool: 'searchTool',
        args: '{"mode":"broad","query":"gateway agent"}',
        raw: '{"toolCallId":"call-1","toolName":"searchTool","arguments":{"mode":"broad","query":"gateway agent"},"reason":"Investigate the bad path"}'
      },
      {
        type: 'tool_result',
        tool: 'searchTool',
        output: 'legacy summarized output',
        raw: '{"toolCallId":"call-1","toolName":"searchTool","status":"error","error":"Search returned irrelevant results"}'
      }
    ];

    const prompt = buildModelInputText(
      createToolResultEvent(),
      session,
      24,
      undefined,
      TOOLS
    );

    expect(prompt).toContain('"reason":"Investigate the bad path"');
    expect(prompt).toContain('"status":"error"');
    expect(prompt).not.toContain('legacy summarized output');
  });

  it('instructs the model to stay inside the minimal three-block context model', () => {
    const session = createSession();
    const systemPrompt = buildSystemPrompt(session, undefined, TOOLS);

    expect(systemPrompt).toContain('minimal context model');
    expect(systemPrompt).toContain('three blocks only');
    expect(systemPrompt).toContain('Do not invent hidden plans');
    expect(systemPrompt).not.toContain('Recoverable Context Runtime');
  });

  it('parses TOOL_RESULT trigger payloads', () => {
    const triggerEvent = createToolResultEvent();
    const parsed = parseTriggerToolResult(triggerEvent) as ParsedTriggerToolResult;

    expect(parsed.toolCallId).toBe('call-1');
    expect(parsed.toolName).toBe('searchTool');
    expect(parsed.status).toBe('error');
    expect(parsed.error).toBe('Search returned irrelevant results');
  });
});
