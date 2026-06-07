# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- **Live streaming.** Both the model's reasoning (💭) and its response stream
  into Matrix messages that are edited in place (throttled) as they grow, via the
  `message_update` event — so a remote user can read where a turn is heading and
  `stop`/steer before it commits. Each tool call (🔧) is shown the moment it
  starts running (via `tool_execution_start`) and its output (↳, truncated) is
  appended when it finishes (via `tool_execution_end`), paired by tool-call id.
  Thinking is on by default (toggle with
  `/togglethinking` or `/msg-bridge togglethinking`, or `"hideThinking": true`);
  the response always streams. Adds `editMessage` to the transport interface
  (Matrix `m.replace` edits) and makes `sendMessage` return the message id.
- **`/shutdown` admin command** (trusted users, DM only). Stops pi; under a
  systemd unit with `Restart=always` this relaunches into a fresh session.
- **`stop` reserved word** (any authorized user) — interrupts the current turn
  via `ctx.abort()`. Accepts `stop`, `/stop`, or `!stop`.
- **`/session` admin command** — read-only session info (model, context usage,
  thinking level, entry count, idle status).
- Admin commands now accept either a `/` or `!` prefix (e.g. `/help` or `!help`).
- `scripts/install-systemd.sh` — installs a `systemd --user` unit for the
  headless/always-on deployment (sets `PI_MATRIX_BRIDGE_AUTO_CONNECT=1`,
  `Restart=always`, enables lingering). Documented in the README.

