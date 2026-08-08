// Registration smoke test: load pi-mesh in a real pi rpc session under Node 22,
// confirm it registers a pi- peer in Claude's registry, then exit + verify cleanup.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PI_CLI = "/Users/alonw/.nvm/versions/node/v20.13.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
const NODE22 = "/Users/alonw/.nvm/versions/node/v22.16.0/bin/node";
const EXT = "/Users/alonw/projects/pi-mesh/index.ts";
const REG = path.join(homedir(), ".claude", "sessions");
const testCwd = "/tmp/pi-mesh-testcwd";

function piEntries() {
  const out = [];
  for (const f of readdirSync(REG)) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const d = JSON.parse(readFileSync(path.join(REG, f), "utf8"));
      if (d.entrypoint === "pi") out.push(d);
    } catch { /* */ }
  }
  return out;
}

import { mkdirSync } from "node:fs";
mkdirSync(testCwd, { recursive: true });

const child = spawn(NODE22, [PI_CLI, "--mode", "rpc", "-e", EXT], {
  cwd: testCwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, PI_MESH_DEBUG: "1" },
});
let out = "", err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);

child.stdin.write(JSON.stringify({ type: "get_state" }) + "\n");
await sleep(1500);

const entries = piEntries();
console.log("=== pi- registry entries during session ===");
for (const e of entries) console.log(`  name=${e.name} pid=${e.pid} sock=${e.messagingSocketPath} cwd=${e.cwd}`);
const mine = entries.find((e) => e.pid === child.pid);
console.log(mine ? "REGISTERED ✓ (this session)" : "NOT registered for our pid");

console.log("=== get_state response (grep) ===");
console.log(out.split("\n").filter((l) => l.includes("get_state")).slice(0, 1).join("\n") || "(none)");

console.log("=== stderr (extension load errors?) ===");
console.log(err.split("\n").filter((l) => /error|extension|pi-mesh|typebox|cannot|throw/i.test(l)).slice(0, 8).join("\n") || "(clean)");

// exit
child.stdin.end();
await sleep(2500);
try { child.kill("SIGKILL"); } catch { /* */ }
await sleep(1500);
const after = piEntries().find((e) => e.pid === child.pid);
console.log(after ? "cleanup: STILL registered (bad)" : "cleanup: entry removed ✓");
console.log("=== pi-mesh debug log ===");
console.log(existsSync("/tmp/pi-mesh-debug.log") ? readFileSync("/tmp/pi-mesh-debug.log", "utf8") : "(no debug log)");
process.exit(0);
