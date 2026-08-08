// Registration smoke test: load pi-claude-link in a real pi rpc session, confirm
// it registers a pi- peer in Claude's registry, then exit + verify cleanup.
//
// Run under a pi-compatible Node (>= 20.19). If `pi` on PATH is on an old Node:
//   PI_CMD="/path/node22 /path/pi/dist/cli.js" node --experimental-strip-types test/reg-test.mjs
import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { EXT, spawnPi } from "./pi-launch.mjs";

const REG = path.join(homedir(), ".claude", "sessions");
const testCwd = path.join(tmpdir(), "pi-claude-link-regtest");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function piEntries() {
  const out = [];
  for (const f of readdirSync(REG)) {
    if (!/^\d+\.json$/.test(f)) continue;
    try { const d = JSON.parse(readFileSync(path.join(REG, f), "utf8")); if (d.entrypoint === "pi") out.push(d); } catch { /* */ }
  }
  return out;
}

mkdirSync(testCwd, { recursive: true });
const child = spawnPi(["--mode", "rpc", "-e", EXT], {
  cwd: testCwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PI_CLAUDE_LINK_DEBUG: "1" },
});
let out = "", err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));

await sleep(5000);
child.stdin.write(JSON.stringify({ type: "get_state" }) + "\n");
await sleep(1500);

const mine = piEntries().find((e) => e.pid === child.pid);
console.log(mine ? `REGISTERED ✓  ${mine.name} -> ${mine.messagingSocketPath}` : "NOT registered for our pid");
console.log("get_state:", out.split("\n").filter((l) => l.includes("get_state")).slice(0, 1).join("") || "(none)");
console.log("stderr:", err.split("\n").filter((l) => /error|extension|claude-link|typebox|cannot/i.test(l)).slice(0, 6).join(" | ") || "(clean)");

child.stdin.end();
await sleep(2500);
try { child.kill("SIGKILL"); } catch { /* */ }
await sleep(1500);
console.log(piEntries().find((e) => e.pid === child.pid) ? "cleanup: STILL registered (bad)" : "cleanup: removed ✓");
if (existsSync("/tmp/pi-claude-link-debug.log")) console.log("debug:\n" + readFileSync("/tmp/pi-claude-link-debug.log", "utf8"));
process.exit(mine ? 0 : 1);
