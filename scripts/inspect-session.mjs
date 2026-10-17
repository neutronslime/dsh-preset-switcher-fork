// Inspect session logs (read-only, multi-frame zstd aware).
// Usage: node inspect-session.mjs <sessionId>...
import { readFileSync } from "node:fs";
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
const base = "C:/Users/Lenovo/.dsh/sessions/--C-Users-Lenovo-.dsh--";
for (const id of process.argv.slice(2)) {
  const file = `${base}/session-${id}/session.jsonl.zstd`;
  try {
    const json = decodeAll(file);
    const lines = json.split("\n").filter((l) => l.trim());
    const events = [];
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev && ev.type) events.push({ type: ev.type, seq: ev.seq, time: ev.time });
      } catch { /* skip non-event lines */ }
    }
    const withSeq = events.filter((e) => e.seq !== undefined);
    console.log(`=== session-${id} lines=${lines.length} events=${withSeq.length} ===`);
    const sel = events.filter((e) => e.type === "agent-preset/selected");
    console.log("selected events: " + JSON.stringify(sel));
    const header = (() => { try { return JSON.parse(lines[0]); } catch { return null; } })();
    if (header && header.agentPreset !== undefined) console.log("header.agentPreset: " + header.agentPreset);
    const tail = withSeq.slice(-5).map((e) => e.type + ":" + e.seq + "@" + (e.time ? new Date(e.time).toISOString() : "?"));
    console.log("tail: " + JSON.stringify(tail));
  } catch (e) {
    console.log(`=== session-${id} ERROR: ${e.message} ===`);
  }
}