### Changed
- **Forked and renamed to `pi-matrix-bridge`.** This is a Matrix-only fork of
  [tintinweb/pi-messenger-bridge](https://github.com/tintinweb/pi-messenger-bridge) (MIT).
- Unified all env vars under the `PI_MATRIX_BRIDGE_` prefix (e.g. the Matrix creds
  `PI_MATRIX_HOMESERVER`/`PI_MATRIX_ACCESS_TOKEN` →
  `PI_MATRIX_BRIDGE_HOMESERVER`/`PI_MATRIX_BRIDGE_ACCESS_TOKEN`).
- **Activation is now a single switch: `PI_MATRIX_BRIDGE_AUTO_CONNECT`, defaulting
  OFF.** The plugin doesn't connect on startup unless it's set to `1` — so a
  desktop pi with the plugin installed stays dormant (no connection, no widget,
  no notices) while a headless instance sets the var to own the bot. Connect a
  dormant instance on demand with `/msg-bridge connect`.
- `autoConnect` moved out of persisted config to that env var; `/msg-bridge
  connect`/`disconnect` no longer write a persisted preference.
- The status widget now renders only when a transport is actually connected.

### Removed
- Dropped the unused `debug` option — the `config.debug` field and the
  `MSG_BRIDGE_DEBUG`/`PI_MATRIX_BRIDGE_DEBUG` env var were vestigial after the
  non-Matrix transports were removed (nothing read them).
- Removed the Telegram, WhatsApp, Slack, and Discord transports and their dependencies
  (`node-telegram-bot-api`, `@whiskeysockets/baileys`, `@slack/bolt`, `discord.js`,
  `qrcode-terminal`). Only the Matrix transport (`matrix-bot-sdk`) remains.

## [0.4.0] - 2026-05-09

### Added
- Matrix transport via `matrix-bot-sdk` — works with Element X, Element Web, FluffyChat, any Matrix client. Auto-joins rooms, group chat support with mention detection, optional E2EE (Rust SDK crypto store). Set `"encryption": false` in the `matrix` config to disable E2EE (thanks @jchidley)
- `hideToolCalls` config option, `/msg-bridge toggletools` pi command, and matching `/toggletools` DM admin command — trusted users can hide/show tool call summaries in their replies from either side
- Empty-message guard in all transports (Discord, Telegram, Slack, WhatsApp, Matrix) to prevent provider errors on whitespace-only payloads

### Changed
- Tool call summaries now wrap the tool name in inline-code backticks (`🔧 \`hud_canvas\` (...)`), rendering as code across all 5 transports and avoiding Telegram's underscore-escape backslashes leaking into messages
- Migrated peer dependencies from deprecated `@mariozechner/pi-{ai,coding-agent,tui}` to `@earendil-works/pi-{ai,coding-agent,tui}` (>=0.74). The `@mariozechner` packages were deprecated upstream with the message "please use @earendil-works/pi-coding-agent instead going forward"
- Tightened peer constraints from `*` to `>=0.74` and removed the duplicated entries from devDependencies (npm auto-installs peers in dev)
- Bumped devDependency floors: `@biomejs/biome` ^2.4.14, `@types/node` ^25.6.2, `typescript` ^6.0.3, `vitest` ^4.1.5

### Fixed
- `sendUserMessage` crash when a remote message arrives mid-turn — messages are now queued via `{ deliverAs: "followUp" }` so each remote message gets its own turn after the current one finishes, instead of being interleaved into it (fixes #10)
- `pendingRemoteChat` no longer cleared on tool-call-only turns, so the next response reaches the right chat
- Whitespace-only assistant responses no longer trigger Discord's "Cannot send an empty message" error
- Telegram MarkdownV1 parse errors on stray special chars (e.g. snake_case tool names like `hud_canvas` triggering `400 Bad Request: can't parse entities`). `formatForTelegram` now lifts valid markdown patterns into sentinel placeholders, escapes literal `_*[\``, then restores

## [0.3.0] - 2026-03-25

### Added
- Interactive menu (`/msg-bridge` with no args) — configure, connect, widget, help via `ui.select()`
- Single-instance connection guard to prevent duplicate polling / 409 conflicts (fixes #2)
  - Layer 1: global flag for same-process re-entrant calls (sub-agents)
  - Layer 2: PID lock file (`~/.pi/msg-bridge.lock`) for cross-process duplicates
- Session shutdown handler — releases lock and disconnects transports on exit
- Lock check on `/msg-bridge configure` connect calls to prevent bypassing the guard
- Test suite (vitest): config, lock, and formatting modules
- CI workflow (GitHub Actions: lint + typecheck + test)
- Biome linter configuration

### Fixed
- Discord DM messages not received — added required `Partials.Channel` and `Partials.Message` to client options (fixes #5, thanks @chr15m)
- Transport errors now show clean messages instead of full stack traces

### Changed
- Extracted `config.ts`, `lock.ts`, `formatting.ts`, `ui/main-menu.ts` from index.ts
- Moved `@mariozechner/pi-*` packages to peerDependencies
- Updated devDependencies: typescript ^6.0.2, @types/node ^25.3.0, @biomejs/biome ^2.4.8, vitest ^4.1.1
- `prepublishOnly` now runs lint and typecheck before build
- Applied `npm audit fix` for transitive dependency vulnerabilities

## [0.2.1] - 2026-02-11

### Changed
- Package renamed from `pi-msg-bridge` to `pi-messenger-bridge` for better clarity
- Updated all repository URLs and documentation to reflect new package name
- Command remains `/msg-bridge` for brevity and ease of use

## [0.2.0] - 2026-02-11

### Added
- WhatsApp integration via Baileys library with QR code authentication
- Slack integration with Socket Mode support
- Discord integration with Message Content intent support
- Debug mode for troubleshooting (config.debug or MSG_BRIDGE_DEBUG env var)
- Non-blocking async transport initialization for faster startup
- Widget toggle command (`/msg-bridge widget`)
- Help command with full command reference
- Automatic invalid session cleanup (WhatsApp 401 handling)
- Session detection to prevent QR spam on startup

### Changed
- Renamed from "remote-pilot" to "msg-bridge" throughout codebase
- Command changed from `/remote` to `/msg-bridge`
- Config file moved from `~/.pi/msg-bridge/config.json` to `~/.pi/msg-bridge.json`
- WhatsApp auth directory: `~/.pi/msg-bridge-whatsapp-auth/`
- All debug output now behind debug flag (no spam by default)
- Status widget only shows connected transports
- Environment variables now override config file settings

### Security
- Config file permissions enforced: chmod 600 for files, 700 for directories
- Config directory permissions validated on startup with warnings
- WhatsApp auth directory created with secure permissions (700)
- Invalid WhatsApp sessions automatically cleared on 401 errors

### Fixed
- QR code display for WhatsApp (using qrcode-terminal instead of Baileys built-in)
- Tool call formatting now shows actual parameters instead of speculation
- Username extraction from WhatsApp messages
- Connection state tracking for accurate widget display
- Startup performance (transports load in background)

### Dependencies
- Added: @whiskeysockets/baileys, qrcode-terminal, @slack/bolt, discord.js
- Known vulnerabilities in transitive dependencies (node-telegram-bot-api, discord.js) - low impact for this use case

## [0.1.0] - 2026-02-10

### Added
- Initial MVP release
- Event-driven architecture using `pi.sendUserMessage()` and `turn_end` events
- Telegram bot integration with polling support
- Challenge-based authentication (6-digit codes)
- Trusted user management
- Admin commands for user and channel management
- Status widget showing connection status
- Commands: `/remote`, `/remote connect`, `/remote disconnect`, `/remote configure`
- Environment variable and file-based configuration
- Support for group chats with mention detection
- Channel authorization modes: all, mentions, trusted-only

### Security
- 6-digit challenge codes with 2-minute expiry
- 3-attempt limit with 5-minute blocking
- First authenticated user becomes admin
- Trusted user validation on all messages

[unreleased]: https://github.com/tintinweb/pi-messenger-bridge/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/tintinweb/pi-messenger-bridge/releases/tag/v0.4.0
[0.1.0]: https://github.com/tintinweb/pi-messenger-bridge/releases/tag/v0.1.0
