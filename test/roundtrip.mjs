// Full e2e round-trip:
//  - stands up a throwaway "Claude" peer (listener) in Claude's registry
//  - launches a real pi rpc session with the pi-claude-link extension
//  - INBOUND: sends a peer message to the pi session; pi injects it in real time,
//    answers, and relays the reply back to the listener
//  - OUTBOUND: prompts pi to use the `claude-link` tool to message the listener
// Never targets real sessions — only the throwaway listener + our own pi session.
//
// Run under a pi-compatible Node (>= 20.19). If `pi` on PATH is on an old Node:
//   PI_CMD="/path/node22 /path/pi/dist/cli.js" node --experimental-strip-types test/roundtrip.mjs
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import * as P from "../claude-protocol.ts";
import { EXT, spawnPi } from "./pi-launch.mjs";

const REG = path.join(homedir(), ".claude", "sessions");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- throwaway "Claude" listener ----
const lpid = process.pid;
const lsock = path.join(P.ccSocksDir(), `${lpid}.sock`);
const received = [];
await P.bindSocket(lsock, (frame) => {
  if (frame?.type === "user") {
    const { body, fromName } = P.stripEnvelope(frame.message?.content || "");
    received.push({ from: fromName || frame.from, body });
    console.log(`\n<<< listener got from ${fromName || frame.from}:\n${body}\n`);
  } else if (frame?.type === "control") {
    console.log(`<<< receipt: ${frame.action}=${frame.status}`);
  }
});
await P.registerPeer({ pid: lpid, sessionId: `demo-${lpid}`, name: "claude-demo", cwd: process.cwd(), sockPath: lsock });
console.log(`listener up as claude-demo (${lsock})`);

// ---- launch pi ----
const testCwd = path.join(tmpdir(), "pi-claude-link-rt"); mkdirSync(testCwd, { recursive: true });
const pi = spawnPi(["--mode", "rpc", "-e", EXT], {
  cwd: testCwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PI_CLAUDE_LINK_DEBUG: "1" },
});
let piOut = "";
pi.stdout.on("data", (d) => (piOut += d));
pi.stderr.on("data", () => {});
await sleep(4000);

function piEntry() {
  for (const f of readdirSync(REG)) {
    if (!/^\d+\.json$/.test(f)) continue;
    try { const d = JSON.parse(readFileSync(path.join(REG, f), "utf8")); if (d.pid === pi.pid) return d; } catch { /* */ }
  }
}
const entry = piEntry();
console.log(entry ? `pi registered as ${entry.name} (${entry.messagingSocketPath})` : "pi NOT registered");
if (!entry) { pi.kill("SIGKILL"); await P.deregisterPeer(lpid, lsock); process.exit(1); }

// ---- INBOUND test: message the pi session, expect a relayed reply ----
console.log("\n>>> INBOUND: sending peer message to pi...");
await P.sendToClaude({ sock: entry.messagingSocketPath, from: `uds:${lsock}`, fromName: "claude-demo",
  body: "Reply with exactly: MESH-PI-OK followed by the value of 6*7. Nothing else." });
for (let i = 0; i < 60 && !received.some((r) => /MESH-PI-OK/.test(r.body)); i++) await sleep(1000);
const inboundOk = received.some((r) => /MESH-PI-OK/.test(r.body));
console.log(inboundOk ? "INBOUND round-trip ✓" : "INBOUND: no relayed reply captured");

// ---- OUTBOUND test: pi uses the claude-link tool to message the listener ----
console.log("\n>>> OUTBOUND: prompting pi to use the claude-link tool...");
received.length = 0;
pi.stdin.write(JSON.stringify({ type: "prompt",
  message: 'Use the claude-link tool: action "send", to "claude-demo", message "HELLO-FROM-PI". Then stop.' }) + "\n");
for (let i = 0; i < 60 && !received.some((r) => /HELLO-FROM-PI/.test(r.body)); i++) await sleep(1000);
const outboundOk = received.some((r) => /HELLO-FROM-PI/.test(r.body));
console.log(outboundOk ? "OUTBOUND (claude-link tool send) ✓" : "OUTBOUND: listener did not receive the tool send");

// ---- cleanup ----
pi.stdin.end(); await sleep(1500);
try { pi.kill("SIGKILL"); } catch { /* */ }
await P.deregisterPeer(lpid, lsock);
console.log(`\nRESULT: inbound=${inboundOk} outbound=${outboundOk}`);
process.exit(inboundOk && outboundOk ? 0 : 2);
