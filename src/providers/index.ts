/**
 * Provider registry
 */

import type { Provider } from './base';
import { CursorProvider } from './cursor';
import { GitHubProvider } from './github';

// Registry of all available providers
export const providers: Record<string, Provider> = {
  cursor: new CursorProvider(),
  opencode: new GitHubProvider({
    name: 'opencode',
    displayName: 'OpenCode Repository',
    description: 'OpenCode RPM packages',
    owner: 'anomalyco',
    repo: 'opencode',
    releasesCount: 2,
    includePrereleases: false,
    packageName: 'open-code',  // Actual RPM package name
    architectures: {
      'x86_64': {
        rpmPattern: /opencode-desktop-linux-x86_64\.rpm$/,
        sigPattern: /opencode-desktop-linux-x86_64\.rpm\.sig$/,
      },
      'aarch64': {
        rpmPattern: /opencode-desktop-linux-aarch64\.rpm$/,
        sigPattern: /opencode-desktop-linux-aarch64\.rpm\.sig$/,
      }
    }
  }),
};

// Export types and classes
export type { Provider, VersionInfo, RepoConfig } from './base';
export { CursorProvider } from './cursor';
export { GitHubProvider } from './github';
export type { GitHubProviderConfig, ArchitectureConfig } from './github';
