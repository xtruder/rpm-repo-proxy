# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers-based multi-provider RPM repository proxy. It automatically discovers new versions from multiple IDE providers (currently Cursor, with support for adding more), extracts RPM metadata, and serves YUM/DNF-compatible repository metadata files.

The worker:
- Runs on Cloudflare's edge network with custom domain `rpm-repo-proxy.x-truder.net`
- Polls provider APIs hourly via cron trigger to detect new versions
- Rate-limited to process max 3 RPMs per scheduled run
- Extracts metadata from RPM files and stores in Cloudflare KV (namespaced by provider)
- Generates repository metadata on-the-fly for DNF/YUM clients
- Proxies RPM downloads with 30-day CDN caching
- Serves multiple repos via subpaths: `/cursor/*`, `/windsurf/*`, etc.

## Development Commands

```bash
# Local development server
npm run dev
# or: wrangler dev

# Deploy to production
npx wrangler deploy --env=production

# Test build (dry run - validates TypeScript compilation)
npx wrangler deploy --env=production --dry-run

# Run tests
npm test
# Run specific test file
node --test test/version-discovery.test.js

# View live logs
npm run tail
# or: wrangler tail --env=production

# KV operations
# IMPORTANT: Always use --remote flag with KV commands, or they won't work correctly
# Keys are namespaced by provider: {provider}:version-index, {provider}:metadata:{version}-{release}
npx wrangler kv key list --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote
npx wrangler kv key get "cursor:metadata:1.7.28-adb0f9e3e4" --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote
npx wrangler kv key delete "cursor:metadata:1.7.28-adb0f9e3e4" --namespace-id=933bfd1e1d1148a4ba9e4362f0c6801e --env=production --remote

# Manually trigger scheduled job
curl -X POST https://rpm-repo-proxy.x-truder.net/__trigger-scheduled

# Test repository with Docker (integration test)
docker build -f Dockerfile.test -t cursor-rpm-test .
```

## Architecture Overview

### Core Components

