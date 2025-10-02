/**
 * Discover and manage RPM versions using Cloudflare KV (provider-aware)
 */

import type { Provider } from './providers/base';

interface VersionInfo {
  version: string;
  release: string;
  url: string;
  filename: string;
  added: string;
}

interface VersionIndex {
  versions: VersionInfo[];
  updated: string | null;
}

export class VersionManager {
  private kv: KVNamespace;
  private provider: Provider;
  private indexKey: string;

  constructor(kv: KVNamespace, provider: Provider) {
    this.kv = kv;
    this.provider = provider;
    this.indexKey = `${provider.getName()}:version-index`;
  }

  /**
   * Get current version index from KV
   */
  async getIndex(): Promise<VersionIndex> {
    const data = await this.kv.get<VersionIndex>(this.indexKey, 'json');
    return data || { versions: [], updated: null };
  }

  /**
   * Save version index to KV
   */
  async saveIndex(index: VersionIndex): Promise<void> {
    await this.kv.put(this.indexKey, JSON.stringify(index));
  }

  /**
   * Fetch latest version from provider API
   */
  async fetchLatestVersion(): Promise<Omit<VersionInfo, 'added'>> {
    return await this.provider.fetchLatestVersion();
  }

  /**
   * Check for new version and update index if found
   * @returns True if new version was found
   */
  async checkAndUpdate(): Promise<boolean> {
    const latest = await this.fetchLatestVersion();
    const index = await this.getIndex();

    const versionKey = `${latest.version}-${latest.release}`;

    // Check if version already exists
    const exists = index.versions.some(
      v => `${v.version}-${v.release}` === versionKey
    );

    if (exists) {
      console.log(`Version ${versionKey} already exists in `, index.versions);
      return false;
    }

    // Add new version
    const newVersion: VersionInfo = {
      ...latest,
      added: new Date().toISOString()
    };

    index.versions.unshift(newVersion); // Add to front (newest first)
    index.updated = new Date().toISOString();

    await this.saveIndex(index);

    console.log(`Added new version: ${versionKey}`);
    return true;
  }

  /**
   * Get latest version info
   */
  async getLatest(): Promise<VersionInfo | null> {
    const index = await this.getIndex();
    return index.versions[0] || null;
  }

  /**
   * Get all versions
   */
  async getAllVersions(): Promise<VersionInfo[]> {
    const index = await this.getIndex();
    return index.versions;
  }
}
