/**
 * main-menu.ts — Interactive main menu for /msg-bridge.
 *
 * Shows transport status in the title, with Connect, Configure, Widget, and Help.
 */

import type { ChallengeAuth } from "../auth/challenge-auth.js";
import { loadConfig, saveConfig } from "../config.js";
import { acquireLock, releaseLock } from "../lock.js";
import type { TransportManager } from "../transports/manager.js";
import { MatrixProvider } from "../transports/matrix.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type MenuUI = {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  notify(message: string, type: "info" | "warning" | "error"): void;
};

export interface MenuContext {
  ui: MenuUI;
  transportManager: TransportManager;
  auth: ChallengeAuth;
  updateWidget: () => void;
}

// ── Status ──────────────────────────────────────────────────────────────────

function getStatusLine(mctx: MenuContext): string {
  const status = mctx.transportManager.getStatus();
  const stats = mctx.auth.getStats();

  if (status.length === 0) {
    return "No transports configured";
  }

  const transportLines = status
    .map((s) => `  ${s.connected ? "●" : "○"} ${s.type}`)
    .join("\n");

  return `${transportLines}\n  Trusted users: ${stats.trustedUsers}`;
}

// ── Help ────────────────────────────────────────────────────────────────────

function showHelp(mctx: MenuContext): void {
  mctx.ui.notify(
    "Subcommands:\n" +
    "  /msg-bridge status                — show connection status\n" +
    "  /msg-bridge connect               — connect all transports\n" +
    "  /msg-bridge disconnect            — disconnect all transports\n" +
    "  /msg-bridge configure <platform>  — set up a transport\n" +
    "  /msg-bridge widget                — toggle status widget",
    "info",
  );
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function doConnect(mctx: MenuContext): Promise<void> {
  if (!acquireLock()) {
    mctx.ui.notify("⚠️ Another instance is already connected.", "warning");
    return;
  }
  try {
    await mctx.transportManager.connectAll();
    const cfg = loadConfig();
    cfg.autoConnect = true;
    saveConfig(cfg);
    mctx.ui.notify("✅ Connected to all configured transports", "info");
    mctx.updateWidget();
  } catch (err) {
    releaseLock();
    mctx.ui.notify(`❌ Connection failed: ${(err as Error).message}`, "error");
  }
}

async function doDisconnect(mctx: MenuContext): Promise<void> {
  await mctx.transportManager.disconnectAll();
  releaseLock();
  const cfg = loadConfig();
  cfg.autoConnect = false;
  saveConfig(cfg);
  mctx.ui.notify("🔌 Disconnected from all transports", "info");
  mctx.updateWidget();
}

async function doConfigure(mctx: MenuContext): Promise<void> {
  const config = loadConfig();

  const homeserverUrl = await mctx.ui.input("Matrix homeserver URL (e.g. https://matrix.org)");
  if (!homeserverUrl) return;
  const accessToken = await mctx.ui.input("Matrix access token");
  if (!accessToken) return;
  config.matrix = { homeserverUrl, accessToken };
  saveConfig(config);
  const provider = new MatrixProvider(config.matrix, mctx.auth);
  mctx.transportManager.addTransport(provider);
  if (acquireLock()) {
    try {
      await provider.connect();
      mctx.ui.notify("✅ Matrix configured and connected", "info");
    } catch (err) {
      releaseLock();
      mctx.ui.notify(`⚠️ Matrix setup error: ${(err as Error).message}`, "error");
    }
  } else {
    mctx.ui.notify("✅ Matrix configured (another instance is connected — run /msg-bridge connect later)", "info");
  }
  mctx.updateWidget();
}

function doToggleWidget(mctx: MenuContext): void {
  const cfg = loadConfig();
  cfg.showWidget = cfg.showWidget === false;
  saveConfig(cfg);
  const state = cfg.showWidget !== false ? "shown" : "hidden";
  mctx.ui.notify(`📊 Status widget ${state}`, "info");
  mctx.updateWidget();
}

// ── Main menu ───────────────────────────────────────────────────────────────

export async function openMainMenu(mctx: MenuContext): Promise<void> {
  const mainMenu = async (): Promise<void> => {
    const statusLine = getStatusLine(mctx);
    const title = `Message Bridge\n${statusLine}`;

    const anyConnected = mctx.transportManager.getStatus().some((s) => s.connected);

    const choices = [
      anyConnected ? "Disconnect" : "Connect",
      "Configure",
      "Widget",
      "Help",
    ];

    const choice = await mctx.ui.select(title, choices);
    if (!choice) return;

    switch (choice) {
      case "Connect":
        await doConnect(mctx);
        break;
      case "Disconnect":
        await doDisconnect(mctx);
        break;
      case "Configure":
        await doConfigure(mctx);
        break;
      case "Widget":
        doToggleWidget(mctx);
        break;
      case "Help":
        showHelp(mctx);
        break;
    }
    return mainMenu();
  };
  await mainMenu();
}
