interface PackageMetadata {
  name: string;
  version: string;
  release: string;
  arch: string;
  summary: string;
  description: string;
  packager: string;
  buildTime: Date;
  size: {
    package: number;
    installed: number;
  };
  checksum: {
    type: string;
    value: string;
  };
  filename: string;
  license: string;
  vendor: string;
  dependencies?: Array<{
    name: string;
    flags?: string;
    version?: string;
  }>;
}

interface MetadataFileInfo {
  checksum: string;
  checksumGz: string;
  size: number;
  sizeGz: number;
}

interface RepoMetadata {
  repomd: {
    xml: string;
  };
  primary: {
    xml: string;
    gz: Uint8Array;
    checksum: string;
    openChecksum: string;
    size: number;
    openSize: number;
  };
  filelists: {
    xml: string;
    gz: Uint8Array;
    checksum: string;
    openChecksum: string;
    size: number;
    openSize: number;
  };
  other: {
    xml: string;
    gz: Uint8Array;
    checksum: string;
    openChecksum: string;
    size: number;
    openSize: number;
  };
}

/**
 * Escape XML special characters
 */
function escapeXml(str: any): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Calculate SHA256 checksum using Web Crypto API
 */
async function calculateSha256(data: string | Uint8Array): Promise<string> {
  const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compress data with gzip using CompressionStream
 */
async function gzipCompress(data: string | Uint8Array): Promise<Uint8Array> {
  const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;

  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(buffer);
  writer.close();

  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/**
 * Generate primary.xml content
 */
function generatePrimaryXml(packages: PackageMetadata[], timestamp: number): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" packages="${packages.length}">\n`;

  for (const pkg of packages) {
    xml += '  <package type="rpm">\n';
    xml += `    <name>${escapeXml(pkg.name)}</name>\n`;
    xml += `    <arch>${escapeXml(pkg.arch)}</arch>\n`;
    xml += `    <version epoch="0" ver="${escapeXml(pkg.version)}" rel="${escapeXml(pkg.release)}"/>\n`;
    xml += `    <checksum type="${pkg.checksum.type}" pkgid="YES">${pkg.checksum.value}</checksum>\n`;
    xml += `    <summary>${escapeXml(pkg.summary)}</summary>\n`;
    xml += `    <description>${escapeXml(pkg.description)}</description>\n`;
    xml += `    <packager>${escapeXml(pkg.packager)}</packager>\n`;
    xml += `    <url></url>\n`;
    xml += `    <time file="${timestamp}" build="${Math.floor(new Date(pkg.buildTime).getTime() / 1000)}"/>\n`;
    xml += `    <size package="${pkg.size.package}" installed="${pkg.size.installed}" archive="0"/>\n`;
    xml += `    <location href="${escapeXml(pkg.filename)}"/>\n`;

    // Format section
    xml += `    <format>\n`;
    xml += `      <rpm:license>${escapeXml(pkg.license)}</rpm:license>\n`;
    xml += `      <rpm:vendor>${escapeXml(pkg.vendor)}</rpm:vendor>\n`;
    xml += `      <rpm:buildhost></rpm:buildhost>\n`;
    xml += `      <rpm:header-range start="0" end="0"/>\n`;

    // Provides
    xml += `      <rpm:provides>\n`;
    xml += `        <rpm:entry name="${escapeXml(pkg.name)}" flags="EQ" epoch="0" ver="${escapeXml(pkg.version)}" rel="${escapeXml(pkg.release)}"/>\n`;
    xml += `        <rpm:entry name="${escapeXml(pkg.name)}(${escapeXml(pkg.arch)})" flags="EQ" epoch="0" ver="${escapeXml(pkg.version)}" rel="${escapeXml(pkg.release)}"/>\n`;
    xml += `      </rpm:provides>\n`;

    // Requires
    if (pkg.dependencies && pkg.dependencies.length > 0) {
      xml += `      <rpm:requires>\n`;
      for (const dep of pkg.dependencies) {
        const depName = escapeXml(dep.name);
        const flags = dep.flags ? ` flags="${escapeXml(dep.flags)}"` : '';
        const version = dep.version ? ` ver="${escapeXml(dep.version)}"` : '';

        xml += `        <rpm:entry name="${depName}"${flags}${version}/>\n`;
      }
      xml += `      </rpm:requires>\n`;
    }

    xml += `    </format>\n`;
    xml += '  </package>\n';
  }

  xml += '</metadata>\n';
  return xml;
}

/**
 * Generate filelists.xml content
 */
function generateFilelistsXml(packages: PackageMetadata[]): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<filelists xmlns="http://linux.duke.edu/metadata/filelists" packages="${packages.length}">\n`;

  for (const pkg of packages) {
    xml += `  <package pkgid="${pkg.checksum.value}" name="${escapeXml(pkg.name)}" arch="${escapeXml(pkg.arch)}">\n`;
    xml += `    <version epoch="0" ver="${escapeXml(pkg.version)}" rel="${escapeXml(pkg.release)}"/>\n`;
    xml += '  </package>\n';
  }

  xml += '</filelists>\n';
  return xml;
}

/**
 * Generate other.xml content
 */
function generateOtherXml(packages: PackageMetadata[]): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<otherdata xmlns="http://linux.duke.edu/metadata/other" packages="${packages.length}">\n`;

  for (const pkg of packages) {
    xml += `  <package pkgid="${pkg.checksum.value}" name="${escapeXml(pkg.name)}" arch="${escapeXml(pkg.arch)}">\n`;
    xml += `    <version epoch="0" ver="${escapeXml(pkg.version)}" rel="${escapeXml(pkg.release)}"/>\n`;
    xml += '  </package>\n';
  }

  xml += '</otherdata>\n';
  return xml;
}

