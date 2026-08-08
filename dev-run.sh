#!/usr/bin/env bash
# Launch pi with pi-claude-link loaded, under a Node that pi supports (>= 20.19 / 22).
# Local dev trial — does not modify ~/.pi. Run in any repo dir:  ./dev-run.sh
set -euo pipefail
NODE="${PI_CLAUDE_LINK_NODE:-$HOME/.nvm/versions/node/v22.16.0/bin/node}"
PI_CLI="${PI_CLI:-$HOME/.nvm/versions/node/v20.13.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js}"
EXT="$(cd "$(dirname "$0")" && pwd)/index.ts"
exec "$NODE" "$PI_CLI" -e "$EXT" "$@"
