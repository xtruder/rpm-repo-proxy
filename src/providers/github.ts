/**
 * GitHub Releases provider for RPM discovery
 * 
 * Fetches RPM packages from GitHub releases, supporting multiple
 * releases and multiple architectures per release.
 */

import type { Provider, VersionInfo, RepoConfig } from './base';

/**
 * GitHub release asset from API
 */
interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string;  // SHA256 digest in format "sha256:abc123..."
}

/**
 * GitHub release from API
 */
interface GitHubRelease {
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  assets: GitHubAsset[];
}

/**
 * Architecture configuration with patterns to match RPM and signature files
 */
export interface ArchitectureConfig {
  /** Regex pattern to match RPM filename in release assets */
  rpmPattern: RegExp;
  /** Optional regex pattern to match signature file */
  sigPattern?: RegExp;
}

/**
 * Configuration for GitHub provider
 */
export interface GitHubProviderConfig {
  /** Provider name (used for routing and KV keys) */
  name: string;
  /** Display name for repository */
  displayName: string;
  /** Repository description */
  description: string;
  /** GitHub repository owner */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** Number of releases to fetch (default: 10) */
  releasesCount?: number;
  /** Whether to include prereleases (default: false) */
  includePrereleases?: boolean;
  /** Architecture definitions with their patterns */
  architectures: Record<string, ArchitectureConfig>;
  /** RPM package name if different from provider name (for dnf install commands) */
  packageName?: string;
}

export class GitHubProvider implements Provider {
  private config: GitHubProviderConfig;

  constructor(config: GitHubProviderConfig) {
    this.config = {
      releasesCount: 10,
      includePrereleases: false,
      ...config
    };
  }

  getName(): string {
    return this.config.name;
  }

  getRepoConfig(): RepoConfig {
    return {
      name: this.config.name,
      displayName: this.config.displayName,
      description: this.config.description,
      packageName: this.config.packageName
    };
  }

  /**
   * Fetch the latest version (first architecture found in latest release)
   * Required by Provider interface for backward compatibility
   */
  async fetchLatestVersion(): Promise<VersionInfo> {
    const versions = await this.fetchVersions(1);
    if (versions.length === 0) {
      throw new Error(`No RPM packages found in ${this.config.owner}/${this.config.repo} releases`);
    }
    return versions[0];
  }

  /**
   * Fetch multiple versions from GitHub releases
   * Returns all matching RPMs across N releases and all configured architectures
   * @param count Number of releases to fetch (defaults to provider's releasesCount config)
   */
  async fetchVersions(count?: number): Promise<VersionInfo[]> {
    const releaseCount = count ?? this.config.releasesCount!;
    const releases = await this.fetchReleases(releaseCount);
    const versions: VersionInfo[] = [];

    for (const release of releases) {
      // Skip drafts and optionally prereleases
      if (release.draft) continue;
      if (release.prerelease && !this.config.includePrereleases) continue;

      const version = this.parseVersion(release.tag_name);

      // Process each configured architecture
      for (const [arch, archConfig] of Object.entries(this.config.architectures)) {
        const rpmAsset = release.assets.find(a => archConfig.rpmPattern.test(a.name));
        
        if (rpmAsset) {
          // Extract SHA256 from GitHub's digest field (format: "sha256:abc123...")
          const checksum = rpmAsset.digest?.startsWith('sha256:') 
            ? rpmAsset.digest.slice(7)  // Remove "sha256:" prefix
            : undefined;

          versions.push({
            version: version,
            release: '1',  // Standard release number for GitHub releases
            arch: arch,
            url: rpmAsset.browser_download_url,
            // Generate standardized RPM filename: name-version-release.arch.rpm
            filename: `${this.config.name}-${version}-1.${arch}.rpm`,
            size: rpmAsset.size,
            checksum: checksum
          });
        }
      }
    }

    return versions;
  }

  /**
   * Fetch releases from GitHub API
   */
  private async fetchReleases(count: number): Promise<GitHubRelease[]> {
    const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/releases?per_page=${count}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'RPM-Repo-Proxy',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as GitHubRelease[];
  }

  /**
   * Parse version from git tag
   * Removes common prefixes like 'v' or 'release-'
   */
  private parseVersion(tag: string): string {
    // Remove 'v' prefix if present
    if (tag.startsWith('v')) {
      return tag.slice(1);
    }
    // Remove 'release-' prefix if present
    if (tag.startsWith('release-')) {
      return tag.slice(8);
    }
    return tag;
  }
}
