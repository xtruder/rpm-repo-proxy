import { generateRepoMetadata } from './repo-metadata';
import { VersionManager } from './version-discovery';
import { MetadataManager } from './metadata-manager';
import { providers } from './providers';

interface Env {
  VERSION_INDEX: KVNamespace;
  REPO_BASE_URL: string;
}

const CACHE_TTL_RPM = 30 * 24 * 60 * 60; // 30 days
const MAX_RPMS_PER_RUN = 1; // Rate limit for scheduled job

/**
 * Handle scheduled cron trigger for a specific provider
 */
async function handleScheduledForProvider(env: Env, provider: any): Promise<void> {
  const providerName = provider.getName();
  console.log(`Running scheduled version check for provider: ${providerName}`);

  let processedCount = 0;

  try {
    const versionManager = new VersionManager(env.VERSION_INDEX, provider);
    const metadataManager = new MetadataManager(env.VERSION_INDEX, provider);

    const updated = await versionManager.checkAndUpdate();
    if (updated) {
      console.log(`New version discovered for ${providerName}`);

      // Extract and store metadata for the new version
      const latest = await versionManager.getLatest();
      if (latest) {
        console.log(`Extracting metadata for ${providerName}:${latest.version}-${latest.release}...`);
        await metadataManager.extractAndStore(
          latest.version,
          latest.release,
          latest.url,
          latest.filename
        );
        console.log('Metadata extraction completed');
        processedCount++;
      }
    } else {
      console.log(`No new version for ${providerName}`);

      // Ensure metadata exists for all versions (backfill)
      const versions = await versionManager.getAllVersions();
      for (const version of versions) {
        if (processedCount >= MAX_RPMS_PER_RUN) break;

        const hasMetadata = await metadataManager.hasMetadata(version.version, version.release);
        if (!hasMetadata) {
          console.log(`Missing metadata for ${providerName}:${version.version}-${version.release}, extracting...`);
          await metadataManager.extractAndStore(
            version.version,
            version.release,
            version.url,
            version.filename
          );
          processedCount++;
        }
      }
    }

    // Update last check timestamp for this provider
    await env.VERSION_INDEX.put(`${providerName}:last-version-check`, Date.now().toString());
  } catch (error) {
    console.error(`Error in scheduled handler for ${providerName}:`, error);
  }
}

/**
 * Generate repository configuration file
 */
function generateRepoFile(baseUrl: string, providerName: string, displayName: string): string {
  return `[${providerName}]
name=${displayName}
baseurl=${baseUrl}/${providerName}
enabled=1
gpgcheck=0
repo_gpgcheck=0
type=rpm
`;
}

/**
 * Handle RPM file download with caching
 */
async function handleRpmDownload(request: Request, env: Env, provider: any, filename: string): Promise<Response> {
  // Get version info from index by exact filename match
  const versionManager = new VersionManager(env.VERSION_INDEX, provider);
  const versions = await versionManager.getAllVersions();

  const versionInfo = versions.find(v => v.filename === filename);

  if (!versionInfo) {
    return new Response('RPM not found in index', { status: 404 });
  }

  // Fetch from origin
  const originResponse = await fetch(versionInfo.url);
  if (!originResponse.ok) {
    return new Response('Failed to fetch RPM from origin', { status: 502 });
  }

  // Create response with CDN cache headers, preserving Content-Length
  const headers = new Headers({
    'Content-Type': 'application/x-rpm',
    'Content-Disposition': `attachment; filename="${filename}"`,
    // Cache for 30 days in browser and CDN
    'Cache-Control': `public, max-age=${CACHE_TTL_RPM}`,
    // Tell Cloudflare to cache this for 30 days
    'CDN-Cache-Control': `public, max-age=${CACHE_TTL_RPM}`,
  });

  // Preserve Content-Length from origin
  const contentLength = originResponse.headers.get('content-length');
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }

  // Stream the response directly without cloning (Cloudflare CDN will cache it)
  return new Response(originResponse.body, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers: headers
  });
}

/**
 * Handle repository metadata requests
 */
