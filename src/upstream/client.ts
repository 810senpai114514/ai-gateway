import { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';

export interface UpstreamCallLogContext {
  logger?: {
    info?(context: unknown, message?: string): void;
    warn?(context: unknown, message?: string): void;
  };
  requestId?: string;
  provider?: string;
  providerName?: string;
  sourceAdapterKey?: string;
}

export interface UpstreamRetryOptions {
  enabled?: boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterMs?: number;
  retryStatusCodes?: number[];
}

interface NormalizedUpstreamRetryOptions {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
  retryStatusCodes: Set<number>;
}

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
  'host'
]);

const sensitiveHeaderNames = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-signature',
  'cookie',
  'set-cookie'
]);
const sensitiveQueryNames = new Set([
  'key',
  'token',
  'api_key',
  'apikey',
  'access_token',
  'authorization',
  'auth'
]);
const safeTokenPayloadKeys = new Set([
  'inputtokens',
  'outputtokens',
  'totaltokens',
  'prompttokens',
  'completiontokens',
  'cachedtokens',
  'cachereadtokens',
  'cachewritetokens',
  'cachecreationtokens',
  'cachereadinputtokens',
  'cachecreationinputtokens',
  'inputtokensdetails',
  'prompttokensdetails',
  'prompttokencount',
  'inputtokencount',
  'outputtokencount',
  'candidatestokencount',
  'totaltokencount',
  'cachedcontenttokencount',
  'maxtokens',
  'maxcompletiontokens',
  'maxoutputtokens',
  'tokenlimit',
  'tokensperminute',
  'tokenspersecond'
]);
const maxLoggedStringLength = 4096;
const maxLoggedPayloadLength = 32768;
const maxUpstreamConnectAttempts = 2;
const upstreamRetryDelayMs = 150;

export async function callUpstream(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  logContext?: UpstreamCallLogContext,
  retryOptions?: UpstreamRetryOptions
): Promise<Response> {
  const retry = normalizeUpstreamRetryOptions(retryOptions);
  const shouldLog = Boolean(logContext?.logger);
  const shouldSkipResponseBodyLog = isStreamingRequestPayload(body, headers);
  const requestLogPayload = shouldLog
    ? {
        url: sanitizeUrlForLog(url),
        headers: sanitizeHeadersForLog(headers),
        body: sanitizePayloadForLog(body)
      }
    : undefined;
  if (shouldLog && requestLogPayload) {
    logContext?.logger?.info?.(
      {
        ...buildUpstreamLogContext(logContext),
        upstream: {
          request: requestLogPayload
        }
      },
      'Upstream request dispatched.'
    );
  }

  let lastError: unknown;
  let timedOut = false;
  let activeController: AbortController | undefined;
  const timeout =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          activeController?.abort();
        }, timeoutMs)
      : undefined;

  try {
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      if (timedOut) {
        throw buildUpstreamTimeoutError(timeoutMs);
      }

      const controller = new AbortController();
      activeController = controller;
      const onAbort = () => {
        controller.abort();
      };

      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (shouldLog && requestLogPayload) {
          const responseBody = shouldSkipResponseBodyLog
            ? '<streaming-response-body omitted>'
            : await readResponseBodyForLog(response);
          logContext?.logger?.info?.(
            {
              ...buildUpstreamLogContext(logContext),
              upstream: {
                request: requestLogPayload,
                response: {
                  status: response.status,
                  headers: sanitizeHeadersForLog(response.headers),
                  body: responseBody
                }
              }
            },
            'Upstream response received.'
          );
        }

        if (shouldRetryStatus(response.status, retry, attempt, signal)) {
          if (shouldLog) {
            logContext?.logger?.warn?.(
              {
                ...buildUpstreamLogContext(logContext),
                upstream: {
                  request: requestLogPayload,
                  response: {
                    status: response.status,
                    headers: sanitizeHeadersForLog(response.headers)
                  },
                  attempt,
                  maxAttempts: retry.maxAttempts
                }
              },
              'Upstream response status is retryable. Retrying.'
            );
          }
          await cancelResponseBody(response);
          await delay(resolveRetryDelayMs(retry, attempt));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        if (timedOut) {
          const timeoutError = buildUpstreamTimeoutError(timeoutMs);
          if (shouldLog) {
            logContext?.logger?.warn?.(
              {
                ...buildUpstreamLogContext(logContext),
                upstream: {
                request: requestLogPayload,
                attempt,
                maxAttempts: retry.maxAttempts,
                timeoutMs
              },
                error: timeoutError.message
              },
              'Upstream request timed out.'
            );
          }
          throw timeoutError;
        }

        const externallyAborted = signal?.aborted === true;
        const isLastAttempt = attempt >= retry.maxAttempts;
        if (shouldLog) {
          logContext?.logger?.warn?.(
            {
              ...buildUpstreamLogContext(logContext),
              upstream: {
                request: requestLogPayload,
                attempt,
                maxAttempts: retry.maxAttempts
              },
              error: error instanceof Error ? error.message : String(error)
            },
            isLastAttempt || externallyAborted
              ? 'Upstream request failed.'
              : 'Upstream request failed. Retrying.'
          );
        }

        if (externallyAborted) {
          throw error;
        }

        if (isLastAttempt) {
          throw error;
        }

        await delay(resolveRetryDelayMs(retry, attempt));
      } finally {
        signal?.removeEventListener('abort', onAbort);
        if (activeController === controller) {
          activeController = undefined;
        }
      }
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function relayUpstreamResponse(reply: FastifyReply, response: Response) {
  reply.code(response.status);

  response.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      if (reply.getHeader(key) === undefined) {
        reply.header(key, value);
      }
    }
  });

  if (!response.body) {
    return reply.send(await response.text());
  }

  const stream = Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>);
  return reply.send(stream);
}

