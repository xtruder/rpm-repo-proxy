import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { VersionManager } from '../src/version-discovery.ts';
import { CursorProvider } from '../src/providers/cursor.ts';

// Mock KV namespace for testing
class MockKV {
  constructor() {
    this.store = new Map();
  }

  async get(key, type) {
    const value = this.store.get(key);
    if (!value) return null;
    if (type === 'json') return JSON.parse(value);
    return value;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  clear() {
    this.store.clear();
  }
}

describe('VersionManager', () => {
  let mockKV;
  let provider;
  let versionManager;

  beforeEach(() => {
    mockKV = new MockKV();
    provider = new CursorProvider();
    versionManager = new VersionManager(mockKV, provider);
  });

  describe('getIndex', () => {
    it('should return empty index when KV is empty', async () => {
      const index = await versionManager.getIndex();
      assert.deepStrictEqual(index, { versions: [], updated: null });
    });

    it('should return stored index', async () => {
      const testIndex = {
        versions: [{
          version: '1.7.28',
          release: '1759287435',
          url: 'https://example.com/cursor.rpm',
          filename: 'cursor-1.7.28-1759287435.el8.x86_64.rpm',
          added: '2025-10-01T00:00:00.000Z'
        }],
        updated: '2025-10-01T00:00:00.000Z'
      };

      await mockKV.put('cursor:version-index', JSON.stringify(testIndex));
      const index = await versionManager.getIndex();
      assert.deepStrictEqual(index, testIndex);
    });
  });

  describe('saveIndex', () => {
    it('should save index to KV', async () => {
      const testIndex = {
        versions: [{
          version: '1.7.28',
          release: '1759287435',
          url: 'https://example.com/cursor.rpm',
          filename: 'cursor-1.7.28-1759287435.el8.x86_64.rpm',
          added: '2025-10-01T00:00:00.000Z'
        }],
        updated: '2025-10-01T00:00:00.000Z'
      };

      await versionManager.saveIndex(testIndex);
      const stored = await mockKV.get('cursor:version-index', 'json');
      assert.deepStrictEqual(stored, testIndex);
    });
  });

  describe('fetchLatestVersion', () => {
    it('should fetch and parse latest version from Cursor API', async () => {
      const latest = await versionManager.fetchLatestVersion();

      assert.ok(latest.version);
      assert.ok(latest.release);
      assert.ok(latest.url);
      assert.ok(latest.filename);

      // Version should be in format X.Y.Z
      assert.match(latest.version, /^\d+\.\d+\.\d+$/);

      // Release should be hex string (commit sha prefix)
      assert.match(latest.release, /^[a-f0-9]{10}$/);

      // URL should contain the version
      assert.ok(latest.url.includes(latest.version));

      // Filename should match expected format
      assert.strictEqual(
        latest.filename,
        `cursor-${latest.version}-${latest.release}.el8.x86_64.rpm`
      );
    });
  });

  describe('checkAndUpdate', () => {
    it('should add new version to empty index', async () => {
      const updated = await versionManager.checkAndUpdate();
      assert.strictEqual(updated, true);

      const index = await versionManager.getIndex();
      assert.strictEqual(index.versions.length, 1);
      assert.ok(index.updated);

      const version = index.versions[0];
      assert.ok(version.version);
      assert.ok(version.release);
      assert.ok(version.url);
      assert.ok(version.filename);
      assert.ok(version.added);
    });

    it('should not add duplicate version', async () => {
      // Add first time
      await versionManager.checkAndUpdate();
      const index1 = await versionManager.getIndex();

      // Try adding again
      const updated = await versionManager.checkAndUpdate();
      assert.strictEqual(updated, false);

      const index2 = await versionManager.getIndex();
      assert.strictEqual(index2.versions.length, index1.versions.length);
      assert.deepStrictEqual(index2.versions[0], index1.versions[0]);
    });

    it('should add new version to front of list', async () => {
      // Add mock old version
      const oldVersion = {
        version: '1.0.0',
        release: '1000000000',
        url: 'https://example.com/old.rpm',
        filename: 'cursor-1.0.0-1000000000.el8.x86_64.rpm',
        added: '2025-01-01T00:00:00.000Z'
      };

      await versionManager.saveIndex({
        versions: [oldVersion],
        updated: '2025-01-01T00:00:00.000Z'
      });

      // Add new version
      await versionManager.checkAndUpdate();

      const index = await versionManager.getIndex();
      assert.strictEqual(index.versions.length, 2);

      // New version should be first
      assert.notStrictEqual(index.versions[0].version, '1.0.0');
      // Old version should be second
      assert.strictEqual(index.versions[1].version, '1.0.0');
    });
  });

  describe('getLatest', () => {
    it('should return null for empty index', async () => {
      const latest = await versionManager.getLatest();
      assert.strictEqual(latest, null);
    });

    it('should return first version from index', async () => {
      const testIndex = {
        versions: [
          {
            version: '1.7.28',
            release: '1759287435',
            url: 'https://example.com/new.rpm',
            filename: 'cursor-1.7.28-1759287435.el8.x86_64.rpm',
            added: '2025-10-01T00:00:00.000Z'
          },
          {
            version: '1.7.27',
            release: '1759000000',
            url: 'https://example.com/old.rpm',
            filename: 'cursor-1.7.27-1759000000.el8.x86_64.rpm',
            added: '2025-09-01T00:00:00.000Z'
          }
        ],
        updated: '2025-10-01T00:00:00.000Z'
      };

      await versionManager.saveIndex(testIndex);
      const latest = await versionManager.getLatest();

      assert.strictEqual(latest.version, '1.7.28');
    });
  });

  describe('getAllVersions', () => {
    it('should return empty array for empty index', async () => {
      const versions = await versionManager.getAllVersions();
      assert.deepStrictEqual(versions, []);
    });

    it('should return all versions from index', async () => {
      const testIndex = {
        versions: [
          {
            version: '1.7.28',
            release: '1759287435',
            url: 'https://example.com/new.rpm',
            filename: 'cursor-1.7.28-1759287435.el8.x86_64.rpm',
            added: '2025-10-01T00:00:00.000Z'
          },
          {
            version: '1.7.27',
            release: '1759000000',
            url: 'https://example.com/old.rpm',
            filename: 'cursor-1.7.27-1759000000.el8.x86_64.rpm',
            added: '2025-09-01T00:00:00.000Z'
          }
        ],
        updated: '2025-10-01T00:00:00.000Z'
      };

      await versionManager.saveIndex(testIndex);
      const versions = await versionManager.getAllVersions();

      assert.strictEqual(versions.length, 2);
      assert.deepStrictEqual(versions, testIndex.versions);
    });
  });
});
