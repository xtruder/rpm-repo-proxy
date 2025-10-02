import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { Readable } from 'stream';
import { execSync } from 'child_process';
import { extractRpmMetadata } from '../src/rpm-metadata.ts';
import { generateRepoMetadata } from '../src/repo-metadata.ts';

const TEST_RPM = 'cursor.rpm';

// TODO: These tests need to be updated for the new extractRpmMetadata API
// The new API requires a URL (fetches twice: 10MB for headers, full file for checksum)
// We need to set up a local HTTP server to serve the test RPM file
describe.skip('Repository Metadata Generation', () => {
  let metadata;
  let repoMetadata;

  before(async () => {
    // Extract RPM metadata
    const nodeStream = fs.createReadStream(TEST_RPM);
    const webStream = Readable.toWeb(nodeStream);
    metadata = await extractRpmMetadata(webStream, TEST_RPM);

    // Generate repository metadata
    repoMetadata = await generateRepoMetadata([metadata]);
  });

  describe('Repository Structure', () => {
    it('should generate repomd.xml', () => {
      assert.ok(repoMetadata.repomd);
      assert.ok(repoMetadata.repomd.xml);
      assert.ok(repoMetadata.repomd.xml.length > 0);
    });

    it('should generate primary metadata', () => {
      assert.ok(repoMetadata.primary);
      assert.ok(repoMetadata.primary.xml);
      assert.ok(repoMetadata.primary.gz);
    });

    it('should generate filelists metadata', () => {
      assert.ok(repoMetadata.filelists);
      assert.ok(repoMetadata.filelists.xml);
      assert.ok(repoMetadata.filelists.gz);
    });

    it('should generate other metadata', () => {
      assert.ok(repoMetadata.other);
      assert.ok(repoMetadata.other.xml);
      assert.ok(repoMetadata.other.gz);
    });
  });

  describe('XML Structure', () => {
    it('repomd.xml should be valid XML', () => {
      assert.ok(repoMetadata.repomd.xml.startsWith('<?xml'));
      assert.ok(repoMetadata.repomd.xml.includes('<repomd'));
      assert.ok(repoMetadata.repomd.xml.includes('</repomd>'));
    });

    it('primary.xml should be valid XML', () => {
      assert.ok(repoMetadata.primary.xml.startsWith('<?xml'));
      assert.ok(repoMetadata.primary.xml.includes('<metadata'));
      assert.ok(repoMetadata.primary.xml.includes('</metadata>'));
    });

    it('filelists.xml should be valid XML', () => {
      assert.ok(repoMetadata.filelists.xml.startsWith('<?xml'));
      assert.ok(repoMetadata.filelists.xml.includes('<filelists'));
      assert.ok(repoMetadata.filelists.xml.includes('</filelists>'));
    });

    it('other.xml should be valid XML', () => {
      assert.ok(repoMetadata.other.xml.startsWith('<?xml'));
      assert.ok(repoMetadata.other.xml.includes('<otherdata'));
      assert.ok(repoMetadata.other.xml.includes('</otherdata>'));
    });
  });

  describe('Metadata Content', () => {
    it('repomd.xml should reference all metadata files', () => {
      assert.ok(repoMetadata.repomd.xml.includes('type="primary"'));
      assert.ok(repoMetadata.repomd.xml.includes('type="filelists"'));
      assert.ok(repoMetadata.repomd.xml.includes('type="other"'));
    });

    it('repomd.xml should include checksums', () => {
      assert.ok(repoMetadata.repomd.xml.includes(repoMetadata.primary.checksum));
      assert.ok(repoMetadata.repomd.xml.includes(repoMetadata.filelists.checksum));
      assert.ok(repoMetadata.repomd.xml.includes(repoMetadata.other.checksum));
    });

    it('repomd.xml should include file sizes', () => {
      assert.ok(repoMetadata.repomd.xml.includes(`<size>${repoMetadata.primary.size}</size>`));
      assert.ok(repoMetadata.repomd.xml.includes(`<open-size>${repoMetadata.primary.openSize}</open-size>`));
    });

    it('primary.xml should contain package information', () => {
      assert.ok(repoMetadata.primary.xml.includes(`<name>${metadata.name}</name>`));
      assert.ok(repoMetadata.primary.xml.includes(`<arch>${metadata.arch}</arch>`));
      assert.ok(repoMetadata.primary.xml.includes(metadata.version));
      assert.ok(repoMetadata.primary.xml.includes(metadata.checksum.value));
    });

    it('primary.xml should contain package count', () => {
      assert.ok(repoMetadata.primary.xml.includes('packages="1"'));
    });

    it('filelists.xml should contain package checksum', () => {
      assert.ok(repoMetadata.filelists.xml.includes(metadata.checksum.value));
    });
  });

  describe('Checksums', () => {
    it('should have valid SHA256 checksums', () => {
      assert.match(repoMetadata.primary.checksum, /^[a-f0-9]{64}$/);
      assert.match(repoMetadata.primary.openChecksum, /^[a-f0-9]{64}$/);
      assert.match(repoMetadata.filelists.checksum, /^[a-f0-9]{64}$/);
      assert.match(repoMetadata.filelists.openChecksum, /^[a-f0-9]{64}$/);
      assert.match(repoMetadata.other.checksum, /^[a-f0-9]{64}$/);
      assert.match(repoMetadata.other.openChecksum, /^[a-f0-9]{64}$/);
    });

    it('compressed and uncompressed checksums should be different', () => {
      assert.notStrictEqual(repoMetadata.primary.checksum, repoMetadata.primary.openChecksum);
      assert.notStrictEqual(repoMetadata.filelists.checksum, repoMetadata.filelists.openChecksum);
      assert.notStrictEqual(repoMetadata.other.checksum, repoMetadata.other.openChecksum);
    });
  });

  describe('Compression', () => {
    it('compressed files should be smaller than uncompressed', () => {
      assert.ok(repoMetadata.primary.size < repoMetadata.primary.openSize);
      assert.ok(repoMetadata.filelists.size < repoMetadata.filelists.openSize);
      assert.ok(repoMetadata.other.size < repoMetadata.other.openSize);
    });

    it('compressed size should match buffer length', () => {
      assert.strictEqual(repoMetadata.primary.gz.length, repoMetadata.primary.size);
      assert.strictEqual(repoMetadata.filelists.gz.length, repoMetadata.filelists.size);
      assert.strictEqual(repoMetadata.other.gz.length, repoMetadata.other.size);
    });

    it('uncompressed size should match XML length', () => {
      assert.strictEqual(repoMetadata.primary.xml.length, repoMetadata.primary.openSize);
      assert.strictEqual(repoMetadata.filelists.xml.length, repoMetadata.filelists.openSize);
      assert.strictEqual(repoMetadata.other.xml.length, repoMetadata.other.openSize);
    });
  });

  describe('Dependencies in Metadata', () => {
    it('primary.xml should include dependencies', () => {
      assert.ok(repoMetadata.primary.xml.includes('<rpm:requires>'));
      assert.ok(repoMetadata.primary.xml.includes('<rpm:entry'));
    });

    it('primary.xml should include provides', () => {
      assert.ok(repoMetadata.primary.xml.includes('<rpm:provides>'));
      assert.ok(repoMetadata.primary.xml.includes(`name="${metadata.name}"`));
    });
  });
});