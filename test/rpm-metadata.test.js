import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import './polyfills.js'; // Load crypto.DigestStream polyfill
import { extractRpmMetadata } from '../src/rpm-metadata.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_RPM = path.join(__dirname, 'cursor.rpm');
const TEST_PORT = 8765;
const TEST_URL = `http://localhost:${TEST_PORT}/cursor.rpm`;

describe('RPM Metadata Extraction', () => {
  let metadata;
  let rpmToolData;
  let server;

  before(async () => {
    // Start local HTTP server to serve the test RPM
    await new Promise((resolve) => {
      server = http.createServer((req, res) => {
        if (req.url === '/cursor.rpm') {
          const stat = fs.statSync(TEST_RPM);
          const range = req.headers.range;

          if (range) {
            // Handle range request
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunksize,
              'Content-Type': 'application/x-rpm'
            });
            fs.createReadStream(TEST_RPM, { start, end }).pipe(res);
          } else {
            // Full file
            res.writeHead(200, {
              'Content-Length': stat.size,
              'Content-Type': 'application/x-rpm'
            });
            fs.createReadStream(TEST_RPM).pipe(res);
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      server.listen(TEST_PORT, () => resolve());
    });

    // Extract metadata using our module
    metadata = await extractRpmMetadata(TEST_URL, 'cursor.rpm');

    // Get expected values from rpm tool
    const rpmQuery = execSync(
      `rpm -qp --queryformat '%{NAME}|%{VERSION}|%{RELEASE}|%{ARCH}|%{SUMMARY}|%{SIZE}|%{VENDOR}|%{LICENSE}|%{PACKAGER}|%{BUILDTIME}' ${TEST_RPM}`,
      { encoding: 'utf8' }
    );
    const [name, version, release, arch, summary, size, vendor, license, packager, buildTime] = rpmQuery.split('|');

    const sha256 = execSync(`sha256sum ${TEST_RPM}`, { encoding: 'utf8' }).split(' ')[0];
    const requiresCount = parseInt(execSync(`rpm -qp --requires ${TEST_RPM} | wc -l`, { encoding: 'utf8' }).trim());
    const fileSize = fs.statSync(TEST_RPM).size;

    rpmToolData = {
      name,
      version,
      release,
      arch,
      summary,
      size: parseInt(size),
      vendor,
      license,
      packager,
      buildTime: new Date(parseInt(buildTime) * 1000),
      sha256,
      requiresCount,
      fileSize
    };
  });

  describe('Basic Package Info', () => {
    it('should extract correct package name', () => {
      assert.strictEqual(metadata.name, rpmToolData.name);
    });

    it('should extract correct version', () => {
      assert.strictEqual(metadata.version, rpmToolData.version);
    });

    it('should extract correct release', () => {
      assert.strictEqual(metadata.release, rpmToolData.release);
    });

    it('should extract correct architecture', () => {
      assert.strictEqual(metadata.arch, rpmToolData.arch);
    });

    it('should extract correct summary', () => {
      assert.strictEqual(metadata.summary, rpmToolData.summary);
    });

    it('should extract correct vendor', () => {
      assert.strictEqual(metadata.vendor, rpmToolData.vendor);
    });

    it('should extract correct license', () => {
      assert.strictEqual(metadata.license, rpmToolData.license);
    });

    it('should extract correct packager', () => {
      assert.strictEqual(metadata.packager, rpmToolData.packager);
    });
  });

  describe('Size Information', () => {
    it('should extract correct installed size', () => {
      assert.strictEqual(metadata.size.installed, rpmToolData.size);
    });

    it('should extract correct package size', () => {
      assert.strictEqual(metadata.size.package, rpmToolData.fileSize);
    });
  });

  describe('Checksum', () => {
    it('should calculate correct SHA256 checksum', () => {
      assert.strictEqual(metadata.checksum.type, 'sha256');
      assert.strictEqual(metadata.checksum.value, rpmToolData.sha256);
    });
  });

  describe('Build Information', () => {
    it('should extract correct build time', () => {
      assert.strictEqual(metadata.buildTime.getTime(), rpmToolData.buildTime.getTime());
    });

    it('should have platform information', () => {
      assert.ok(metadata.platform);
      assert.match(metadata.platform, /linux/i);
    });
  });

  describe('Dependencies', () => {
    it('should extract dependencies', () => {
      assert.ok(Array.isArray(metadata.dependencies));
      assert.ok(metadata.dependencies.length > 0);
    });

    it('should have correct number of dependencies', () => {
      assert.strictEqual(metadata.dependencies.length, rpmToolData.requiresCount);
    });

    it('should have dependency objects with name property', () => {
      metadata.dependencies.forEach(dep => {
        assert.ok(dep.name, 'Dependency should have a name');
      });
    });

    it('should extract rpmlib dependencies with LE flags', () => {
      const rpmlibDeps = metadata.dependencies.filter(d => d.name.startsWith('rpmlib('));
      assert.ok(rpmlibDeps.length > 0, 'Should have at least one rpmlib dependency');

      rpmlibDeps.forEach(dep => {
        assert.ok(dep.version, 'rpmlib dependency should have version');
        assert.strictEqual(dep.flags, 'LE', 'rpmlib dependency should have LE flag');
      });
    });

    it('should extract all possible dependency flags (EQ, LT, LE, GT, GE)', () => {
      // Test that our flag mapping works correctly
      const allPossibleFlags = ['EQ', 'LT', 'LE', 'GT', 'GE'];
      const foundFlags = new Set(
        metadata.dependencies
          .filter(d => d.flags)
          .map(d => d.flags)
      );

      // At minimum, we should have LE from rpmlib dependencies
      assert.ok(foundFlags.has('LE'), 'Should have at least LE flag from rpmlib dependencies');

      // Verify all found flags are valid
      foundFlags.forEach(flag => {
        assert.ok(allPossibleFlags.includes(flag), `Flag ${flag} should be one of ${allPossibleFlags.join(', ')}`);
      });
    });

    it('should only have flags when version is present', () => {
      const depsWithFlags = metadata.dependencies.filter(d => d.flags);
      depsWithFlags.forEach(dep => {
        assert.ok(dep.version, 'Dependency with flags should have version');
      });
    });
  });

  after(() => {
    // Close the HTTP server
    if (server) {
      server.close();
    }
  });

  describe('File Information', () => {
    it('should store filename', () => {
      assert.strictEqual(metadata.filename, 'cursor.rpm');
    });
  });

  describe('Digest Information', () => {
    it('should have digest information', () => {
      assert.ok(metadata.digest);
    });

    it('should have sha1 digest', () => {
      assert.ok(metadata.digest.sha1);
      assert.match(metadata.digest.sha1, /^[a-f0-9]{40}$/);
    });
  });
});