import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ChallengeAuth } from "./auth/challenge-auth.js";
import { loadConfig, saveConfig, shouldAutoConnect } from "./config.js";
import { extractTextFromMessage, extractThinkingFromMessage, formatToolCall, formatToolResult, hasToolCalls, splitMessage } from "./formatting.js";
import { acquireLock, releaseLock } from "./lock.js";
import { TransportManager } from "./transports/manager.js";
import { MatrixProvider } from "./transports/matrix.js";
import type { PendingRemoteChat, TransportStatus } from "./types.js";
import { openMainMenu } from "./ui/main-menu.js";
import { createStatusWidget } from "./ui/status-widget.js";

/** Min interval between in-place edits of a live streamed message. */
const STREAM_EDIT_THROTTLE_MS = 900;

/** Tracks one edit-in-place streamed message (thinking or response) for a turn. */
interface StreamState {
  msgId: string | null;
  lastText: string;
  lastEditAt: number;
}

/**
 * pi-matrix-bridge extension
 * Bridges Matrix into pi.
 */
export default function (pi: ExtensionAPI): void {
  const transportManager = new TransportManager();
  let pendingRemoteChat: PendingRemoteChat | null = null;
  let auth: ChallengeAuth;
  let ctx: ExtensionContext;

  // Live streaming state — thinking and the response each get one message that's
  // edited in place as tokens arrive, so the user can read along and steer/stop.
  const thinkingStream: StreamState = { msgId: null, lastText: "", lastEditAt: 0 };
  const responseStream: StreamState = { msgId: null, lastText: "", lastEditAt: 0 };
  let streamEditInFlight = false;
  let turnShowThinking = false;
  // The response message renders the streamed text plus per-tool blocks. Each
  // block shows the call the moment the tool starts running (some take seconds),
  // then gets its output appended when the tool finishes. Keyed by toolCallId so
  // parallel tools pair correctly.
  let streamedText = "";
  let toolEntries: { id: string; text: string }[] = [];
  let turnShowTools = false;

  /**
   * Update status widget
   */
  function updateWidget(): void {
    const config = loadConfig();

    if (config.showWidget === false) {
      ctx.ui.setWidget("matrix-bridge-status", undefined);
      return;
    }

    const stats = auth.getStats();
    const transports: TransportStatus[] = transportManager
      .getStatus()
      .map((s) => ({
        type: s.type,
        connected: s.connected,
      }));

    const widget = createStatusWidget(transports, stats.usersByTransport);
    if (widget) {
      ctx.ui.setWidget("matrix-bridge-status", [widget]);
    } else {
      ctx.ui.setWidget("matrix-bridge-status", undefined);
    }
  }

  /**
   * Build the read-only summary shown by the `/session` admin command.
   * Everything here is on the base ExtensionContext (plus pi.getThinkingLevel).
   */
  function formatSessionInfo(): string {
    const sm = ctx.sessionManager;
    const usage = ctx.getContextUsage();

    const lines = [
      "━━━ Session ━━━",
      `Model: ${ctx.model?.name ?? "unknown"}`,
      `Thinking: ${pi.getThinkingLevel()}`,
    ];

    if (usage) {
      const tokens = usage.tokens != null ? usage.tokens.toLocaleString() : "?";
      const window = usage.contextWindow.toLocaleString();
      const pct = usage.percent != null ? ` (${usage.percent.toFixed(0)}%)` : "";
      lines.push(`Context: ${tokens} / ${window}${pct}`);
    }

    lines.push(`Entries: ${sm.getEntries().length}`);
    const name = sm.getSessionName();
    if (name) lines.push(`Name: ${name}`);
    lines.push(`Status: ${ctx.isIdle() ? "idle" : "working"}`);

    return lines.join("\n");
  }

  /**
   * /shutdown — the ack reply is already sent; gracefully stop pi. Under a
   * systemd unit with Restart=always this relaunches into a fresh session.
   */
  function handleShutdown(): void {
    ctx.shutdown();
  }

  /**
   * Save auth state to config
   */
  function saveAuthState(): void {
    const config = loadConfig();
    config.auth = auth.exportConfig();
    saveConfig(config);
  }

  /**
   * Send or edit-in-place a streamed message, throttling edits. The first push
   * sends immediately; later pushes for the same stream edit the same message.
   */
  async function pushStream(
    chat: PendingRemoteChat,
    state: StreamState,
    text: string,
    force = false
  ): Promise<void> {
    if (!text || text === state.lastText) return;
    const now = Date.now();
    if (!force && state.msgId && now - state.lastEditAt < STREAM_EDIT_THROTTLE_MS) return;

    if (!state.msgId) {
      state.msgId = await transportManager.sendMessage(chat.chatId, chat.transport, text);
    } else {
      await transportManager.editMessage(chat.chatId, chat.transport, state.msgId, text);
    }
    state.lastText = text;
    state.lastEditAt = now;
  }

  /**
   * Render the response message: the streamed text plus each tool's call line
   * (and its output once it finishes), in start order.
   */
  function renderResponse(): string {
    const parts: string[] = [];
    if (streamedText) parts.push(streamedText);
    if (toolEntries.length) parts.push(toolEntries.map((e) => e.text).join("\n"));
    return parts.join("\n\n");
  }

  /**
   * Push the current response render to its message. `force` bypasses the edit
   * throttle (used when a tool starts/finishes, so it appears immediately).
   */
  async function pushResponse(chat: PendingRemoteChat, force = false): Promise<void> {
    await pushStream(chat, responseStream, renderResponse(), force);
  }

  /**
   * Force the response message to re-render immediately, guarded against
   * overlapping edits. Used by tool start/end events. If a render is already in
   * flight the new state is still captured in toolEntries and shown by the next
   * render (or turn_end), so nothing is lost.
   */
  async function flushResponse(): Promise<void> {
    if (!pendingRemoteChat || streamEditInFlight) return;
    const chat = pendingRemoteChat;
    streamEditInFlight = true;
    try {
      await pushResponse(chat, true);
      transportManager.sendTyping(chat.chatId, chat.transport).catch(() => {});
    } catch (_err) {
      // best-effort
    } finally {
      streamEditInFlight = false;
    }
  }

  /**
   * Initialize extension
   */
  pi.on("session_start", async (_event, context) => {
    ctx = context;

    const config = loadConfig();

    auth = new ChallengeAuth(
      (code, username) => {
        ctx.ui.notify(
          `🔐 Challenge code for @${username}: ${code}`,
          "info"
        );
      },
      (message, level) => {
        ctx.ui.notify(message, level);
      },
      async (_chatId, _message) => {
        // Challenge notifications are sent via the transport's sendMessage
      },
      saveAuthState,
      handleShutdown,
      formatSessionInfo,
    );

    if (config.auth) {
      auth.loadFromConfig(config.auth);
    }

    // Initialize the Matrix transport in the background (non-blocking)
    (async () => {
      if (config.matrix?.homeserverUrl && config.matrix?.accessToken) {
        const matrixProvider = new MatrixProvider(config.matrix, auth);
        transportManager.addTransport(matrixProvider);
      }

      // Auto-connect if configured
      const transports = transportManager.getAllTransports();
      if (transports.length > 0 && shouldAutoConnect()) {
        if (!acquireLock()) {
          ctx.ui.notify("ℹ️ matrix-bridge: another instance is already connected — skipping auto-connect", "info");
        } else {
          try {
            await transportManager.connectAll();
            updateWidget();
          } catch (err) {
            releaseLock();
            ctx.ui.notify(`⚠️ Some transports failed to connect: ${(err as Error).message}`, "warning");
          }
        }
      }
    })().catch(err => {
      ctx.ui.notify(`❌ Transport initialization failed: ${err.message}`, "error");
    });

    transportManager.onMessage((msg) => {
      // "stop" interrupts the current turn. Accept a bare word or a / or !
      // prefix ("stop", "/stop", "!stop"). It's a reserved word for any
      // authorized user (onMessage only fires post-auth) and is not forwarded
      // to the agent.
      const stripped = msg.content.trim().replace(/^[/!]/, "").toLowerCase();
      if (stripped === "stop") {
        if (!ctx.isIdle()) ctx.abort();
        // Clear the typing indicator left over from the interrupted turn so the
        // client stops showing the "thinking" animation immediately.
        transportManager.stopTyping(msg.chatId, msg.transport).catch(() => {});
        transportManager
          .sendMessage(msg.chatId, msg.transport, "⏹️ Stopped the current turn.")
          .catch((err) =>
            ctx.ui.notify(`Failed to send stop ack: ${(err as Error).message}`, "error")
          );
        return;
      }

      pendingRemoteChat = {
        chatId: msg.chatId,
        transport: msg.transport,
        username: msg.username,
        messageId: msg.messageId,
      };

      const taggedMessage = `[📱 @${msg.username} via ${msg.transport}]: ${msg.content}`;
      // Only queue as a follow-up when the agent is mid-turn — that's the case
      // `followUp` was added for (avoiding a crash on a message arriving during
      // a turn, fixes #10). When idle, send normally so the message triggers a
      // turn and renders immediately; otherwise the very first message can sit
      // in the queue without ever showing.
      pi.sendUserMessage(taggedMessage, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
    });

    transportManager.onError((err, transport) => {
      ctx.ui.notify(`❌ ${transport} error: ${err.message}`, "error");
    });

    updateWidget();
  });

  /**
   * Handle turn start - send typing indicator
   */
  pi.on("turn_start", async (_event, _context) => {
    // Reset per-turn streaming state and cache the toggle for the hot path
    // (message_update fires per token — avoid a config file read each time).
    thinkingStream.msgId = null;
    thinkingStream.lastText = "";
    thinkingStream.lastEditAt = 0;
    responseStream.msgId = null;
    responseStream.lastText = "";
    responseStream.lastEditAt = 0;
    streamEditInFlight = false;
    streamedText = "";
    toolEntries = [];
    const cfg = loadConfig();
    turnShowThinking = cfg.hideThinking !== true;
    turnShowTools = cfg.hideToolCalls !== true;

    if (pendingRemoteChat) {
      try {
        await transportManager.sendTyping(
          pendingRemoteChat.chatId,
          pendingRemoteChat.transport
        );
      } catch (_err) {
        // Ignore typing indicator errors
      }
    }
  });

  /**
   * Stream live — edit a 💭 message as the reasoning grows and a separate
   * message as the response text grows, so the user can follow along and
   * steer/stop a wrong turn before it commits.
   */
  pi.on("message_update", async (event, _context) => {
    if (!pendingRemoteChat || streamEditInFlight) return;

    const message = event.message as AssistantMessage;
    if (!Array.isArray(message?.content)) return;

    const chat = pendingRemoteChat;
    streamEditInFlight = true;
    try {
      if (turnShowThinking) {
        const thinking = extractThinkingFromMessage(message);
        if (thinking) await pushStream(chat, thinkingStream, `💭 ${thinking}`);
      }

      streamedText = extractTextFromMessage(message).trim();
      await pushResponse(chat);

      // Keep the typing indicator alive alongside the streamed messages.
      if (thinkingStream.msgId || responseStream.msgId) {
        transportManager.sendTyping(chat.chatId, chat.transport).catch(() => {});
      }
    } catch (_err) {
      // Streaming is best-effort — ignore transient send/edit errors.
    } finally {
      streamEditInFlight = false;
    }
  });

  /**
   * Show each tool call the moment it starts running (some tools take seconds),
   * appended to the live response message.
   */
  pi.on("tool_execution_start", async (event, _context) => {
    if (!pendingRemoteChat || !turnShowTools) return;

    // Record first so it's never lost — turn_end renders from toolEntries even if
    // the live edit below is skipped (e.g. a render is mid-flight).
    toolEntries.push({ id: event.toolCallId, text: formatToolCall(event.toolName, event.args) });
    await flushResponse();
  });

  /**
   * Append each tool's output under its call line once it finishes.
   */
  pi.on("tool_execution_end", async (event, _context) => {
    if (!pendingRemoteChat || !turnShowTools) return;

    const entry = toolEntries.find((e) => e.id === event.toolCallId);
    if (!entry) return;
    const output = formatToolResult(event.result, event.isError);
    if (output) entry.text += `\n${output}`;
    await flushResponse();
  });

  /**
   * Handle turn end - send response back to messenger
   */
  pi.on("turn_end", async (event, _context) => {
    if (!pendingRemoteChat) return;
    const chat = pendingRemoteChat;

    try {
      const message = event.message as AssistantMessage;
      const hasPendingTools = hasToolCalls(message);
      const config = loadConfig();

      // Finalize the streamed thinking message — the last live edit may have
      // been throttled, so push the complete reasoning once the turn ends.
      if (!config.hideThinking && thinkingStream.msgId) {
        const finalThinking = `💭 ${extractThinkingFromMessage(message)}`;
        if (finalThinking !== thinkingStream.lastText) {
          await transportManager
            .editMessage(chat.chatId, chat.transport, thinkingStream.msgId, finalThinking)
            .catch(() => {});
        }
      }

      // Final response = streamed text plus the per-tool blocks (call + output)
      // accumulated from the tool execution events this turn.
      streamedText = extractTextFromMessage(message).trim();
      const fullText = renderResponse();

      if (!fullText) {
        // Nothing to send this turn (e.g. pure thinking, or hidden tool calls);
        // keep pendingRemoteChat so a future turn's response routes correctly.
        return;
      }

      if (responseStream.msgId) {
        // Finalize the streamed response message in place.
        if (fullText !== responseStream.lastText) {
          await transportManager.editMessage(
            chat.chatId,
            chat.transport,
            responseStream.msgId,
            fullText
          );
        }
      } else {
        // Nothing was streamed (e.g. a tool-only turn) — send it now, chunked.
        for (const chunk of splitMessage(fullText, 4000)) {
          await transportManager.sendMessage(chat.chatId, chat.transport, chunk);
        }
      }

      if (!hasPendingTools) {
        pendingRemoteChat = null;
      }
    } catch (err) {
      const transport = pendingRemoteChat?.transport ?? "unknown";
      ctx.ui.notify(
        `Failed to send response to ${transport}: ${(err as Error).message}`,
        "error"
      );
      pendingRemoteChat = null;
    }
  });

  /**
   * Cleanup on session exit — release lock and disconnect transports
   */
  pi.on("session_shutdown", async (_event, _context) => {
    await transportManager.disconnectAll();
    releaseLock();
  });

  /**
   * /matrix-bridge command - show status or manage connections
   */
  pi.registerCommand("matrix-bridge", {
    description: "Manage the Matrix bridge (help|status|connect|disconnect|configure|widget)",
    handler: async (args: string, context) => {
      const parts = args.trim().split(/\s+/).filter(p => p.length > 0);
      const subcommand = parts[0] || "";

    // No subcommand → open interactive menu
    if (!subcommand || subcommand === "menu") {
      await openMainMenu({
        ui: context.ui,
        transportManager,
        auth,
        updateWidget,
      });
      return;
    }

    switch (subcommand) {
      case "help": {
        const helpText = [
          "━━━ Matrix Bridge Commands ━━━",
          "",
          "/matrix-bridge                   Open interactive menu",
          "/matrix-bridge help              Show this help",
          "/matrix-bridge status            Show connection and user status",
          "/matrix-bridge connect           Connect to Matrix",
          "/matrix-bridge disconnect        Disconnect from Matrix",
          "/matrix-bridge configure matrix <homeserver-url> <access-token>",
          "                              Configure Matrix (Element X, etc)",
          "/matrix-bridge widget            Toggle status widget on/off",
          "/matrix-bridge toggletools       Toggle tool call visibility",
          "/matrix-bridge togglethinking    Toggle live thinking (💭) visibility",
          "",
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ];
        context.ui.notify(helpText.join("\n"), "info");
        break;
      }
      case "connect":
        if (!acquireLock()) {
          context.ui.notify("⚠️ Another matrix-bridge instance is already connected. Run /matrix-bridge disconnect there first.", "warning");
          break;
        }
        try {
          await transportManager.connectAll();
          context.ui.notify("✅ Connected to all configured transports", "info");
          updateWidget();
        } catch (err) {
          releaseLock();
          context.ui.notify(
            `❌ Connection failed: ${(err as Error).message}`,
            "error"
          );
        }
        break;

      case "disconnect": {
        await transportManager.disconnectAll();
        releaseLock();
        context.ui.notify("🔌 Disconnected from all transports", "info");
        updateWidget();
        break;
      }

      case "configure": {
        const platform = parts[1];
        const token = parts.slice(2).join(" ");

        if (!platform) {
          context.ui.notify("Usage: /matrix-bridge configure <platform> [token/path]", "error");
          return;
        }

        const config = loadConfig();

        switch (platform.toLowerCase()) {
          case "matrix": {
            const matrixParts = token.split(/\s+/);
            const homeserverUrl = matrixParts[0];
            const matrixAccessToken = matrixParts.slice(1).join(" ");
            if (!homeserverUrl || !matrixAccessToken) {
              context.ui.notify("Usage: /matrix-bridge configure matrix <homeserver-url> <access-token>", "error");
              return;
            }

            config.matrix = { homeserverUrl, accessToken: matrixAccessToken };
            saveConfig(config);
            const matrixProvider = new MatrixProvider(config.matrix, auth);
            transportManager.addTransport(matrixProvider);
            if (acquireLock()) {
              try {
                await matrixProvider.connect();
                context.ui.notify("✅ Matrix configured and connected", "info");
              } catch (err) {
                releaseLock();
                context.ui.notify(`⚠️ Matrix setup error: ${(err as Error).message}`, "error");
              }
            } else {
              context.ui.notify("✅ Matrix configured (another instance is connected — run /matrix-bridge connect later)", "info");
            }
            updateWidget();
            break;
          }

          default:
            context.ui.notify(`❌ Unknown platform: ${platform}`, "error");
        }
        break;
      }

      case "widget": {
        const cfg2 = loadConfig();
        cfg2.showWidget = cfg2.showWidget === false;
        saveConfig(cfg2);
        const widgetState = cfg2.showWidget !== false ? "shown" : "hidden";
        context.ui.notify(`📊 Status widget ${widgetState}`, "info");
        updateWidget();
        break;
      }

      case "status": {
        const stats = auth.getStats();
        const status = transportManager.getStatus();
        const lines = [
          "━━━ Matrix Bridge Status ━━━",
          "",
          "Transports:",
          ...status.map(
            (s) => `  ${s.connected ? "●" : "○"} ${s.type}`
          ),
          "",
          `Trusted Users: ${stats.trustedUsers}`,
        ];

        if (stats.trustedUsers > 0) {
          for (const [transport, userIds] of Object.entries(stats.usersByTransport)) {
            if (userIds.length > 0) {
              lines.push(`  └─ ${transport}: ${userIds.join(", ")}`);
            }
          }
        }

        lines.push("");
        lines.push(`Channels: ${stats.channels}`);
        lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        context.ui.notify(lines.join("\n"), "info");
        break;
      }

      case "toggletools": {
        const cfg3 = loadConfig();
        cfg3.hideToolCalls = !cfg3.hideToolCalls;
        saveConfig(cfg3);
        const toolState = cfg3.hideToolCalls ? "hidden" : "shown";
        context.ui.notify(`🔧 Tool calls ${toolState} in remote messages`, "info");
        break;
      }

      case "togglethinking": {
        const cfg4 = loadConfig();
        cfg4.hideThinking = !cfg4.hideThinking;
        saveConfig(cfg4);
        const thinkingState = cfg4.hideThinking ? "hidden" : "shown";
        context.ui.notify(`💭 Live thinking ${thinkingState} in remote messages`, "info");
        break;
      }
      default:
        context.ui.notify(`Unknown subcommand: ${subcommand}. Run /matrix-bridge help`, "warning");
        break;
    }
    },
  });
}
