import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MatrixBridgeConfig } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".pi");
const CONFIG_PATH = path.join(CONFIG_DIR, "matrix-bridge.json");

/**
 * Load config from file and env vars (env vars override file).
 */
export function loadConfig(): MatrixBridgeConfig {
  const config: MatrixBridgeConfig = {};

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const stats = fs.statSync(CONFIG_PATH);
      const mode = stats.mode & 0o777;
      if ((mode & 0o077) !== 0) {
        console.warn(`⚠️  Config file ${CONFIG_PATH} has insecure permissions (${mode.toString(8)}). Should be 0600.`);
      }

      const fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      Object.assign(config, fileConfig);
    } catch (err) {
      console.error("Failed to load config file:", err);
    }
  }

  // Environment variables override file config (higher priority)
  if (process.env.PI_MATRIX_BRIDGE_HOMESERVER && process.env.PI_MATRIX_BRIDGE_ACCESS_TOKEN) {
    config.matrix = {
      homeserverUrl: process.env.PI_MATRIX_BRIDGE_HOMESERVER,
      accessToken: process.env.PI_MATRIX_BRIDGE_ACCESS_TOKEN,
    };
  }

  return config;
}

/**
 * Whether to connect transports on startup. Controlled by the
 * PI_MATRIX_BRIDGE_AUTO_CONNECT env var (not persisted config). Defaults to
 * OFF — the plugin stays dormant unless this is set to "1"/"true"/"yes". The
 * headless systemd unit sets it; a desktop pi with the plugin installed makes
 * no connection on startup (and can still connect manually with
 * /matrix-bridge connect).
 */
export function shouldAutoConnect(): boolean {
  const v = process.env.PI_MATRIX_BRIDGE_AUTO_CONNECT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Save config to file with secure permissions.
 */
export function saveConfig(config: MatrixBridgeConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch (err) {
    console.warn("Failed to set directory permissions:", err);
  }
}
