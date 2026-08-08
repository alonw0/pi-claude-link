# Contributing

Thanks for your interest! This is a small, dependency-free pi extension.

## Layout

- `index.ts` — the extension (default-exported `ExtensionAPI` factory).
- `claude-protocol.ts` — Claude Code's cross-session wire protocol (registry, sockets,
  envelope). The single place to update if Claude's protocol changes.
- `skills/pi-claude-link/SKILL.md` — teaches the pi model to use the `claude-link` tool.
- `test/` — end-to-end harnesses driving a real pi rpc session.

No build step: pi runs the TypeScript directly.

## Running the tests

Requires pi installed and a **Node ≥ 20.19** (pi crashes on older Node). If the `pi`
on your PATH runs on an older Node, point `PI_CMD` at a compatible one:

```bash
export PI_CMD="$HOME/.nvm/versions/node/v22.16.0/bin/node \
               $(npm root -g)/@earendil-works/pi-coding-agent/dist/cli.js"

node --experimental-strip-types test/reg-test.mjs     # registration + cleanup
node --experimental-strip-types test/roundtrip.mjs    # inbound relay + outbound tool
```

The harnesses only use throwaway sessions/listeners — they never message your real
sessions. Set `PI_CLAUDE_LINK_DEBUG=1` (or `touch /tmp/pi-claude-link-debug.on`) for
logs at `/tmp/pi-claude-link-debug.log`.

## Guidelines

- Keep `claude-protocol.ts` free of pi/agent imports (Node built-ins only) so it stays
  portable and testable.
- Prefer small, verifiable changes; run both harnesses before opening a PR.
- Be mindful of the security model (see `SECURITY.md`) — don't add paths that let
  untrusted/automated input reach an agent unprompted.

By contributing you agree your contributions are licensed under the MIT License.
