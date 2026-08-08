// Claude Code cross-session wire protocol — TypeScript port of codex-mesh/protocol.mjs.
// Lets a non-Claude process (a pi session) be a first-class peer in Claude's mesh:
// register in Claude's session registry, bind a cc-socks socket, and send/receive
// the newline-delimited JSON frames Claude uses.
//
// Node built-ins only — no pi/agent deps, so it stays portable and testable.
// Verified against Claude Code 2.1.224.

import { readdir, readFile, mkdir, chmod, unlink, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

export const HOME = homedir();
export const CLAUDE_REGISTRY = path.join(HOME, ".claude", "sessions");
export const MAX_LINE = 1024 * 1024; // Claude drops a connection past 1 MiB w/o newline

export interface ClaudePeer {
  pid?: number;
  sessionId?: string;
  name: string;
  cwd: string;
  status: string;
  kind?: string;
  startedAt?: number;
  sock: string;
  live?: boolean;
}

export interface UserFrame {
  msgV: 1;
  msg_id: string;
  type: "user";
  priority: string;
  from?: string;
  session_id?: string;
  message: { role: "user"; content: string };
  [k: string]: unknown;
}

/**
 * The directory Claude binds its own sockets in. We MUST co-locate ours there so
 * (1) Claude sends us delivery/hold receipts (it only replies to siblings of its
 * own socket), and (2) sandboxed peers (e.g. Codex's MCP server) can reach it.
 * Discovered from an existing registry entry rather than guessed from env.
 */
export function ccSocksDir(): string {
  try {
    for (const f of readdirSync(CLAUDE_REGISTRY)) {
      if (!/^\d+\.json$/.test(f)) continue;
      let s: any;
      try { s = JSON.parse(readFileSync(path.join(CLAUDE_REGISTRY, f), "utf8")); } catch { continue; }
      if (typeof s.messagingSocketPath === "string" && s.messagingSocketPath.endsWith(".sock"))
        return path.dirname(s.messagingSocketPath);
    }
  } catch { /* registry missing */ }
  const base = process.env.XDG_RUNTIME_DIR || "/tmp";
  return path.join(base, "cc-socks");
}

// ------------------------------------------------------------------ discovery

export function socketLive(sock: string): Promise<boolean> {
  return new Promise((res) => {
    if (!sock) return res(false);
    const c = connect({ path: sock });
    const done = (v: boolean) => { c.destroy(); res(v); };
    c.setTimeout(250, () => done(false));
    c.on("connect", () => done(true));
    c.on("error", () => done(false));
  });
}

/** All live, addressable Claude peers (excludes our own socket if given). */
export async function listClaudeSessions(opts: { excludeSock?: string } = {}): Promise<ClaudePeer[]> {
  let files: string[] = [];
  try { files = await readdir(CLAUDE_REGISTRY); } catch { return []; }
  const rows: ClaudePeer[] = [];
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    let s: any;
    try { s = JSON.parse(await readFile(path.join(CLAUDE_REGISTRY, f), "utf8")); } catch { continue; }
    const sock = typeof s.messagingSocketPath === "string" ? s.messagingSocketPath : "";
    if (!sock || sock === opts.excludeSock) continue;
    rows.push({
      pid: s.pid,
      sessionId: s.sessionId,
      name: typeof s.name === "string" ? s.name : `pid ${s.pid}`,
      cwd: typeof s.cwd === "string" ? s.cwd : "?",
      status: typeof s.status === "string" ? s.status : "unknown",
      kind: s.kind,
      startedAt: s.startedAt,
      sock,
    });
  }
  await Promise.all(rows.map(async (r) => { r.live = await socketLive(r.sock); }));
  return rows.filter((r) => r.live).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export interface ResolveResult { target?: ClaudePeer; error?: string; candidates?: string[]; }

/** Resolve a target by exact name, name prefix, or sessionId. */
export async function resolveTarget(nameOrId: string, opts: { excludeSock?: string } = {}): Promise<ResolveResult> {
  const rows = await listClaudeSessions(opts);
  let hit = rows.find((r) => r.sessionId === nameOrId) || rows.find((r) => r.name === nameOrId);
  if (!hit) {
    const pfx = rows.filter((r) => r.name && r.name.startsWith(nameOrId));
    if (pfx.length === 1) hit = pfx[0];
    else if (pfx.length > 1) return { error: `ambiguous: ${pfx.map((r) => r.name).join(", ")}` };
  }
  if (!hit) return { error: `no live Claude session matches "${nameOrId}"`, candidates: rows.map((r) => r.name) };
  return { target: hit };
}

// ------------------------------------------------------------------- envelope

const TAG = "cross-session-message";
const escapeBody = (b: string) => b.replace(new RegExp(`</(?=${TAG}(?:[>\\s/]|$))`, "gi"), "<\\/");
const unescapeBody = (b: string) => b.replace(new RegExp(`<\\\\/(?=${TAG}(?:[>\\s/]|$))`, "gi"), "</");

export function buildEnvelope(o: { from?: string; fromName?: string; fromMode?: string; body: string }): string {
  const attrs: string[] = [];
  if (o.from) attrs.push(`from="${o.from}"`);
  if (o.fromName) attrs.push(`from-name="${String(o.fromName).replace(/["<>]/g, "")}"`);
  if (o.fromMode) attrs.push(`from-mode="${o.fromMode}"`);
  const a = attrs.length ? " " + attrs.join(" ") : "";
  return `<${TAG}${a}>\n${escapeBody(o.body)}\n</${TAG}>`;
}

export interface StrippedEnvelope { body: string; from?: string; fromName?: string; fromMode?: string; }

/** Extract the human body + attrs from an inbound content string. Non-envelope
 *  content is returned verbatim as the body. */
export function stripEnvelope(content: unknown): StrippedEnvelope {
  if (typeof content !== "string") return { body: "" };
  const m = content.match(
    new RegExp(`^<${TAG}((?:\\s+[a-z-]+="[^"]*")*)>\\n([\\s\\S]*)\\n</${TAG}>$`)
  );
  if (!m) return { body: content };
  const attrs: Record<string, string> = {};
  for (const a of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
  return { body: unescapeBody(m[2]), from: attrs["from"], fromName: attrs["from-name"], fromMode: attrs["from-mode"] };
}

// ------------------------------------------------------------------ wire I/O

export function buildUserFrame(o: { content: string; from?: string; priority?: string; sessionId?: string }): UserFrame {
  return {
    msgV: 1,
    msg_id: randomUUID(),
    type: "user",
    priority: o.priority || "next",
    ...(o.from && { from: o.from }),
    ...(o.sessionId && { session_id: o.sessionId }),
    message: { role: "user", content: o.content },
  };
}

/** Send one frame to a socket path (connect, write JSON+\n, close). */
export function sendFrame(sock: string, frame: unknown, opts: { timeout?: number } = {}): Promise<string> {
  const timeout = opts.timeout ?? 5000;
  return new Promise((resolve, reject) => {
    const c = connect({ path: sock });
    c.setTimeout(timeout, () => { c.destroy(); reject(new Error(`timed out connecting to ${sock}`)); });
    c.on("error", reject);
    c.on("connect", () => c.end(JSON.stringify(frame) + "\n", () => resolve((frame as any).msg_id)));
  });
}

/** High-level: send a message to a Claude session, wrapped as a peer would. */
export async function sendToClaude(o: { sock: string; body: string; from?: string; fromName?: string; priority?: string }): Promise<string> {
  const content = buildEnvelope({ from: o.from, fromName: o.fromName, body: o.body });
  return sendFrame(o.sock, buildUserFrame({ content, from: o.from, priority: o.priority }));
}

export function receiptFrame(o: { status: string; from?: string; origMsgId?: string | null; reason?: string }) {
  return {
    msgV: 1,
    msg_id: randomUUID(),
    type: "control",
    action: "peer_message_status",
    status: o.status,
    ...(o.reason && { reason: o.reason }),
    ...(o.from && { from: o.from }),
    ...(o.origMsgId && { orig_msg_id: o.origMsgId }),
  };
}

/** Bind a listening UDS server yielding parsed frames via onFrame(frame, socket).
 *
 *  Note: we do NOT use allowHalfOpen. Claude's sender (`d1p`) writes a frame, then
 *  half-closes and resolves its send only when the socket fully CLOSES — timing out
 *  after 5s otherwise. If we held the connection half-open, every `SendMessage` to us
 *  would be reported as "Failed to send / Timed out" even though we received it. So we
 *  let the socket close (default allowHalfOpen:false) and also end our side on `end`. */
export async function bindSocket(sockPath: string, onFrame: (frame: any, conn: Socket) => void): Promise<Server> {
  const dir = path.dirname(sockPath);
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
  await chmod(dir, 0o700).catch(() => {});
  await unlink(sockPath).catch(() => {});
  const server = createServer((conn) => {
    conn.setEncoding("utf8");
    let buf = "";
    conn.on("data", (d: string) => {
      buf += d;
      if (buf.length > MAX_LINE) { conn.destroy(); buf = ""; return; }
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let frame: any; try { frame = JSON.parse(line); } catch { continue; }
        try { onFrame(frame, conn); } catch { /* handler error */ }
      }
    });
    // When the client half-closes, close our side too so the sender's socket fully
    // closes and its send resolves (see note above).
    conn.on("end", () => { try { conn.end(); } catch { /* */ } });
    conn.on("error", () => {});
  });
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(sockPath, () => { server.removeListener("error", rej); res(); });
  });
  await chmod(sockPath, 0o600).catch(() => {});
  return server;
}

