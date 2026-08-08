// Regression test: Claude's sender (`d1p`) resolves a send only when the socket
// fully CLOSES (5s timeout otherwise). Our listener must not hold the connection
// half-open, or every SendMessage to us is reported "Failed to send / Timed out"
// even though we received the message. This replicates d1p and asserts it resolves.
import { connect } from "node:net";
import { bindSocket } from "../claude-protocol.ts";
import path from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";

const sock = path.join(tmpdir(), `pi-claude-link-sendclose-${process.pid}.sock`);
let received = false;
const server = await bindSocket(sock, () => { received = true; });

// Replica of Claude Code's d1p: write a frame, half-close, resolve on 'close', 5s timeout.
function d1pSend(p, obj) {
  return new Promise((resolve, reject) => {
    const o = connect({ path: p });
    let timedOut = false;
    o.setTimeout(5000, () => { timedOut = true; o.destroy(); reject(new Error("Timed out sending")); });
    o.on("error", reject);
    o.on("connect", () => { o.write(JSON.stringify(obj) + "\n"); setTimeout(() => { if (!o.destroyed) o.end(); }, 30); });
    o.on("close", () => { if (!timedOut) resolve(); });
  });
}

const t0 = Date.now();
let ok = false;
try {
  await d1pSend(sock, { type: "user", message: { role: "user", content: "hi" } });
  ok = received && Date.now() - t0 < 2000;
  console.log(`send resolved in ${Date.now() - t0}ms; received=${received} -> ${ok ? "PASS" : "FAIL"}`);
} catch (e) {
  console.log(`FAIL: ${e.message} after ${Date.now() - t0}ms (listener held the socket half-open)`);
}
server.close();
try { unlinkSync(sock); } catch { /* */ }
process.exit(ok ? 0 : 1);
