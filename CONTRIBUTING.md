# Contributing to pi-matrix-bridge

Thank you for your interest in contributing! 🎉

This is a Matrix-only fork of [tintinweb/pi-messenger-bridge](https://github.com/tintinweb/pi-messenger-bridge).

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/rolznz/pi-matrix-bridge.git
   cd pi-matrix-bridge
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Test locally**
   ```bash
   # Matrix credentials (or configure via /matrix-bridge configure matrix ...)
   export PI_MATRIX_BRIDGE_HOMESERVER="https://matrix.org"
   export PI_MATRIX_BRIDGE_ACCESS_TOKEN="syt_..."
   # Connect on startup (defaults off)
   export PI_MATRIX_BRIDGE_AUTO_CONNECT=1

   # Option A: Install in pi
   pi install /path/to/pi-matrix-bridge
   pi
   /matrix-bridge connect

   # Option B: Load directly from source (faster for development)
   pi -e ./src/index.ts
   /matrix-bridge connect
   ```

## Project Structure

```
src/
├── index.ts                 # Entry point: event handlers, /matrix-bridge command, streaming
├── config.ts                # Config load/save + env-var helpers
├── formatting.ts            # Message/thinking/tool formatting helpers
├── lock.ts                  # Single-instance connection guard
├── types.ts                 # TypeScript interfaces
├── auth/
│   └── challenge-auth.ts     # Challenge-code auth + DM admin commands
├── transports/
│   ├── interface.ts          # ITransportProvider interface
│   ├── manager.ts            # Transport registry + routing
│   ├── matrix.ts             # Matrix provider (matrix-bot-sdk)
│   └── matrix-utils.ts       # Pure, testable Matrix helpers
└── ui/
    ├── main-menu.ts          # Interactive /matrix-bridge menu
    └── status-widget.ts      # Status widget
```

This fork is **Matrix-only**. The `ITransportProvider` abstraction remains, but
keeping the surface small (one transport) is a goal — please discuss in an issue
before adding another transport.

## Code Style

- TypeScript strict mode; lint/format with Biome (`npm run lint` / `npm run lint:fix`).
- Follow existing naming conventions and keep functions focused and testable.
- Add JSDoc comments for public APIs.
- Prefer named functions over inline arrow callbacks.

## Testing

Run the checks before opening a PR:

```bash
npm run typecheck
npm run lint
npm run test
```

Pure logic lives in testable modules (`formatting.ts`, `matrix-utils.ts`,
`config.ts`, `lock.ts`) with [vitest](https://vitest.dev) tests under `tests/`.
Add tests alongside behavioral changes.

Manual checklist for end-to-end changes:
- [ ] Bot connects successfully
- [ ] Challenge codes appear in terminal and authentication works (and fails correctly)
- [ ] Messages are sent and received; group-chat mention detection works
- [ ] Thinking/response/tool-call streaming renders and `stop` interrupts
- [ ] Admin commands work; widget shows correct status

## Pull Request Process

1. **Create a branch** for your feature (`git checkout -b feature/amazing-feature`)
2. **Make your changes** and commit (`git commit -m 'feat: amazing feature'`)
3. **Push** and **open a Pull Request** with: a clear description, why it's needed,
   any breaking changes, and testing performed.

## Commit Messages

Follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

Examples:
```
feat: stream tool output into the response message
fix: clear the typing indicator on stop
docs: document PI_MATRIX_BRIDGE_AUTO_CONNECT
```

## Reporting Issues

When reporting bugs, include: pi version, extension version, OS, steps to
reproduce, expected vs actual behavior, and any error messages.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