export function forceEventStreamHeaders(reply: FastifyReply): void {
  reply.header('content-type', 'text/event-stream; charset=utf-8');
  reply.header('cache-control', 'no-cache, no-transform');
  reply.header('connection', 'keep-alive');
  reply.header('x-accel-buffering', 'no');
}

export async function readUpstreamPayload(response: Response): Promise<unknown> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text();
  if (!text) {
    return {};
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function buildUpstreamLogContext(logContext: UpstreamCallLogContext): Record<string, unknown> {
  return {
    requestId: logContext.requestId,
    provider: logContext.provider,
    providerName: logContext.providerName,
    sourceAdapterKey: logContext.sourceAdapterKey
  };
}

function sanitizeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of sensitiveQueryNames) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function sanitizeHeadersForLog(
  headers: Headers | Record<string, string>
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const entries = headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  for (const [key, value] of entries) {
    sanitized[key] = isSensitiveKey(key) ? '***' : truncateStringForLog(String(value));
  }
  return sanitized;
}

function isStreamingRequestPayload(body: unknown, headers: Record<string, string>): boolean {
  const acceptHeader = findHeaderValueCaseInsensitive(headers, 'accept');
  if (typeof acceptHeader === 'string' && acceptHeader.toLowerCase().includes('text/event-stream')) {
    return true;
  }

  if (!body || typeof body !== 'object') {
    return false;
  }

  const candidate = body as Record<string, unknown>;
  const streamValue = candidate.stream;
  if (streamValue === true) {
    return true;
  }
  if (typeof streamValue === 'string') {
    return streamValue.trim().toLowerCase() === 'true';
  }

  return false;
}

