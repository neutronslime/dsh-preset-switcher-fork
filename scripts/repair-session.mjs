// Repair a session whose recorded agent preset no longer exists.
// Usage: node repair-session.mjs <sessionId> [targetPreset=standard]
// Rewrites the LAST agent-preset/selected event (or the header, when no
// selection event exists) to a preset that still exists. Multi-frame zstd
// aware: decodes every frame, rewrites one line, re-encodes as ONE frame
// (fully compatible with the backend's frame scanner). Backs up first.
// Multi-frame zstd helper for the jsonl backend's concatenated-frame container.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
const ZSTD_MAGIC = 4247762216;
function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error("corrupt zstd: invalid frame magic at byte " + offset);
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error("corrupt zstd: reserved frame-header bit");
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) break;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) break;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error("corrupt zstd: reserved block type");
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) break;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
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
function encodeSingleFrame(text) {
  const trailing = text.endsWith("\n");
  const bytes = Buffer.from(text.replace(/\n+$/, "") + (trailing ? "\n" : ""), "utf8");
  return zstdCompressSync(bytes, { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
}

const sessionId = process.argv[2];
const target = process.argv[3] || "standard";
if (!sessionId) { console.error("usage: node repair-session.mjs <sessionId> [targetPreset]"); process.exit(2); }
const base = "C:/Users/Lenovo/.dsh/sessions/--C-Users-Lenovo-.dsh--";
const file = `${base}/session-${sessionId}/session.jsonl.zstd`;
const json = decodeAll(file);
const trailingNewline = json.endsWith("\n");
const lines = json.split("\n").filter((l) => l.trim().length > 0);
let targetIndex = -1;
let kind = "none";
lines.forEach((line, i) => {
  try { const ev = JSON.parse(line); if (ev && ev.type === "agent-preset/selected") targetIndex = i; } catch { /* skip */ }
});
if (targetIndex === -1) {
  try {
    const header = JSON.parse(lines[0]);
    if (header && typeof header.agentPreset === "string") { targetIndex = 0; kind = "header"; }
  } catch { /* not json */ }
} else {
  kind = "event";
}
if (targetIndex === -1) { console.error("no preset reference found (no header, no selection event)"); process.exit(3); }
const parsed = JSON.parse(lines[targetIndex]);
const before = kind === "header" ? parsed.agentPreset : parsed.data?.agentPreset;
if (kind === "header") parsed.agentPreset = target;
else parsed.data.agentPreset = target;
lines[targetIndex] = JSON.stringify(parsed);
copyFileSync(file, file + ".bak");
writeFileSync(file, encodeSingleFrame(lines.join("\n") + (trailingNewline ? "\n" : "")));
console.log(`fixed ${kind} ${before} -> ${target} for session-${sessionId} (backup: session.jsonl.zstd.bak)`);