/**
 * Generate repomd.xml content
 */
function generateRepomdXml(
  timestamp: number,
  primaryInfo: MetadataFileInfo,
  filelistsInfo: MetadataFileInfo,
  otherInfo: MetadataFileInfo
): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<repomd xmlns="http://linux.duke.edu/metadata/repo" xmlns:rpm="http://linux.duke.edu/metadata/rpm">\n';
  xml += `  <revision>${timestamp}</revision>\n`;

  // Primary
  xml += '  <data type="primary">\n';
  xml += `    <checksum type="sha256">${primaryInfo.checksumGz}</checksum>\n`;
  xml += `    <open-checksum type="sha256">${primaryInfo.checksum}</open-checksum>\n`;
  xml += `    <location href="repodata/primary.xml.gz"/>\n`;
  xml += `    <timestamp>${timestamp}</timestamp>\n`;
  xml += `    <size>${primaryInfo.sizeGz}</size>\n`;
  xml += `    <open-size>${primaryInfo.size}</open-size>\n`;
  xml += '  </data>\n';

  // Filelists
  xml += '  <data type="filelists">\n';
  xml += `    <checksum type="sha256">${filelistsInfo.checksumGz}</checksum>\n`;
  xml += `    <open-checksum type="sha256">${filelistsInfo.checksum}</open-checksum>\n`;
  xml += `    <location href="repodata/filelists.xml.gz"/>\n`;
  xml += `    <timestamp>${timestamp}</timestamp>\n`;
  xml += `    <size>${filelistsInfo.sizeGz}</size>\n`;
  xml += `    <open-size>${filelistsInfo.size}</open-size>\n`;
  xml += '  </data>\n';

  // Other
  xml += '  <data type="other">\n';
  xml += `    <checksum type="sha256">${otherInfo.checksumGz}</checksum>\n`;
  xml += `    <open-checksum type="sha256">${otherInfo.checksum}</open-checksum>\n`;
  xml += `    <location href="repodata/other.xml.gz"/>\n`;
  xml += `    <timestamp>${timestamp}</timestamp>\n`;
  xml += `    <size>${otherInfo.sizeGz}</size>\n`;
  xml += `    <open-size>${otherInfo.size}</open-size>\n`;
  xml += '  </data>\n';

  xml += '</repomd>\n';
  return xml;
}

/**
 * Generate complete repository metadata
 */
export async function generateRepoMetadata(packages: PackageMetadata[]): Promise<RepoMetadata> {
  // Use latest package build time as fixed timestamp for deterministic metadata
  const timestamp = packages.length > 0 ? Math.floor(new Date(packages[0].buildTime).getTime() / 1000) : 0;

  // Generate XML files
  const primaryXml = generatePrimaryXml(packages, timestamp);
  const filelistsXml = generateFilelistsXml(packages);
  const otherXml = generateOtherXml(packages);

  // Compress files
  const primaryGz = await gzipCompress(primaryXml);
  const filelistsGz = await gzipCompress(filelistsXml);
  const otherGz = await gzipCompress(otherXml);

  // Calculate checksums
  const primaryChecksum = await calculateSha256(primaryXml);
  const primaryChecksumGz = await calculateSha256(primaryGz);
  const filelistsChecksum = await calculateSha256(filelistsXml);
  const filelistsChecksumGz = await calculateSha256(filelistsGz);
  const otherChecksum = await calculateSha256(otherXml);
  const otherChecksumGz = await calculateSha256(otherGz);

  // Generate repomd.xml
  const repomdXml = generateRepomdXml(
    timestamp,
    {
      checksum: primaryChecksum,
      checksumGz: primaryChecksumGz,
      size: primaryXml.length,
      sizeGz: primaryGz.length
    },
    {
      checksum: filelistsChecksum,
      checksumGz: filelistsChecksumGz,
      size: filelistsXml.length,
      sizeGz: filelistsGz.length
    },
    {
      checksum: otherChecksum,
      checksumGz: otherChecksumGz,
      size: otherXml.length,
      sizeGz: otherGz.length
    }
  );

  return {
    repomd: {
      xml: repomdXml
    },
    primary: {
      xml: primaryXml,
      gz: primaryGz,
      checksum: primaryChecksumGz,
      openChecksum: primaryChecksum,
      size: primaryGz.length,
      openSize: primaryXml.length
    },
    filelists: {
      xml: filelistsXml,
      gz: filelistsGz,
      checksum: filelistsChecksumGz,
      openChecksum: filelistsChecksum,
      size: filelistsGz.length,
      openSize: filelistsXml.length
    },
    other: {
      xml: otherXml,
      gz: otherGz,
      checksum: otherChecksumGz,
      openChecksum: otherChecksum,
      size: otherGz.length,
      openSize: otherXml.length
    }
  };
}
