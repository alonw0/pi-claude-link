// Shared test helper: locate the extension and launch pi portably.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const EXT = fileURLToPath(new URL("../index.ts", import.meta.url));

/** Spawn a pi process with the given args. Honors $PI_CMD ("<node> <cli.js>" or
 *  any launcher) so you can force a compatible Node; else uses `pi` on PATH. */
export function spawnPi(args, opts = {}) {
  const cmd = process.env.PI_CMD;
  if (cmd) {
    const parts = cmd.split(/\s+/).filter(Boolean);
    return spawn(parts[0], [...parts.slice(1), ...args], opts);
  }
  return spawn("pi", args, opts);
}
