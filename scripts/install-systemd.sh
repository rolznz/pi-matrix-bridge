#!/usr/bin/env bash
#
# install-systemd.sh — install a systemd --user service that runs pi headless as
# an always-on Matrix bridge.
#
# Pairs with the `/shutdown` admin command: with Restart=always, a `/shutdown`
# from Matrix stops pi, systemd relaunches it, and (with no --continue/--resume)
# pi comes back in a brand-new session. The restart *is* the "new session".
#
# Usage:
#   scripts/install-systemd.sh [--name NAME] [--workdir DIR] [--pi PATH] [--uninstall]
#
# Options (all optional — sensible defaults shown):
#   --name NAME      systemd unit name           (default: pi-matrix-bridge)
#   --workdir DIR    agent working directory      (REQUIRED — prompted if omitted)
#   --pi PATH        path to the pi binary        (default: `command -v pi`)
#   --uninstall      stop, disable, and remove the unit
#
# Env vars passed through to the service (only if set in your shell at install
# time): PI_MATRIX_BRIDGE_HOMESERVER, PI_MATRIX_BRIDGE_ACCESS_TOKEN. If unset, pi reads its
# config from ~/.pi/matrix-bridge.json as usual.

set -euo pipefail

NAME="pi-matrix-bridge"
WORKDIR=""   # required — set via --workdir, or prompted below
PI_BIN=""
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)      NAME="$2"; shift 2 ;;
    --workdir)   WORKDIR="$2"; shift 2 ;;
    --pi)        PI_BIN="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_PATH="${UNIT_DIR}/${NAME}.service"

if [[ "${UNINSTALL}" == "1" ]]; then
  echo "Uninstalling ${NAME}…"
  systemctl --user disable --now "${NAME}.service" 2>/dev/null || true
  rm -f "${UNIT_PATH}"
  systemctl --user daemon-reload
  echo "Removed ${UNIT_PATH}"
  exit 0
fi

# Resolve the working directory (the dir the agent's tools operate in — NOT the
# ~/.pi config). Required: prompt when not given via --workdir, and error out if
# still empty (e.g. no TTY, or the prompt was left blank).
if [[ -z "${WORKDIR}" && -t 0 ]]; then
  read -r -p "Agent working directory (required): " WORKDIR
fi
# Expand a leading ~ since read does not do tilde expansion.
WORKDIR="${WORKDIR/#\~/${HOME}}"
if [[ -z "${WORKDIR}" ]]; then
  echo "error: a working directory is required. Pass --workdir DIR (or enter one when prompted)." >&2
  exit 1
fi

# Resolve the pi binary.
if [[ -z "${PI_BIN}" ]]; then
  PI_BIN="$(command -v pi || true)"
fi
if [[ -z "${PI_BIN}" ]]; then
  echo "error: could not find the 'pi' binary on PATH. Pass --pi /path/to/pi." >&2
  exit 1
fi

mkdir -p "${UNIT_DIR}" "${WORKDIR}"

# PI_MATRIX_BRIDGE_AUTO_CONNECT=1 makes this headless instance connect on startup.
# It defaults off, so a desktop pi with the plugin installed stays dormant (no
# connection, no noise). Pass Matrix creds through too, only if set in the shell.
ENV_LINES=$'\n'"Environment=PI_MATRIX_BRIDGE_AUTO_CONNECT=1"
if [[ -n "${PI_MATRIX_BRIDGE_HOMESERVER:-}" ]]; then
  ENV_LINES+=$'\n'"Environment=PI_MATRIX_BRIDGE_HOMESERVER=${PI_MATRIX_BRIDGE_HOMESERVER}"
fi
if [[ -n "${PI_MATRIX_BRIDGE_ACCESS_TOKEN:-}" ]]; then
  ENV_LINES+=$'\n'"Environment=PI_MATRIX_BRIDGE_ACCESS_TOKEN=${PI_MATRIX_BRIDGE_ACCESS_TOKEN}"
fi

cat > "${UNIT_PATH}" <<UNIT
[Unit]
Description=pi Matrix bridge (${NAME})
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${WORKDIR}${ENV_LINES}
ExecStart=${PI_BIN}
# Restart even on a clean exit (code 0), so /shutdown -> ctx.shutdown() relaunches.
Restart=always
RestartSec=2
# Keep repeated /shutdown restarts from tripping the rate-limiter and stopping the unit.
StartLimitIntervalSec=0

[Install]
WantedBy=default.target
UNIT

echo "Wrote ${UNIT_PATH}"

# Allow the service to run without an active login session (headless / on boot).
if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$(id -un)" 2>/dev/null \
    && echo "Enabled lingering for $(id -un) (service runs without an active login)." \
    || echo "note: could not enable lingering (may need: sudo loginctl enable-linger $(id -un))."
fi

systemctl --user daemon-reload
systemctl --user enable --now "${NAME}.service"

echo
echo "✅ ${NAME} installed and started."
echo "   Status:  systemctl --user status ${NAME}"
echo "   Logs:    journalctl --user -u ${NAME} -f"
echo "   Stop:    systemctl --user stop ${NAME}"
echo "   Remove:  scripts/install-systemd.sh --uninstall --name ${NAME}"
