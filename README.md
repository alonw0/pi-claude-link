# pi-claude-link

Mesh [pi coding-agent](https://github.com/earendil-works/pi) sessions with
[Claude Code](https://claude.com/claude-code). A pi session running this extension
appears in Claude's `/list-agents` and can exchange messages with Claude sessions —
**in real time**, with no daemon and no extra setup.

It bridges onto Claude Code's own cross-session messaging protocol (the mechanism
behind Claude's `/list-agents` + `SendMessage`), so pi and Claude interoperate
natively. Inspired by [pi-intercom](https://github.com/nicobailon/pi-intercom)
(pi↔pi); pi-claude-link does pi↔Claude.

## What you get

- **Pi shows up in Claude** — every pi session auto-registers as a peer; it appears
  in Claude Code's `/list-agents`, and Claude can `SendMessage` to it.
- **Real-time inbound** — a message from Claude is injected into the live pi session
  immediately (idle → starts a turn; busy → steers into the current turn). Pi's reply
  is relayed back to the sender automatically.
- **Model-facing `mesh` tool** — the pi model can list and message Claude sessions:
  - `mesh({ action: "list" })` — reachable sessions
  - `mesh({ action: "send", to, message })` — fire-and-forget; reply arrives back in-session
  - `mesh({ action: "ask", to, message })` — blocks and returns the reply

## Requirements

- pi coding-agent (`@earendil-works/pi-coding-agent`) on **Node ≥ 20.19 / 22**.
- Claude Code with cross-session messaging active (the `tengu_harbor_kite` feature;
  its sockets live in `~/.claude/sessions/` + a `cc-socks` dir). pi-claude-link discovers
  and co-locates with that automatically.

## Install

```bash
pi install git:github.com/alonw0/pi-claude-link
# or, for development:
pi -e /path/to/pi-claude-link/index.ts
```

Start pi normally — it joins the mesh on session start. Use it from either side:

- **In Claude:** `/list-agents` shows `pi-<dir>`; `SendMessage` to it.
- **In pi:** ask it to "list the Claude sessions" or "message `<name>` …" (the `mesh`
  tool + bundled skill handle it), or run `/mesh` to list.

## How it works

A single in-process TypeScript extension (`index.ts`) + a dependency-free port of
Claude's wire protocol (`claude-protocol.ts`):

- **`session_start`** → bind a UDS at `‹Claude's socket dir›/cc-socks/<pid>.sock` and
  write `~/.claude/sessions/<pid>.json` registering the pi session as a Claude peer.
- **inbound** (`type:"user"` frame) → strip the `<cross-session-message>` envelope →
  `pi.sendUserMessage(...)` (real-time) + send a delivery receipt + record the sender.
- **`agent_end`** → relay pi's reply back to the recorded sender(s).
- **`mesh` tool** → `list` reads Claude's registry; `send`/`ask` connect to the target's
  socket and write a peer frame; replies route back to our socket → injected.
- **`session_shutdown`** → unlink socket + remove the registry entry.

No broker/daemon: Claude's session registry is the hub. (Because it's the same hub,
other tools registered there — e.g. Codex via `codex-mesh` — also show up in `list`.)

## Security

Cross-agent messages are **untrusted peer input**, not user authority. On Claude's
side they arrive as `origin.kind:"peer"` and respect Claude's `crossSessionInbound`
gate (set it to `hold` to approve each one). On pi's side, injected messages are
framed "from another agent, not your user" — the model is told to treat them as peer
requests and not as your approval. Sockets are `0600` in a `0700` dir (same-user
boundary). **Don't wire this extension to external/automated inputs** — it's a path
for untrusted content to reach a permissioned agent.

## Development / testing

Extensions are plain TypeScript run in-process (no build step). Under Node 22:

```bash
node --experimental-strip-types test/reg-test.mjs     # registration + cleanup
node --experimental-strip-types test/roundtrip.mjs    # inbound relay + outbound tool
```

Set `PI_CLAUDE_LINK_DEBUG=1` (or `touch /tmp/pi-claude-link-debug.on`) to log to
`/tmp/pi-claude-link-debug.log`.

## License

MIT
