// Inspect an arbitrary session-log file (multi-frame zstd aware).
// Usage: node inspect-file.mjs <path-to-log>
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
const ZSTD_MAGIC = 4247762216;
function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const csf = descriptor >>> 6;
    const ss = (descriptor & 32) !== 0;
    const chk = (descriptor & 4) !== 0;
    const df = descriptor & 3;
    const db = df === 3 ? 4 : df;
    const csb = csf === 0 ? (ss ? 1 : 0) : 1 << csf;
    const rhb = (ss ? 0 : 1) + db + csb;
    if (buffer.length - offset < rhb) break;
    offset += rhb;
    for (;;) {
      if (buffer.length - offset < 3) break;
      const bh = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lb = (bh & 1) !== 0;
      const bt = (bh >>> 1) & 3;
      const bs = bh >>> 3;
      if (bt === 3) break;
      const pb = bt === 1 ? 1 : bs;
      if (buffer.length - offset < pb) break;
      offset += pb;
      if (lb) break;
    }
    if (chk) {
      if (buffer.length - offset < 4) break;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}
function decodeAll(path) {
  const raw = readFileSync(path);
  if (!path.endsWith(".zstd")) return raw.toString("utf8");
  let out = "";
  for (const f of scanFrames(raw)) out += zstdDecompressSync(raw.subarray(f.start, f.end)).toString("utf8");
  return out;
}
const path = process.argv[2];
const json = decodeAll(path);
const lines = json.split("\n").filter((l) => l.trim());
const events = [];
for (const line of lines) {
  try { const ev = JSON.parse(line); if (ev && ev.type) events.push({ type: ev.type, seq: ev.seq, time: ev.time }); } catch {}
}
const withSeq = events.filter((e) => e.seq !== undefined);
console.log("lines=" + lines.length + " events=" + withSeq.length + " frames=" + scanFrames(readFileSync(path)).length);
const sel = events.filter((e) => e.type === "agent-preset/selected");
console.log("selected: " + JSON.stringify(sel.map((e) => ({ seq: e.seq, time: e.time ? new Date(e.time).toISOString() : "?" }))));
try {
  const header = JSON.parse(lines[0]);
  console.log("header.agentPreset: " + header.agentPreset + " delegationDepth: " + header.delegationDepth);
} catch (e) {
  console.log("header parse failed: " + e.message);
}
const types = [...new Set(events.map((e) => e.type))];
console.log("types: " + types.join(", "));
const tail = withSeq.slice(-5).map((e) => e.type + ":" + e.seq + "@" + (e.time ? new Date(e.time).toISOString() : "?"));
console.log("tail: " + JSON.stringify(tail));