async function handleMetadata(request: Request, env: Env, provider: any): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Generate repository metadata on-the-fly
  const metadataManager = new MetadataManager(env.VERSION_INDEX, provider);
  const versionManager = new VersionManager(env.VERSION_INDEX, provider);
  const versions = await versionManager.getAllVersions();

  if (versions.length === 0) {
    return new Response('No versions available', { status: 503 });
  }

  // Get pre-extracted metadata from KV
  const metadataList = await metadataManager.getAllMetadata(
    versions.map(v => ({ version: v.version, release: v.release }))
  );

  if (metadataList.length === 0) {
    return new Response('Metadata not yet extracted. Please try again in a few minutes.', { status: 503 });
  }

  // Generate repository metadata on-the-fly
  const repoMetadata = await generateRepoMetadata(metadataList);

  // Determine which file to return
  let content: string | Uint8Array;
  let contentType: string;

  if (path.endsWith('repomd.xml')) {
    content = repoMetadata.repomd.xml;
    contentType = 'application/xml';
  } else if (path.endsWith('primary.xml.gz')) {
    content = repoMetadata.primary.gz;
    contentType = 'application/x-gzip';
  } else if (path.endsWith('filelists.xml.gz')) {
    content = repoMetadata.filelists.gz;
    contentType = 'application/x-gzip';
  } else if (path.endsWith('other.xml.gz')) {
    content = repoMetadata.other.gz;
    contentType = 'application/x-gzip';
  } else {
    return new Response('Not found', { status: 404 });
  }

  // Return response with short cache for metadata (regenerated on-the-fly)
  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      // Short cache (5 minutes) for metadata since it's generated on-the-fly
      'Cache-Control': 'public, max-age=300',
      'CDN-Cache-Control': 'public, max-age=300',
    }
  });
}

/**
 * Handle HTTP requests
 */
async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;


  // Root - index page
  if (path === '/' || path === '') {
    let repoList = '';
    for (const [name, provider] of Object.entries(providers)) {
      const config = provider.getRepoConfig();
      repoList += `\n${config.displayName}:
  sudo curl -o /etc/yum.repos.d/${name}.repo ${env.REPO_BASE_URL}/${name}/${name}.repo
  sudo dnf install ${name}
`;
    }

    return new Response(`RPM Repository Proxy

Available repositories:${repoList}
`, {
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  // Provider-specific routes: /{provider}/*
  const pathMatch = path.match(/^\/([^\/]+)(\/.*)?$/);
  if (pathMatch) {
    const providerName = pathMatch[1];
    const subPath = pathMatch[2] || '/';
    const provider = providers[providerName];

    if (!provider) {
      return new Response('Provider not found', { status: 404 });
    }

    const config = provider.getRepoConfig();

    // Manual trigger for scheduled task (for testing)
    if (subPath === '/__trigger-scheduled' && request.method === 'POST') {
      await handleScheduledForProvider(env, provider);
      return new Response(`Scheduled task triggered for provider: ${providerName}`, { status: 200 });
    }

    // Provider index
    if (subPath === '/' || subPath === '') {
      const versionManager = new VersionManager(env.VERSION_INDEX, provider);
      const versions = await versionManager.getAllVersions();

      let versionList = 'No versions available yet';
      if (versions.length > 0) {
        versionList = versions.map(v => `  - ${v.version}-${v.release}`).join('\n');
      }

      return new Response(`${config.displayName}

Add to your system:
  sudo curl -o /etc/yum.repos.d/${providerName}.repo ${env.REPO_BASE_URL}/${providerName}/${providerName}.repo
  sudo dnf install ${providerName}

Available versions:
${versionList}
`, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Repository configuration file
    if (subPath === `/${providerName}.repo`) {
      return new Response(generateRepoFile(env.REPO_BASE_URL, providerName, config.displayName), {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Repository metadata files
    if (subPath.startsWith('/repodata/')) {
      return handleMetadata(request, env, provider);
    }

    // RPM files
    if (subPath.endsWith('.rpm')) {
      const filename = subPath.split('/').pop() || '';
      return handleRpmDownload(request, env, provider, filename);
    }
  }

  return new Response('Not found', { status: 404 });
}

/**
 * Main entry point
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(`Internal server error: ${error}`, { status: 500 });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Match cron pattern to provider
    switch (event.cron) {
      case "0 */6 * * *":  // cursor - every 6 hours at minute 0
        await handleScheduledForProvider(env, providers.cursor);
        break;
      default:
        console.error(`Unknown cron pattern: ${event.cron}`);
    }
  }
};
