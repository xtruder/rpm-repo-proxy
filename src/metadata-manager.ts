/**
 * Manage RPM metadata storage in Cloudflare KV (provider-aware)
 */

import { extractRpmMetadata } from './rpm-metadata';
import type { Provider } from './providers/base';

export class MetadataManager {
  private kv: KVNamespace;
  private provider: Provider;

  constructor(kv: KVNamespace, provider: Provider) {
    this.kv = kv;
    this.provider = provider;
  }

  /**
   * Get metadata key for a version (includes arch if provided)
   */
  private getMetadataKey(version: string, release: string, arch?: string): string {
    const base = `${this.provider.getName()}:metadata:${version}-${release}`;
    return arch ? `${base}-${arch}` : base;
  }

  /**
   * Check if metadata exists for a version
   */
  async hasMetadata(version: string, release: string, arch?: string): Promise<boolean> {
    const key = this.getMetadataKey(version, release, arch);
    const data = await this.kv.get(key);
    return data !== null;
  }

  /**
   * Get metadata for a specific version
   */
  async getMetadata(version: string, release: string, arch?: string): Promise<any | null> {
    const key = this.getMetadataKey(version, release, arch);
    return await this.kv.get(key, 'json');
  }

  /**
   * Extract and store metadata for a version
   */
  async extractAndStore(version: string, release: string, rpmUrl: string, filename: string, arch?: string): Promise<void> {
    const archSuffix = arch ? ` (${arch})` : '';
    console.log(`Extracting metadata for ${version}-${release}${archSuffix}...`);

    // Extract metadata (fetches file twice in parallel: headers + full file for checksum)
    const metadata = await extractRpmMetadata(rpmUrl, filename);

    // Store in KV
    const key = this.getMetadataKey(version, release, arch);
    await this.kv.put(key, JSON.stringify(metadata));

    console.log(`Stored metadata for ${version}-${release}${archSuffix}`);
  }

  /**
   * Get all metadata for multiple versions (parallel fetch for performance)
   */
  async getAllMetadata(versions: Array<{version: string, release: string, arch?: string}>): Promise<any[]> {
    // Fetch all metadata in parallel using Promise.all
    const metadataPromises = versions.map(v => this.getMetadata(v.version, v.release, v.arch));
    const results = await Promise.all(metadataPromises);

    // Filter out null values (versions without metadata)
    return results.filter(metadata => metadata !== null);
  }

  /**
   * Delete metadata for a version
   */
  async deleteMetadata(version: string, release: string, arch?: string): Promise<void> {
    const key = this.getMetadataKey(version, release, arch);
    await this.kv.delete(key);
  }
}
