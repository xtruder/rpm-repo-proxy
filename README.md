# RPM Repository Proxy

[![CI](https://github.com/xtruder/rpm-repo-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/xtruder/rpm-repo-proxy/actions/workflows/ci.yml)
[![E2E Health Check](https://github.com/xtruder/rpm-repo-proxy/actions/workflows/e2e-test.yml/badge.svg)](https://github.com/xtruder/rpm-repo-proxy/actions/workflows/e2e-test.yml)
[![Live Service](https://img.shields.io/badge/live-rpm--repo--proxy.x--truder.net-blue)](https://rpm-repo-proxy.x-truder.net)

A Cloudflare Workers-based multi-provider RPM repository proxy that automatically discovers new RPM packages
from multiple providers and serves YUM/DNF-compatible repository metadata.

Used for RPM packages that are not available via RPM repositories.

## Active Providers

| Provider | Package | Source | Architectures |
|----------|---------|--------|---------------|
| [open-code](https://rpm-repo-proxy.x-truder.net/open-code/) | `open-code` | [GitHub Releases](https://github.com/anomalyco/opencode/releases) | x86_64, aarch64 |

### Quick Install

```bash
# OpenCode
sudo curl -o /etc/yum.repos.d/open-code.repo https://rpm-repo-proxy.x-truder.net/open-code/open-code.repo
sudo dnf install open-code
```

## Features

- **Multi RPM Sources**: Extensible provider system for different RPM package sources (GitHub Releases, custom APIs, etc.)
- **Automated Version Discovery**: Cron job polls provider APIs every 3 hours for new RPM versions
- **GitHub Checksum Optimization**: For GitHub releases, uses API-provided SHA256 checksums to skip full file downloads during metadata extraction (~2s vs ~40s per package)
- **Multi-Architecture Support**: Handles multiple architectures (x86_64, aarch64) per package version
- **CDN Caching**: 30-day cache for RPM downloads, 5-minute cache for metadata
- **On-the-fly Metadata Generation**: Generates YUM/DNF repository metadata dynamically

## Architecture

### Components

- **Provider Layer** (`src/providers/`): Abstraction for different RPM sources
- **Version Manager** (`src/version-discovery.ts`): Tracks versions in Cloudflare KV
- **Metadata Manager** (`src/metadata-manager.ts`): Orchestrates RPM metadata extraction
- **RPM Metadata Extractor** (`src/rpm-metadata.ts`): Extracts package metadata from RPM files
- **Repository Metadata Generator** (`src/repo-metadata.ts`): Creates YUM/DNF XML metadata

### Data Flow

1. **Scheduled Job** (every 3 hours):
   - Check each provider for new versions
   - Extract and store RPM metadata in Cloudflare KV (rate-limited to 1 RPM per run)

2. **HTTP Requests**:
   - GET `/`: Root path, returns list of available providers
   - GET `/{provider}/`: Root path, returns list of available packages and info about adding the repository
   - GET `/{provider}/repodata/*.xml.gz`: Generate repository metadata on-the-fly
   - GET `/{provider}/*.rpm`: Proxy RPM downloads with CDN caching
   - GET `/{provider}/{provider}.repo`: Serve YUM/DNF repository configuration
   - POST `/{provider}/__trigger-scheduled`: Manually trigger scheduled job for specific provider

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Cloudflare account](https://cloudflare.com/) (for deployment)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd rpm-repo-proxy

# Install dependencies
npm install
```

## Development

```bash
# Start local development server
npm run dev

# Run tests
npm test

# View live production logs
npm run tail
```

## Testing

```bash
# Run all tests
npm test

# Run specific test file
node --test test/version-discovery.test.js

# Integration test with Docker
docker build -f Dockerfile.test -t cursor-rpm-test .
```

## Deployment

```bash
# Deploy to production
npx wrangler deploy --env=production

# Test build (dry run)
npx wrangler deploy --env=production --dry-run
```

## Usage

### Adding a Repository

Add the repository configuration on your Fedora/RHEL-based system:

```bash
# OpenCode repository
sudo curl -o /etc/yum.repos.d/open-code.repo https://rpm-repo-proxy.x-truder.net/open-code/open-code.repo
sudo dnf install open-code
```

For other providers, replace the provider name accordingly:
```bash
sudo curl -o /etc/yum.repos.d/<provider>.repo https://rpm-repo-proxy.x-truder.net/<provider>/<provider>.repo
sudo dnf install <package>
```

### Manual Triggers

```bash
# Manually trigger scheduled job for specific provider
curl -X POST https://rpm-repo-proxy.x-truder.net/<provider>/__trigger-scheduled
```

## KV Operations

```bash
# List all keys (use --remote flag)
npx wrangler kv key list --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote

# Get specific metadata (keys are namespaced by provider)
npx wrangler kv key get "open-code:version-index" --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote
npx wrangler kv key get "open-code:metadata:1.1.23-1-x86_64" --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote

# Delete key
npx wrangler kv key delete "open-code:metadata:1.1.23-1-x86_64" --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote
```

## Adding New Providers

### GitHub Releases Provider (Recommended)

For packages distributed via GitHub Releases, use the built-in `GitHubProvider`:

```typescript
// src/providers/index.ts
import { GitHubProvider } from './github';

export const providers: Record<string, Provider> = {
  'my-app': new GitHubProvider({
    name: 'my-app',
    displayName: 'My App Repository',
    description: 'My App RPM packages',
    owner: 'github-org',
    repo: 'my-app',
    releasesCount: 2,  // Number of releases to track
    includePrereleases: false,
    packageName: 'my-app',  // RPM package name (for dnf install)
    architectures: {
      'x86_64': {
        rpmPattern: /my-app-.*-x86_64\.rpm$/,
      },
      'aarch64': {
        rpmPattern: /my-app-.*-aarch64\.rpm$/,
      }
    }
  }),
};
```

### Custom Provider

For other sources, create a provider class implementing the `Provider` interface:

```typescript
// src/providers/custom.ts
export class CustomProvider implements Provider {
  getName(): string { return 'custom'; }

  getRepoConfig(): RepoConfig {
    return {
      name: 'custom',
      displayName: 'Custom Repository',
      description: 'Custom RPM packages'
    };
  }

  async fetchLatestVersion(): Promise<VersionInfo> {
    // Implementation - fetch from your source
  }
}
```

### Register and Schedule

1. Register the provider in `src/providers/index.ts`
2. Add a unique cron pattern to `wrangler.toml`:

```toml
[triggers]
crons = [
  "0 */3 * * *",   # existing provider
  "30 */3 * * *"   # new provider - different minute
]
```

3. Add the cron handler in `src/index.ts`:

```typescript
async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  switch (event.cron) {
    case "0 */3 * * *":
      await handleScheduledForProvider(env, providers['existing']);
      break;
    case "30 */3 * * *":
      await handleScheduledForProvider(env, providers['new-provider']);
      break;
  }
}
```

## License

Apache License 2.0

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to run tests before submitting:

```bash
npm test
```
