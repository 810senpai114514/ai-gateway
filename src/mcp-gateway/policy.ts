import type { AgentToolDefinition } from '../agent/types';
import type { McpGatewayConfig, McpGatewayPrincipalConfig } from '../types';
import { isObject } from '../utils';

export interface McpGatewayAccessContext {
  principal: McpGatewayPrincipalConfig;
  isInternalCaller: boolean;
}

export function filterToolsByPolicy(
  tools: AgentToolDefinition[],
  context: McpGatewayAccessContext,
  config: McpGatewayConfig
): AgentToolDefinition[] {
  return tools.filter((tool) => isToolAllowed(tool.name, context, config));
}

export function isToolAllowed(
  canonicalToolName: string,
  context: McpGatewayAccessContext,
  config: McpGatewayConfig
): boolean {
  const serverName = getServerNameFromCanonicalTool(canonicalToolName);
  if (!serverName) {
    return false;
  }

  if (!context.isInternalCaller && !isServerPublic(serverName, config)) {
    return false;
  }

  const allowServers = context.principal.allowServers;
  if (allowServers.length > 0 && !matchesAnyPattern(serverName, allowServers)) {
    return false;
  }

  const allowTools = context.principal.allowTools;
  if (allowTools.length > 0 && !matchesAnyPattern(canonicalToolName, allowTools)) {
    return false;
  }

  if (matchesAnyPattern(canonicalToolName, context.principal.denyTools)) {
    return false;
  }

  return true;
}

export function getServerNameFromCanonicalTool(toolName: string): string | undefined {
  const separator = toolName.indexOf('.');
  if (separator <= 0) {
    return undefined;
  }

  const serverName = toolName.slice(0, separator).trim();
  return serverName || undefined;
}

export function matchesAnyPattern(value: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => matchesPattern(value, pattern));
}

export function matchesPattern(value: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern === '*') {
    return true;
  }

  if (!normalizedPattern.includes('*')) {
    return value === normalizedPattern;
  }

  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const matcher = new RegExp(`^${escaped}$`);
  return matcher.test(value);
}

export function isServerPublic(serverName: string, config: McpGatewayConfig): boolean {
  return config.serverExposure[serverName] === 'public';
}

export function isInternalIp(ipValue: string, cidrs: string[]): boolean {
  const raw = ipValue.trim();
  if (!raw) {
    return false;
  }

  const normalized = normalizeIp(raw);
  if (!normalized) {
    return false;
  }

  if (normalized === '::1' || normalized.startsWith('127.')) {
    return true;
  }

  if (normalized.includes(':')) {
    const lower = normalized.toLowerCase();
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }

    return cidrs.some((cidr) => isIpv6InSimpleCidr(lower, cidr));
  }

  if (isPrivateIpv4(normalized)) {
    return true;
  }

  return cidrs.some((cidr) => isIpv4InCidr(normalized, cidr));
}

function normalizeIp(value: string): string | undefined {
  const single = value.split(',')[0]?.trim();
  if (!single) {
    return undefined;
  }

  const withoutPort = stripPort(single);
  if (!withoutPort) {
    return undefined;
  }

  if (withoutPort.startsWith('::ffff:')) {
    return withoutPort.slice('::ffff:'.length);
  }

  return withoutPort;
}

function stripPort(value: string): string {
  if (value.startsWith('[') && value.includes(']')) {
    return value.slice(1, value.indexOf(']'));
  }

  const colonCount = value.split(':').length - 1;
  if (colonCount === 1 && value.includes('.')) {
    const [host] = value.split(':');
    return host;
  }

  return value;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return false;
  }

  if (octets[0] === 10) {
    return true;
  }

  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  return octets[0] === 192 && octets[1] === 168;
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf('/');
  if (slash <= 0) {
    return false;
  }

  const baseIp = cidr.slice(0, slash).trim();
  const prefix = Number(cidr.slice(slash + 1).trim());
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipInt = ipv4ToUint32(ip);
  const baseInt = ipv4ToUint32(baseIp);
  if (ipInt === undefined || baseInt === undefined) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const shift = 32 - prefix;
  const mask = shift === 32 ? 0 : ((0xffffffff << shift) >>> 0);
  return (ipInt & mask) === (baseInt & mask);
}

function ipv4ToUint32(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return undefined;
  }

  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return undefined;
    }

    value = (value << 8) + octet;
  }

  return value >>> 0;
}

function isIpv6InSimpleCidr(ip: string, cidr: string): boolean {
  const normalized = cidr.trim().toLowerCase();
  if (normalized === '::1/128') {
    return ip === '::1';
  }

  if (normalized === 'fc00::/7') {
    return ip.startsWith('fc') || ip.startsWith('fd');
  }

  return false;
}

export function containsBlockedArgumentKeys(value: unknown, blockedKeys: Set<string>): boolean {
  if (blockedKeys.size === 0) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsBlockedArgumentKeys(item, blockedKeys));
  }

  if (!isObject(value)) {
    return false;
  }

  for (const [key, item] of Object.entries(value)) {
    if (blockedKeys.has(key.toLowerCase())) {
      return true;
    }

    if (containsBlockedArgumentKeys(item, blockedKeys)) {
      return true;
    }
  }

  return false;
}

export function redactSensitiveArguments(value: unknown, redactKeys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveArguments(item, redactKeys));
  }

  if (!isObject(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (redactKeys.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
      continue;
    }

    redacted[key] = redactSensitiveArguments(item, redactKeys);
  }

  return redacted;
}

export function toLowerSet(values: string[]): Set<string> {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return new Set(normalized);
}