**src/providers/** - Provider abstraction layer
- `base.ts` - Core `Provider` interface definition
- `cursor.ts` - Cursor IDE provider implementation
- `index.ts` - Provider registry (simple object mapping provider name to instance)
- Each provider implements: `getName()`, `getRepoConfig()`, `fetchLatestVersion()`
- Easy to add new providers by creating new provider class and registering in index.ts

**src/index.ts** - Main worker entry point
- Handles HTTP requests with multi-repo routing
- Routes: `/` (index), `/{provider}/` (provider index), `/{provider}/{provider}.repo` (repo config), `/{provider}/repodata/*` (metadata), `/{provider}/*.rpm` (packages)
- Manages scheduled cron job that loops through all providers
- Rate-limited to max 3 RPM metadata extractions per run
- Written in TypeScript

**src/version-discovery.ts** - `VersionManager` class
- Provider-aware version management
- Delegates version fetching to provider's `fetchLatestVersion()`
- Maintains version index in KV under key `{provider}:version-index`
- Each version includes: version, release (10-char commit SHA), url, filename, added timestamp
- Written in TypeScript with full type definitions

**src/metadata-manager.ts** - `MetadataManager` class
- Provider-aware metadata management
- Orchestrates RPM metadata extraction and storage
- Stores per-version metadata in KV with keys: `{provider}:metadata:{version}-{release}`
- Written in TypeScript with full type definitions

**src/rpm-metadata.ts** - `extractRpmMetadata()` function
- **Critical implementation detail**: Fetches RPM file TWICE in parallel to work within Cloudflare Workers constraints
  - First fetch: Range request for first 10MB (contains RPM headers) → parse with `@dx3mod/rpm-parser`
  - Second fetch: Full file → stream through `crypto.DigestStream` for SHA256 checksum
- Parallel fetches complete in ~20 seconds for 150MB files
- Avoids `stream.tee()` buffer limit issues that occur when one consumer is faster than another
- Extracts dependency flags manually from RPM headers (EQ, LT, LE, GT, GE)
- Written in TypeScript with interfaces for `RpmMetadata`, `Dependency`, etc.
- **API**: `extractRpmMetadata(rpmUrl: string, filename: string): Promise<RpmMetadata>`

**src/repo-metadata.ts** - `generateRepoMetadata()` function
- Generates YUM/DNF repository metadata (repomd.xml, primary.xml.gz, filelists.xml.gz, other.xml.gz)
- Uses deterministic timestamps from package build time (not `Date.now()`) to ensure stable metadata
- Compresses XML with `CompressionStream('gzip')`
- Calculates SHA256 checksums for all files
- Written in TypeScript with interfaces for `PackageMetadata`, `RepoMetadata`, etc.

### Data Flow

1. **Scheduled Job** (every hour):
   - Loop through all providers in registry
   - For each provider: `VersionManager.checkAndUpdate()` → fetch from provider API → check if version exists in index
   - If new version: add to index → `MetadataManager.extractAndStore()` → extract and store metadata (counts towards rate limit)
   - Also ensures metadata exists for all indexed versions (backfill missing, counts towards rate limit)
   - Stops after processing 3 RPMs total across all providers
   - Next run continues naturally from KV state

2. **HTTP Request** (`/cursor/repodata/primary.xml.gz`):
   - Extract provider name from path
   - Load all versions from KV (`{provider}:version-index`)
   - Load metadata for each version (`{provider}:metadata:{version}-{release}`)
   - Call `generateRepoMetadata()` to create XML on-the-fly
   - Return gzipped XML with 5-minute cache

3. **RPM Download** (`/cursor/cursor-1.7.28-adb0f9e3e4.el8.x86_64.rpm`):
   - Extract provider name from path
   - Match exact filename in version index (no parsing needed)
   - Lookup URL in version index
   - Proxy stream from origin with 30-day cache headers
   - Cloudflare CDN caches the file (no KV storage for large RPMs)

### KV Storage Schema

All keys are namespaced by provider name:

```
{provider}:version-index: {
  versions: [
    { version: "1.7.28", release: "adb0f9e3e4", url: "...", filename: "...", added: "2024-10-01..." },
    ...
  ],
  updated: "2024-10-01..."
}

{provider}:metadata:{version}-{release}: {
  name: "cursor",
  version: "1.7.28",
  release: "adb0f9e3e4",
  arch: "x86_64",
  checksum: { type: "sha256", value: "b76b5505..." },
  size: { package: 156756313, installed: 485642752 },
  dependencies: [
    { name: "libfoo.so.1()(64bit)", flags: "GE", version: "1.2.3" },
    ...
  ],
  ...
}
```

Note: Repository metadata (repomd.xml, primary.xml.gz, etc.) is generated on-the-fly for each request, not stored in KV.

### Cloudflare Workers Constraints

- **CPU Time Limits**:
  - HTTP requests: 5 minutes (paid plan, configured in wrangler.toml)
  - Cron triggers: 15 minutes
- **Stream Buffering**:
  - `stream.tee()` buffers data when consumers read at different rates
  - For 150MB files, buffering the entire file exceeds memory limits
  - Solution: Fetch file twice instead of using tee()
- **Compatibility**: Requires `nodejs_compat_v2` flag for stream APIs

## Testing

**IMPORTANT**: Always run tests after making changes to ensure nothing breaks.

```bash
# Run all tests (must pass before deploying)
npm test

# Run specific test file
node --test test/version-discovery.test.js
```

- `test/version-discovery.test.js` - ✅ Tests VersionManager (all passing)
- `test/rpm-metadata.test.js` - ⏭️ Skipped (needs HTTP server setup, see TODO in file)
- `test/repo-metadata.test.js` - ⏭️ Skipped (depends on rpm-metadata tests)

**Integration test**: `docker build -f Dockerfile.test .` validates the full repository with DNF.
