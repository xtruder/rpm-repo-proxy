import { parseRpmPackage, InfoTag, DependencyTag } from '@dx3mod/rpm-parser';

interface Dependency {
  name: string;
  version?: string;
  flags?: string;
}

interface RpmMetadata {
  name: string;
  version: string;
  release: string;
  arch: string;
  summary: string;
  description: string;
  vendor: string;
  license: string;
  packager: string;
  os: string;
  platform: string;
  filename: string;
  size: {
    package: number;
    installed: number;
  };
  checksum: {
    type: string;
    value: string;
  };
  url: string;
  buildTime: Date;
  dependencies: Dependency[];
  digest: any;
}

type FlagMap = {
  [key: number]: string;
};

/**
 * Extract metadata from RPM file
 * @param rpmUrl - RPM URL to fetch
 * @param filename - The RPM filename
 * @returns Extracted metadata
 * @throws Error if RPM parsing fails
 */
export async function extractRpmMetadata(rpmUrl: string, filename: string): Promise<RpmMetadata> {
  console.log('[RPM] Starting metadata extraction...');

  // Fetch twice in parallel: once for headers, once for checksum
  console.log('[RPM] Fetching headers and hashing in parallel...');

  // Fetch first 5MB for parsing headers
  const headerPromise = (async () => {
    console.log('[RPM] Fetching first 5MB for headers...');
    const FIVE_MB = 5 * 1024 * 1024;
    const response = await fetch(rpmUrl, {
      headers: { 'Range': `bytes=0-${FIVE_MB - 1}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch RPM headers: ${response.status}`);
    }
    console.log('[RPM] Parsing headers...');
    return await parseRpmPackage(response.body as ReadableStream<Uint8Array>);
  })();

  // Fetch full file for hashing and get size
  const hashAndSizePromise = (async () => {
    console.log('[RPM] Fetching full file for hashing...');
    const response = await fetch(rpmUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch RPM: ${response.status}`);
    }

    const packageSize = parseInt(response.headers.get('content-length') || '0');
    console.log(`[RPM] Package size: ${packageSize} bytes`);

    const digestStream = new crypto.DigestStream('SHA-256');
    await response.body!.pipeTo(digestStream);

    const digestValue = await digestStream.digest;
    const checksum = [...new Uint8Array(digestValue)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return { checksum, packageSize };
  })();

  // Wait for both to complete
  const [pkg, { checksum: sha256Checksum, packageSize }] = await Promise.all([headerPromise, hashAndSizePromise]);

  console.log('[RPM] Parsing and hashing complete');
  console.log('[RPM] Package:', {
    name: pkg.name,
    version: pkg.version,
    hasGet: typeof pkg.get === 'function'
  });
  console.log('[RPM] Checksum calculated:', sha256Checksum);

  // Extract dependency flags manually since pkg.dependencies doesn't include them
  const requireNames = (pkg.get(DependencyTag.RequireName) || []) as string[];
  const requireVersions = (pkg.get(DependencyTag.RequireVersion) || []) as string[];
  const requireFlags = (pkg.get(DependencyTag.RequireFlags) || []) as number[];

  // Map flag numbers to flag names (EQ, LT, LE, GT, GE)
  // RPM flags use the lower bits for comparison operators
  const flagMap: FlagMap = {
    2: 'LT',   // <
    4: 'GT',   // >
    8: 'EQ',   // =
    10: 'LE',  // <= (LT | EQ)
    12: 'GE',  // >= (GT | EQ)
  };

  const dependencies: Dependency[] = requireNames.map((name: string, i: number) => {
    const dep: Dependency = { name };
    const version = requireVersions[i];
    const flagNum = requireFlags[i];

    if (version && version.length > 0) {
      dep.version = version;
    }
    // Mask to get only the comparison bits (lower 4 bits)
    if (flagNum) {
      const comparisonBits = flagNum & 0x0F;
      if (flagMap[comparisonBits]) {
        dep.flags = flagMap[comparisonBits];
      }
    }

    return dep;
  });

  // Extract metadata from parsed package
  const metadata: RpmMetadata = {
    // Basic info
    name: pkg.name,
    version: pkg.version,
    release: pkg.release,
    arch: pkg.arch,

    // Package info
    summary: pkg.summery, // Note: typo in the library
    description: pkg.description,
    vendor: pkg.vendor,
    license: pkg.license,
    packager: pkg.packager,
    os: pkg.os,
    platform: pkg.platform,

    // Size
    filename: filename,
    size: {
      package: packageSize,
      installed: pkg.size
    },

    // Checksum calculated from actual file content
    checksum: {
      type: 'sha256',
      value: sha256Checksum
    },

    url: rpmUrl, // Include URL for reference

    // Build info
    buildTime: pkg.buildTime,

    // Dependencies with flags
    dependencies: dependencies,

    // Digest info from RPM headers
    digest: pkg.digest
  };

  console.log('[RPM] Metadata extraction complete!');
  return metadata;
}
