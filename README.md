# RPM Repository Proxy

[![CI](https://github.com/xtruder/rpm-repo-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/xtruder/rpm-repo-proxy/actions/workflows/ci.yml)
[![E2E Health Check](https://github.com/xtruder/rpm-repo-proxy/actions/workflows/e2e-test.yml/badge.svg)](https://github.com/xtruder/rpm-repo-proxy/actions/workflows/e2e-test.yml)
[![Live Service](https://img.shields.io/badge/live-rpm--repo--proxy.x--truder.net-blue)](https://rpm-repo-proxy.x-truder.net)

A Cloudflare Workers-based multi-provider RPM repository proxy that automatically discovers new RPM packages
from multiple providers and serves YUM/DNF-compatible repository metadata.

Used for RPM packages that are not available via RPM repositories.

## Features

- **Multi RPM Sources**: Extensible providers for scraping RPM packages (currently Cursor IDE, easily add more)
- **Automated Version Discovery**: Hourly cron job polls provider APIs for new RPM versions
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

1. **Scheduled Job** (every 6 hours):
   - Check each provider for new versions
   - Extract and store RPM metadata in Cloudflare KV

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
# Cursor IDE repository
sudo curl -o /etc/yum.repos.d/<provider>.repo https://rpm-repo-proxy.x-truder.net/<provider>/<provider>.repo

# Install
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

# Get specific metadata
npx wrangler kv key get "cursor:metadata:1.7.28-adb0f9e3e4" --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote

# Delete key
npx wrangler kv key delete "cursor:metadata:1.7.28-adb0f9e3e4" --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote
```

## Adding New Providers

1. Create a new provider class in `src/providers/` implementing the `Provider` interface
2. Register the provider in `src/providers/index.ts`

Example:
```typescript
// src/providers/windsurf.ts
export class WindsurfProvider implements Provider {
  getName(): string { return 'windsurf'; }

  getRepoConfig(): RepoConfig {
    return {
      id: 'windsurf',
      name: 'Windsurf IDE',
      baseurl: '$basearch'
    };
  }

  async fetchLatestVersion(): Promise<VersionInfo | null> {
    // Implementation
  }
}
```

4. Add unique cron job to `wrangler.toml` for the new provider:

Every provider must have a unique time pattern for a cronjob, the schedule pattern can be distinguished in code.

```toml
triggers = [
  { name = "scheduled", schedule = "0 */6 * * *" }, # cursor
  { name = "scheduled", schedule = "1 */6 * * *" }, # windsurf
]
```

```typescript
// src/index.ts
export default {
  ...,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Match cron pattern to provider
    switch (event.cron) {
      case "0 */6 * * *":  // cursor - every 6 hours at minute 0
        await handleScheduledForProvider(env, providers.cursor);
        break;
      // Add new provider here
      case "1 */6 * * *":  // windsurf - every 6 hours at minute 1
        await handleScheduledForProvider(env, providers.windsurf);
        break;
      default:
        console.error(`Unknown cron pattern: ${event.cron}`);
    }
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
