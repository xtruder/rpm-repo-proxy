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
  arch?: string;  // Architecture (x86_64, aarch64, etc.)
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
   * Fetch multiple versions from provider API (if supported)
   * Falls back to fetchLatestVersion() for providers that don't support batch fetching
   * @param count Optional count - if not provided, uses provider's default
   */
  async fetchVersions(count?: number): Promise<Omit<VersionInfo, 'added'>[]> {
    if (this.provider.fetchVersions) {
      return await this.provider.fetchVersions(count);
    }
    // Fallback for providers without fetchVersions support
    return [await this.provider.fetchLatestVersion()];
  }

  /**
   * Generate a unique key for a version (includes arch if present)
   */
  private getVersionKey(v: { version: string; release: string; arch?: string }): string {
    return v.arch 
      ? `${v.version}-${v.release}-${v.arch}`
      : `${v.version}-${v.release}`;
  }

  /**
   * Check for new versions and update index if found
   * Supports providers with multiple versions/architectures via fetchVersions()
   * @returns True if any new version was found
   */
  async checkAndUpdate(): Promise<boolean> {
    // Use fetchVersions if available, otherwise fall back to single version
    // Don't pass count - let provider use its configured default
    const latestVersions = await this.fetchVersions();
    const index = await this.getIndex();

    let addedCount = 0;

    for (const latest of latestVersions) {
      const versionKey = this.getVersionKey(latest);

      // Check if version already exists
      const exists = index.versions.some(
        v => this.getVersionKey(v) === versionKey
      );

      if (exists) {
        continue;
      }

      // Add new version
      const newVersion: VersionInfo = {
        ...latest,
        added: new Date().toISOString()
      };

      index.versions.unshift(newVersion); // Add to front (newest first)
      addedCount++;
      console.log(`Added new version: ${versionKey}`);
    }

    if (addedCount > 0) {
      index.updated = new Date().toISOString();
      await this.saveIndex(index);
      console.log(`Added ${addedCount} new version(s)`);
    } else {
      console.log(`No new versions found, index has ${index.versions.length} versions`);
    }

    return addedCount > 0;
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