function findHeaderValueCaseInsensitive(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

async function readResponseBodyForLog(response: Response): Promise<unknown> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    return '<streaming-response-body omitted>';
  }

  try {
    return sanitizePayloadForLog(await readUpstreamPayload(response.clone()));
  } catch (error) {
    return {
      read_error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function sanitizePayloadForLog(payload: unknown): unknown {
  const sanitized = redactSensitiveValues(payload, 0);

  try {
    const serialized = JSON.stringify(sanitized);
    if (!serialized) {
      return sanitized;
    }
    if (serialized.length <= maxLoggedPayloadLength) {
      return sanitized;
    }
    return {
      truncated: true,
      originalLength: serialized.length,
      preview: `${serialized.slice(0, maxLoggedPayloadLength)}...`
    };
  } catch {
    return truncateStringForLog(String(sanitized));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUpstreamRetryOptions(
  options: UpstreamRetryOptions | undefined
): NormalizedUpstreamRetryOptions {
  const enabled = options?.enabled ?? true;
  const maxAttempts = enabled
    ? normalizeInteger(options?.maxAttempts, maxUpstreamConnectAttempts, 1)
    : 1;
  const baseDelayMs = normalizeInteger(options?.baseDelayMs, upstreamRetryDelayMs, 0);
  const maxDelayMs = normalizeInteger(options?.maxDelayMs, baseDelayMs, 0);
  const backoffMultiplier = normalizePositiveNumber(options?.backoffMultiplier, 1);
  const jitterMs = normalizeInteger(options?.jitterMs, 0, 0);
  const retryStatusCodes = new Set(
    (options?.retryStatusCodes || []).filter(
      (statusCode) => Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    )
  );

  return {
    enabled,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    backoffMultiplier,
    jitterMs,
    retryStatusCodes
  };
}

function shouldRetryStatus(
  statusCode: number,
  retry: NormalizedUpstreamRetryOptions,
  attempt: number,
  signal?: AbortSignal
): boolean {
  return (
    retry.enabled &&
    attempt < retry.maxAttempts &&
    signal?.aborted !== true &&
    retry.retryStatusCodes.has(statusCode)
  );
}

function resolveRetryDelayMs(retry: NormalizedUpstreamRetryOptions, attempt: number): number {
  const exponentialDelay = retry.baseDelayMs * retry.backoffMultiplier ** Math.max(0, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, retry.maxDelayMs || exponentialDelay);
  if (retry.jitterMs <= 0) {
    return Math.trunc(cappedDelay);
  }

  return Math.trunc(cappedDelay + Math.random() * retry.jitterMs);
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore body cancellation failures before retrying the upstream request.
  }
}

function normalizeInteger(value: number | undefined, fallback: number, minValue: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }

  return Math.max(minValue, Math.trunc(value));
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }

  return value;
}

function buildUpstreamTimeoutError(timeoutMs: number): Error {
  return new Error(`Upstream request timed out after ${timeoutMs}ms.`);
}

function redactSensitiveValues(value: unknown, depth: number): unknown {
  if (depth > 8) {
    return '<max-depth>';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item, depth + 1));
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return truncateStringForLog(value);
    }
    return value;
  }

  const source = value as Record<string, unknown>;
  const mapped: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(source)) {
    if (shouldRedactPayloadKey(key, nested)) {
      mapped[key] = '***';
      continue;
    }
    mapped[key] = redactSensitiveValues(nested, depth + 1);
  }

  return mapped;
}

function truncateStringForLog(value: string): string {
  return value.length > maxLoggedStringLength ? `${value.slice(0, maxLoggedStringLength)}...` : value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    sensitiveHeaderNames.has(normalized) ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password')
  );
}

function shouldRedactPayloadKey(key: string, value: unknown): boolean {
  const normalized = key.trim().toLowerCase();
  if (!isSensitiveKey(normalized)) {
    return false;
  }

  if (
    !sensitiveHeaderNames.has(normalized) &&
    !normalized.includes('secret') &&
    !normalized.includes('password') &&
    normalized.includes('token') &&
    isSafeTokenPayloadKey(normalized, value)
  ) {
    return false;
  }

  return true;
}

function isSafeTokenPayloadKey(normalizedKey: string, value: unknown): boolean {
  const compactKey = normalizedKey.replace(/[_-]/g, '');
  if (safeTokenPayloadKeys.has(compactKey)) {
    return true;
  }

  if (
    typeof value === 'number' &&
    (compactKey.endsWith('tokens') || compactKey.endsWith('tokencount'))
  ) {
    return true;
  }

  return false;
}
