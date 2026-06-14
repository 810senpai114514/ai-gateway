import type { Provider, ProviderPlugin, SourceAdapter, TargetAdapter } from '../types';

interface RegisterOptions {
  overwrite?: boolean;
}

export class SourceAdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>();

  register(adapter: SourceAdapter, options?: RegisterOptions): void {
    const exists = this.adapters.has(adapter.key);
    if (exists && !options?.overwrite) {
      throw new Error(`Source adapter already registered: ${adapter.key}`);
    }

    this.adapters.set(adapter.key, adapter);
  }

  get(key: string): SourceAdapter | undefined {
    return this.adapters.get(key);
  }

  list(): SourceAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export class TargetAdapterRegistry {
  private readonly adapters = new Map<Provider, TargetAdapter>();

  register(adapter: TargetAdapter, options?: RegisterOptions): void {
    const exists = this.adapters.has(adapter.provider);
    if (exists && !options?.overwrite) {
      throw new Error(`Target adapter already registered: ${adapter.provider}`);
    }

    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: Provider): TargetAdapter | undefined {
    return this.adapters.get(provider);
  }

  list(): TargetAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export class ProviderPluginRegistry {
  private readonly plugins = new Map<string, ProviderPlugin>();

  register(plugin: ProviderPlugin, options?: RegisterOptions): void {
    const exists = this.plugins.has(plugin.key);
    if (exists && !options?.overwrite) {
      throw new Error(`Provider plugin already registered: ${plugin.key}`);
    }

    this.plugins.set(plugin.key, plugin);
  }

  get(key: string): ProviderPlugin | undefined {
    return this.plugins.get(key);
  }

  unregister(key: string): boolean {
    return this.plugins.delete(key);
  }

  clear(): void {
    this.plugins.clear();
  }

  resolve(provider: Provider, providerName?: string): ProviderPlugin[] {
    const normalizedProviderName = normalizeProviderName(providerName);
    const matched: ProviderPlugin[] = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.provider && plugin.provider !== provider) {
        continue;
      }

      if (plugin.providerName) {
        const pluginProviderName = normalizeProviderName(plugin.providerName);
        if (!normalizedProviderName || pluginProviderName !== normalizedProviderName) {
          continue;
        }
      }

      matched.push(plugin);
    }

    return matched;
  }

  list(): ProviderPlugin[] {
    return Array.from(this.plugins.values());
  }
}

function normalizeProviderName(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}
