import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('config', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'matrix-bridge-config-'));
    delete process.env.PI_MATRIX_BRIDGE_HOMESERVER;
    delete process.env.PI_MATRIX_BRIDGE_ACCESS_TOKEN;
    delete process.env.PI_MATRIX_BRIDGE_AUTO_CONNECT;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function importConfig() {
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      return { ...actual, homedir: () => tmpDir };
    });
    return await import('../src/config');
  }

  it('returns empty config when no file exists', async () => {
    const { loadConfig } = await importConfig();
    expect(loadConfig()).toEqual({});
  });

  it('saves and loads config roundtrip', async () => {
    const { loadConfig, saveConfig } = await importConfig();

    saveConfig({ matrix: { homeserverUrl: 'https://matrix.org', accessToken: 'test-token' }, showWidget: true, hideToolCalls: false });
    const loaded = loadConfig();

    expect(loaded.matrix?.accessToken).toBe('test-token');
    expect(loaded.showWidget).toBe(true);
    expect(loaded.hideToolCalls).toBe(false);
  });

  it('creates .pi directory with 700 permissions', async () => {
    const { saveConfig } = await importConfig();
    saveConfig({});

    const stats = statSync(join(tmpDir, '.pi'));
    expect(stats.mode & 0o777).toBe(0o700);
  });

  it('writes config file with 600 permissions', async () => {
    const { saveConfig } = await importConfig();
    saveConfig({});

    const stats = statSync(join(tmpDir, '.pi', 'matrix-bridge.json'));
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('env vars override file values for the same transport', async () => {
    const { loadConfig, saveConfig } = await importConfig();

    saveConfig({ matrix: { homeserverUrl: 'https://matrix.org', accessToken: 'file-token' }, showWidget: true });
    process.env.PI_MATRIX_BRIDGE_HOMESERVER = 'https://matrix.org';
    process.env.PI_MATRIX_BRIDGE_ACCESS_TOKEN = 'env-token';

    const loaded = loadConfig();
    expect(loaded.matrix?.accessToken).toBe('env-token');
    // Non-overridden fields survive
    expect(loaded.showWidget).toBe(true);
  });

  it('loads Matrix env vars', async () => {
    process.env.PI_MATRIX_BRIDGE_HOMESERVER = 'https://matrix.org';
    process.env.PI_MATRIX_BRIDGE_ACCESS_TOKEN = 'mx-token';

    const { loadConfig } = await importConfig();
    const config = loadConfig();

    expect(config.matrix?.homeserverUrl).toBe('https://matrix.org');
    expect(config.matrix?.accessToken).toBe('mx-token');
  });

  it('handles corrupted config file gracefully', async () => {
    const piDir = join(tmpDir, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'matrix-bridge.json'), '{invalid json!!!');

    const { loadConfig } = await importConfig();
    // Should not throw, returns empty config
    const config = loadConfig();
    expect(config).toEqual({});
  });

  it('still applies env vars when config file is corrupted', async () => {
    const piDir = join(tmpDir, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'matrix-bridge.json'), 'not json');

    process.env.PI_MATRIX_BRIDGE_HOMESERVER = 'https://matrix.org';
    process.env.PI_MATRIX_BRIDGE_ACCESS_TOKEN = 'env-token';

    const { loadConfig } = await importConfig();
    const config = loadConfig();
    expect(config.matrix?.accessToken).toBe('env-token');
  });

  it('requires both Matrix env vars for matrix config', async () => {
    // Only homeserver — should not set matrix
    process.env.PI_MATRIX_BRIDGE_HOMESERVER = 'https://matrix.org';

    const { loadConfig } = await importConfig();
    expect(loadConfig().matrix).toBeUndefined();
  });

  it('saves and loads hideToolCalls config', async () => {
    const { loadConfig, saveConfig } = await importConfig();

    saveConfig({ hideToolCalls: true, showWidget: true });
    const loaded = loadConfig();

    expect(loaded.hideToolCalls).toBe(true);
    expect(loaded.showWidget).toBe(true);
  });

  it('hideToolCalls defaults to undefined (not hidden)', async () => {
    const { loadConfig } = await importConfig();
    expect(loadConfig().hideToolCalls).toBeUndefined();
  });

  it('shouldAutoConnect defaults to false when env var is unset', async () => {
    const { shouldAutoConnect } = await importConfig();
    expect(shouldAutoConnect()).toBe(false);
  });

  it('shouldAutoConnect is true only for "1"/"true"/"yes" (case-insensitive)', async () => {
    const { shouldAutoConnect } = await importConfig();
    for (const v of ['1', 'true', 'TRUE', ' Yes ']) {
      process.env.PI_MATRIX_BRIDGE_AUTO_CONNECT = v;
      expect(shouldAutoConnect()).toBe(true);
    }
  });

  it('shouldAutoConnect is false for other values', async () => {
    const { shouldAutoConnect } = await importConfig();
    for (const v of ['0', 'false', 'off', 'nope']) {
      process.env.PI_MATRIX_BRIDGE_AUTO_CONNECT = v;
      expect(shouldAutoConnect()).toBe(false);
    }
  });
});
