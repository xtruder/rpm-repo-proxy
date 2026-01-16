/**
 * Provider registry
 */

import type { Provider } from './base';
import { GitHubProvider } from './github';

// Registry of all available providers
// NOTE: Cursor provider disabled - they now provide their own official repo
export const providers: Record<string, Provider> = {
  'open-code': new GitHubProvider({
    name: 'open-code',
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
export { GitHubProvider } from './github';
export type { GitHubProviderConfig, ArchitectureConfig } from './github';
