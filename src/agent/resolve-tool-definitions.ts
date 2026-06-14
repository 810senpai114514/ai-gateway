export interface ParsedResolvedToolDefinition {
  name: string;
  description: string;
  tsDefinition?: string;
}

export function extractResolvedToolNamesFromTsDefinitions(tsDefinitions: string | undefined): string[] {
  if (!tsDefinitions) {
    return [];
  }

  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = /Exact tool name:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tsDefinitions)) !== null) {
    const name = match[1]?.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

export function parseResolvedToolDefinitionsFromTsDefinitions(
  tsDefinitions: string | undefined
): ParsedResolvedToolDefinition[] {
  if (!tsDefinitions) {
    return [];
  }

  const pattern = /Exact tool name:\s*"([^"]+)"/g;
  const matches: Array<{ name: string; markerIndex: number; blockStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tsDefinitions)) !== null) {
    const name = match[1]?.trim();
    if (!name) {
      continue;
    }
    const blockStart = tsDefinitions.lastIndexOf('/**', match.index);
    matches.push({
      name,
      markerIndex: match.index,
      blockStart: blockStart >= 0 ? blockStart : match.index
    });
  }

  if (matches.length === 0) {
    return [];
  }

  const resolvedToolCallIndex = tsDefinitions.indexOf('\ntype ResolvedToolCall');
  return matches.map((entry, index) => {
    const nextBlockStart = matches[index + 1]?.blockStart;
    const blockEnd =
      typeof nextBlockStart === 'number'
        ? nextBlockStart
        : resolvedToolCallIndex >= 0
          ? resolvedToolCallIndex
          : tsDefinitions.length;
    const definitionBlock = tsDefinitions.slice(entry.blockStart, blockEnd).trim() || undefined;
    return {
      name: entry.name,
      description: extractToolDescription(definitionBlock) || 'Derived from resolve tsDefinitions.',
      tsDefinition: definitionBlock
    };
  });
}

function extractToolDescription(definitionBlock: string | undefined): string | undefined {
  if (!definitionBlock) {
    return undefined;
  }

  const commentMatch = definitionBlock.match(/\/\*\*([\s\S]*?)\*\//);
  if (!commentMatch) {
    return undefined;
  }

  const lines = commentMatch[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith('Exact tool name:') &&
        !line.startsWith('Required parameters:') &&
        !line.startsWith('Workflow callable references:') &&
        !line.startsWith('callTool(')
    );

  return lines[0];
}
