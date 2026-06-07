# pi-matrix-bridge

Bridge [Matrix](https://matrix.org) into pi — talk to your pi coding agent from any Matrix client.

Remote users can interact with your pi coding agent via Element, FluffyChat, or any other Matrix app.

> Matrix-only fork of [tintinweb/pi-messenger-bridge](https://github.com/tintinweb/pi-messenger-bridge) (MIT). The original supports Telegram, WhatsApp, Slack, Discord, and Matrix; this fork keeps Matrix only.

## Features

- 💬 Matrix support (Element X, Element Web, FluffyChat, any homeserver)
- 🔐 Challenge-based authentication (6-digit codes)
- 🎛️ Interactive menu (`/msg-bridge`) for setup and management
- 🔒 Single-instance guard — prevents duplicate bot polling with sub-agents
- 📊 Live status widget (toggleable)
- 💾 Persistent config (auth state, auto-connect, widget preference)
- 🔧 Tool call visibility for remote users
- 💭 Live streaming — thinking and the response stream into editable messages so you can steer/stop mid-turn
- 📝 Multi-turn conversation support
- 🔑 Secure permissions (chmod 600 for config files, 700 for directories)

## Setup

### 1. Install

```bash
pi install npm:pi-matrix-bridge
```

### 2. Configure Matrix

Works with any Matrix homeserver — Element X, Element Web, FluffyChat, etc. The bot auto-joins rooms it's invited to.

1. Register a bot account on your homeserver (or reuse an existing user)
2. Get a **dedicated** access token by logging in via the API (see below)
3. Note your homeserver URL (e.g. `https://matrix.org`)

> **Generate a fresh token — don't reuse an existing one.** Reusing the access
> token from a client you're already signed into (e.g. Element Web's
> **Settings → Help & About → Advanced**) shares that client's device and crypto
> store, which causes E2EE key conflicts and decryption failures. Instead, log in
> via the API to mint a brand-new device + token just for the bridge:
>
> ```bash
> curl -XPOST 'https://matrix.org/_matrix/client/v3/login' \
>   -H 'Content-Type: application/json' \
>   -d '{
>     "type": "m.login.password",
>     "identifier": { "type": "m.id.user", "user": "your_username" },
>     "password": "YOUR_ACCOUNT_PASSWORD",
>     "initial_device_display_name": "pi-matrix-bridge"
>   }'
> ```
>
> Replace `your_username`, the password, and the homeserver URL. The JSON
> response contains `access_token` (use it below) and a fresh `device_id`. To
> revoke it later, log that device out from your Matrix client.

```bash
/msg-bridge configure matrix <homeserver-url> <access-token>
```

Or set via environment variables:
```bash
export PI_MATRIX_BRIDGE_HOMESERVER="https://matrix.org"
export PI_MATRIX_BRIDGE_ACCESS_TOKEN="syt_..."
```

E2EE is **on by default**. Verify the bot's device once from another Matrix client (Element, etc.) — until verified, encrypted rooms can't be decrypted in either direction.

Set `"encryption": false` in the `matrix` config to disable — useful for non-encrypted rooms only, or to bypass crypto-store/server desync (e.g. `M_UNKNOWN: One time key … already exists`). **Caveat:** with E2EE off, the homeserver sees plaintext, and the bot can't participate in encrypted rooms at all.

### 3. Connect

```bash
/msg-bridge connect
```

### 4. Authenticate Users

When a user messages your bot for the first time, they'll receive a 6-digit challenge code.
The code is displayed in your pi terminal. Share it with the user (e.g., via DM).

The user enters the code in the bot chat to become a trusted user.

## Commands

| Command | Description |
|---|---|
| `/msg-bridge` | Open interactive menu (configure, connect, widget, help) |
| `/msg-bridge status` | Show connection and user status |
| `/msg-bridge connect` | Connect to Matrix |
| `/msg-bridge disconnect` | Disconnect from Matrix |
| `/msg-bridge configure matrix <homeserver-url> <access-token>` | Set Matrix credentials via CLI |
| `/msg-bridge widget` | Toggle status widget on/off |
| `/msg-bridge toggletools` | Toggle tool call visibility in remote messages |
| `/msg-bridge togglethinking` | Toggle live thinking (💭) visibility |
| `/msg-bridge help` | Show command reference |

### Admin commands (in DM with the bot)

Trusted users can DM the bot directly to manage state. Reply with `/help` for the full list. Commands accept either a `/` or `!` prefix (e.g. `/help` or `!help`).

| Command | Description |
|---|---|
| `/help` | Show admin command reference |
| `/trusted` | List trusted users |
| `/revoke <userId>` | Revoke trust for a user |
| `/channels` | List enabled channels |
| `/enable <chatId> <all\|mentions\|trusted-only>` | Enable a channel |
| `/disable <chatId>` | Disable a channel |
| `/toggletools` | Toggle tool call visibility in replies |
| `/togglethinking` | Toggle live thinking (💭) visibility |
| `/session` | Show current session info (model, context usage, status) |
| `/shutdown` | Stop pi — under systemd this restarts into a fresh session ([see below](#headless-always-on-systemd)) |

Any authorized user (not just admins) can also send:

| Message | Description |
|---|---|
| `stop` | Interrupt the current turn. Also accepts `/stop` or `!stop`. |

## Live streaming

Both the model's **thinking** (💭) and its **response** stream into messages that are edited in place (token-by-token, throttled) as they're generated — so you can read where a turn is heading and `stop` (or steer) before it commits to a wrong action. Each **tool call** (🔧) appears the moment it starts running (handy for tools that take a few seconds), and its **output** (↳, truncated) is appended when it finishes. The typing indicator stays active alongside them.

Thinking is **on by default** — toggle with `/togglethinking` (DM admin) or `/msg-bridge togglethinking`, or set `"hideThinking": true` in the config. (The response always streams.)

## Configuration

Config is stored at `~/.pi/msg-bridge.json` with secure permissions (chmod 600).

Example config:
```json
{
  "matrix": { "homeserverUrl": "https://matrix.org", "accessToken": "syt_...", "encryption": true },
  "auth": {
    "trustedUsers": ["matrix:@alice:matrix.org"],
    "adminUserId": "matrix:@alice:matrix.org"
  },
  "showWidget": true
}
```

## Environment Variables

Environment variables override file config:

- `PI_MATRIX_BRIDGE_AUTO_CONNECT` — connect on startup. **Defaults to off** — set to `1` to activate the bridge. Left unset, the plugin stays dormant (no connection) and you can connect manually with `/msg-bridge connect`. See [Headless / always-on](#headless-always-on-systemd).
- `PI_MATRIX_BRIDGE_HOMESERVER` — Matrix homeserver URL (e.g. `https://matrix.org`)
- `PI_MATRIX_BRIDGE_ACCESS_TOKEN` — Matrix access token

## Security

- Config file: `~/.pi/msg-bridge.json` (chmod 600 - owner read/write only)
- Config directory: `~/.pi/` (chmod 700 - owner only)
- Environment variables take precedence over config file
- Challenge-based authentication for all new users
- Transport-namespaced user IDs prevent impersonation

## Architecture

Uses pi's native `sendUserMessage()` and `turn_end` events for two-way communication.
No tool-loop hacks needed — this is the pi-native way.

Single-instance connection guard prevents duplicate polling when sub-agents spawn
(global flag + PID lock file at `~/.pi/msg-bridge.lock`).

## Headless / always-on (systemd)

Run pi as a dedicated, always-on Matrix endpoint you can talk to from your phone — including starting a fresh conversation remotely.

### Activation

The plugin **does not connect on startup unless `PI_MATRIX_BRIDGE_AUTO_CONNECT=1`**. This lets a dedicated headless instance own the bot (it sets the env var) while a desktop pi with the same plugin installed stays dormant — no connection, no status widget, no notices. The desktop can still connect on demand with `/msg-bridge connect`.

### Install the service

The bundled installer writes a `systemd --user` unit, enables lingering (so it runs without an active login), and starts it:

```bash
./scripts/install-systemd.sh
```

Options: `--name` (unit name, default `pi-matrix-bridge`), `--workdir` (the agent's working directory — **required**; prompted if omitted), `--pi` (path to the `pi` binary), and `--uninstall`. If `PI_MATRIX_BRIDGE_HOMESERVER` / `PI_MATRIX_BRIDGE_ACCESS_TOKEN` are exported in your shell, they're baked into the unit; otherwise pi reads `~/.pi/msg-bridge.json`.

The generated unit sets `PI_MATRIX_BRIDGE_AUTO_CONNECT=1`, `Restart=always`, and `RestartSec=2`. Manage it with:

```bash
systemctl --user status pi-matrix-bridge
journalctl --user -u pi-matrix-bridge -f
```

### `/shutdown` = fresh session

pi runs headless in "print" mode, but the bridge's open sockets keep the process alive as a daemon. The `/shutdown` admin command stops that process; with `Restart=always`, systemd relaunches pi, and since there's no `--continue`/`--resume`, it comes back in a **brand-new session**. The restart *is* the new session — no PTY, no tmux, no hacks.

> **Note:** `/shutdown` resets the conversation for everyone and causes a few seconds of downtime. That's fine for a single-user mobile bridge. Without a supervisor, `/shutdown` simply stops pi — exactly what the name says.

## Development

```bash
npm install
npm run build        # compile TypeScript
npm run typecheck    # type-check without emitting
npm run test         # run tests
npm run lint         # biome lint
npm run lint:fix     # biome lint with auto-fix
```

## Credits

Forked from [tintinweb/pi-messenger-bridge](https://github.com/tintinweb/pi-messenger-bridge) by tintinweb and contributors (MIT). This fork strips it down to Matrix only.

## License

MIT — see [LICENSE](LICENSE).
