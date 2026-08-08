#!/usr/bin/env bash
# Launch pi with pi-claude-link loaded, for interactive testing.
#
# Requires pi on a supported Node (>= 20.19). If your `pi` runs on an older Node
# and crashes with the undici "markAsUncloneable" error, point PI_CMD at a good
# Node + pi's cli.js, e.g.:
#   PI_CMD="$HOME/.nvm/versions/node/v22.16.0/bin/node \
#           $(npm root -g)/@earendil-works/pi-coding-agent/dist/cli.js" ./dev-run.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
EXT="$DIR/index.ts"
if [ -n "${PI_CMD:-}" ]; then
  # shellcheck disable=SC2086
  exec ${PI_CMD} -e "$EXT" "$@"
fi
exec pi -e "$EXT" "$@"
