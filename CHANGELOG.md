# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-08-08

Initial release.

### Added
- Pi sessions auto-register as peers in Claude Code's registry and appear in
  `/list-agents` (on `session_start`; cleaned up on `session_shutdown`).
- Real-time inbound: messages from Claude are injected into the live pi session via
  `pi.sendUserMessage` (idle → new turn; busy → steer), with delivery receipts.
- Reply relay: pi's answer is sent back to the originating Claude session on `agent_end`.
- Model-facing `claude-link` tool with `list` / `send` / `ask` (blocking) actions,
  a `/claude-link` command, and a bundled skill.
- Sender display names resolved from Claude's registry to match `/list-agents`.
- Dependency-free `claude-protocol.ts` port of Claude's cross-session wire protocol.

[0.1.0]: https://github.com/alonw0/pi-claude-link/releases/tag/v0.1.0
