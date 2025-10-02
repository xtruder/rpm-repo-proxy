/**
 * Base provider interface for RPM discovery
 */

export interface VersionInfo {
  version: string;
  release: string;
  url: string;
  filename: string;
}

export interface RepoConfig {
  name: string;
  displayName: string;
  description: string;
}

export interface Provider {
  /**
   * Get the provider name (used for routing and KV keys)
   */
  getName(): string;

  /**
   * Get repository configuration
   */
  getRepoConfig(): RepoConfig;

  /**
   * Fetch the latest version from the provider's API
   */
  fetchLatestVersion(): Promise<VersionInfo>;
}
