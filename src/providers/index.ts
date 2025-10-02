/**
 * Provider registry
 */

import type { Provider } from './base';
import { CursorProvider } from './cursor';

// Registry of all available providers
export const providers: Record<string, Provider> = {
  cursor: new CursorProvider(),
};

// Export types and classes
export type { Provider, VersionInfo, RepoConfig } from './base';
export { CursorProvider } from './cursor';
