/**
 * Cursor IDE provider
 */

import type { Provider, VersionInfo, RepoConfig } from './base';

interface CursorApiResponse {
  downloadUrl: string;
  version: string;
  commitSha: string;
}

export class CursorProvider implements Provider {
  getName(): string {
    return 'cursor';
  }

  getRepoConfig(): RepoConfig {
    return {
      name: 'cursor',
      displayName: 'Cursor IDE Repository',
      description: 'Cursor IDE RPM packages'
    };
  }

  async fetchLatestVersion(): Promise<VersionInfo> {
    const response = await fetch('https://www.cursor.com/api/download?platform=linux-x64&releaseTrack=latest', {
      headers: {
        'User-Agent': 'RPM-Repo-Proxy',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as CursorApiResponse;

    // Use version from API response and construct RPM URL
    // The RPM URL follows the pattern: https://api2.cursor.sh/updates/download/golden/linux-x64-rpm/cursor/{major.minor}
    const versionParts = data.version.split('.');
    const majorMinor = `${versionParts[0]}.${versionParts[1]}`;

    // Fetch RPM redirect to get actual filename with release number
    const rpmResponse = await fetch(`https://api2.cursor.sh/updates/download/golden/linux-x64-rpm/cursor/${majorMinor}`, {
      method: 'HEAD',
      redirect: 'manual'
    });

    const rpmUrl = rpmResponse.headers.get('location');
    if (!rpmUrl) {
      throw new Error('Failed to get RPM URL from redirect');
    }

    // Extract version from RPM filename
    // Example: cursor-1.7.28.el8.x86_64.rpm
    const match = rpmUrl.match(/cursor-(\d+\.\d+\.\d+)\.el8/);
    if (!match) {
      throw new Error('Failed to extract version from RPM URL');
    }

    // Use commitSha as release number since RPM URL doesn't include it
    const release = data.commitSha.substring(0, 10);

    return {
      version: data.version,
      release: release,
      url: rpmUrl,
      filename: `cursor-${data.version}-${release}.el8.x86_64.rpm`
    };
  }
}
