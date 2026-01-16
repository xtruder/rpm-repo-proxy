/**
 * Base provider interface for RPM discovery
 */

export interface VersionInfo {
  version: string;
  release: string;
  url: string;
  filename: string;
  arch?: string;  // Architecture (x86_64, aarch64, etc.) - optional for backward compat
}

export interface RepoConfig {
  name: string;
  displayName: string;
  description: string;
  /** RPM package name if different from provider name (for dnf install commands) */
  packageName?: string;
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

  /**
   * Fetch multiple versions from the provider's API (optional)
   * Used by providers that support multiple releases/architectures (e.g., GitHub)
   * @param count Number of releases to fetch (optional, uses provider default if not specified)
   * @returns Array of version info for all matching RPMs
   */
  fetchVersions?(count?: number): Promise<VersionInfo[]>;
}
