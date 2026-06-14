import { Readable } from 'node:stream';

export interface ParsedSseChunk {
  event?: string;
  data: string;
}

export async function* parseSseChunks(response: Response): AsyncGenerator<ParsedSseChunk> {
  if (!response.body) {
    return;
  }

  const stream = Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>);
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of stream) {
    const text =
      typeof chunk === 'string'
        ? `${decoder.decode()}${chunk}`
        : decoder.decode(chunk, { stream: true });

    if (!text) {
      continue;
    }

    buffer += text.replace(/\r/g, '');

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const parsed = parseSseBlock(block);
      if (parsed) {
        yield parsed;
      }

      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode().replace(/\r/g, '');

  const trailing = parseSseBlock(buffer);
  if (trailing) {
    yield trailing;
  }
}

function parseSseBlock(block: string): ParsedSseChunk | null {
  if (!block.trim()) {
    return null;
  }

  const lines = block.split('\n');
  const dataLines: string[] = [];
  let eventName: string | undefined;

  for (const line of lines) {
    if (line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join('\n')
  };
}
