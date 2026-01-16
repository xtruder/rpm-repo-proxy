import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GitHubProvider } from '../src/providers/github.ts';

describe('GitHubProvider', () => {
  const provider = new GitHubProvider({
    name: 'opencode',
    displayName: 'OpenCode Repository',
    description: 'OpenCode RPM packages',
    owner: 'anomalyco',
    repo: 'opencode',
    releasesCount: 5,
    includePrereleases: false,
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
  });

  describe('getName', () => {
    it('should return provider name', () => {
      assert.strictEqual(provider.getName(), 'opencode');
    });
  });

  describe('getRepoConfig', () => {
    it('should return repo configuration', () => {
      const config = provider.getRepoConfig();
      assert.strictEqual(config.name, 'opencode');
      assert.strictEqual(config.displayName, 'OpenCode Repository');
      assert.strictEqual(config.description, 'OpenCode RPM packages');
    });
  });

  describe('fetchVersions', () => {
    it('should fetch multiple versions from GitHub releases', async () => {
      const versions = await provider.fetchVersions(3);

      assert.ok(versions.length > 0, 'Should return at least one version');

      // Check that we have versions for both architectures
      const x86Versions = versions.filter(v => v.arch === 'x86_64');
      const armVersions = versions.filter(v => v.arch === 'aarch64');

      assert.ok(x86Versions.length > 0, 'Should have x86_64 versions');
      assert.ok(armVersions.length > 0, 'Should have aarch64 versions');

      // Check version structure
      for (const version of versions) {
        assert.ok(version.version, 'Should have version');
        assert.ok(version.release, 'Should have release');
        assert.ok(version.url, 'Should have url');
        assert.ok(version.filename, 'Should have filename');
        assert.ok(version.arch, 'Should have arch');

        // Version should be semver-like (without v prefix)
        assert.match(version.version, /^\d+\.\d+\.\d+/, 'Version should be semver-like');

        // URL should be a GitHub download URL
        assert.ok(version.url.includes('github.com'), 'URL should be from GitHub');
        assert.ok(version.url.includes('.rpm'), 'URL should point to RPM file');

        // Filename should follow RPM naming convention
        assert.match(
          version.filename,
          /^opencode-\d+\.\d+\.\d+-\d+\.(x86_64|aarch64)\.rpm$/,
          'Filename should follow RPM naming convention'
        );
      }
    });

    it('should limit results to requested count', async () => {
      const versions = await provider.fetchVersions(2);

      // With 2 releases and 2 architectures, max should be 4
      // But there might be fewer if some releases don't have all architectures
      assert.ok(versions.length <= 4, 'Should not exceed 2 releases x 2 architectures');
    });
  });

  describe('fetchLatestVersion', () => {
    it('should fetch the latest version', async () => {
      const latest = await provider.fetchLatestVersion();

      assert.ok(latest.version, 'Should have version');
      assert.ok(latest.release, 'Should have release');
      assert.ok(latest.url, 'Should have url');
      assert.ok(latest.filename, 'Should have filename');
      assert.ok(latest.arch, 'Should have arch');
    });
  });

  describe('version parsing', () => {
    it('should strip v prefix from version tags', async () => {
      const versions = await provider.fetchVersions(1);

      for (const version of versions) {
        assert.ok(!version.version.startsWith('v'), 'Version should not start with v prefix');
      }
    });
  });
});