// ------------------------------------------------------------------- registry

function procStart(pid: number): Promise<string | undefined> {
  return new Promise((res) => {
    execFile("ps", ["-o", "lstart=", "-p", String(pid)], (err, out) =>
      res(err ? undefined : out.trim() || undefined));
  });
}

/** Write ~/.claude/sessions/<pid>.json so Claude lists this session as a peer. */
export async function registerPeer(o: {
  pid: number; sessionId?: string; name: string; cwd: string; sockPath: string; status?: string;
}): Promise<void> {
  await mkdir(CLAUDE_REGISTRY, { recursive: true }).catch(() => {});
  const entry = {
    pid: o.pid,
    sessionId: o.sessionId || randomUUID(),
    cwd: o.cwd || process.cwd(),
    startedAt: Date.now(),
    procStart: await procStart(o.pid),
    version: "pi-claude-link",
    peerProtocol: 1,
    kind: "interactive",
    entrypoint: "pi",
    messagingSocketPath: o.sockPath,
    name: o.name,
    nameSource: "derived",
    status: o.status || "idle",
  };
  await writeFile(path.join(CLAUDE_REGISTRY, `${o.pid}.json`), JSON.stringify(entry, null, 2));
}

export async function updatePeer(pid: number, patch: Record<string, unknown>): Promise<void> {
  const f = path.join(CLAUDE_REGISTRY, `${pid}.json`);
  let cur: any = {};
  try { cur = JSON.parse(await readFile(f, "utf8")); } catch { return; }
  await writeFile(f, JSON.stringify({ ...cur, ...patch }, null, 2));
}

export async function deregisterPeer(pid: number, sockPath?: string): Promise<void> {
  await unlink(path.join(CLAUDE_REGISTRY, `${pid}.json`)).catch(() => {});
  if (sockPath) await unlink(sockPath).catch(() => {});
}

/** The display name Claude's /list-agents shows for the session bound to `sock`,
 *  looked up from the registry so it always matches the list (envelope from-name
 *  can be a stale title). Returns undefined if no registry entry matches. */
export function peerNameBySock(sock: string): string | undefined {
  if (!sock) return undefined;
  try {
    for (const f of readdirSync(CLAUDE_REGISTRY)) {
      if (!/^\d+\.json$/.test(f)) continue;
      let s: any;
      try { s = JSON.parse(readFileSync(path.join(CLAUDE_REGISTRY, f), "utf8")); } catch { continue; }
      if (s.messagingSocketPath === sock && typeof s.name === "string") return s.name;
    }
  } catch { /* registry missing */ }
  return undefined;
}

export function slugFromCwd(cwd: string): string {
  const base = path.basename(cwd || "pi") || "pi";
  return base.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 32);
}
