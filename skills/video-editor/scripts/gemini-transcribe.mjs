#!/usr/bin/env node
// Cloud transcription with Gemini 3.5 Transcribe - the fallback when local transcription
// (Parakeet / whisper.cpp) fails or gives unusable output.
//
//   node gemini-transcribe.mjs <video-or-audio> [--out assets/transcript.json]
//        [--lang fr-FR] [--speakers] [--srt] [--model gemini-3.5-transcribe]
//
// Writes a flat word array, the same shape `npx hyperframes transcribe --json` produces:
//   [{ "id": "w0", "text": "Hello", "start": 0.1, "end": 0.4 }, ...]
// plus <out>.txt (plain text) and, with --srt, <out>.srt.
// Exit 2 = no Gemini key configured (ask the user for one).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname, resolve } from "node:path";
import { requireKey, uploadFile, deleteFile, interact, outputBlocks, parseArgs, AUDIO_MIME, scrub } from "./lib/gemini.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["speakers", "srt"] });
const input = args._[0];
if (!input || !existsSync(input)) {
  console.error("usage: gemini-transcribe.mjs <video-or-audio> [--out file.json] [--lang fr-FR] [--speakers] [--srt]");
  process.exit(1);
}
const key = requireKey();
const out = resolve(args.out || "assets/transcript.json");
const model = args.model || "gemini-3.5-transcribe";
// Word timestamps are limited to 30 min per request; stay safely under it.
const CHUNK_SECONDS = 25 * 60;

const has = (bin) => spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
const work = mkdtempSync(join(tmpdir(), "gemini-transcribe-"));

function duration(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return parseFloat(r.stdout) || 0;
}

// 1. Prepare audio: mono 16 kHz mp3 keeps uploads small; split long files into chunks.
let chunks = [];
if (has("ffmpeg") && has("ffprobe")) {
  const total = duration(input);
  const pattern = join(work, "chunk_%03d.mp3");
  const ff = ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k"];
  if (total > CHUNK_SECONDS) ff.push("-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-reset_timestamps", "1", pattern);
  else ff.push(join(work, "chunk_000.mp3"));
  const r = spawnSync("ffmpeg", ff, { encoding: "utf8" });
  if (r.status !== 0) { console.error(`ffmpeg failed: ${r.stderr}`); process.exit(1); }
  let offset = 0;
  for (const f of readdirSync(work).filter((n) => n.startsWith("chunk_")).sort()) {
    const p = join(work, f);
    chunks.push({ path: p, mime: "audio/mp3", offset });
    offset += duration(p);
  }
} else {
  const mime = AUDIO_MIME[extname(input).toLowerCase()];
  if (!mime) { console.error("ffmpeg is not installed and the input is not an audio file Gemini accepts. Install ffmpeg."); process.exit(1); }
  chunks.push({ path: input, mime, offset: 0 });
}

const secs = (s) => (typeof s === "number" ? s : parseFloat(String(s ?? "").replace(/s$/, "")) || 0);
const round = (n) => Math.round(n * 1000) / 1000;

const words = [];
const texts = [];
try {
  for (const [i, c] of chunks.entries()) {
    process.stderr.write(`Transcribing part ${i + 1}/${chunks.length} with ${model}…\n`);
    const file = await uploadFile(key, c.path, c.mime, `transcribe-${i}`);
    try {
      const mode = { type: "verbatim", timestamp_granularities: ["word"] };
      if (args.speakers) mode.diarization_mode = "speaker";
      const transcription_config = { mode, language_codes: args.lang ? args.lang.split(",") : [] };
      const res = await interact(key, {
        model,
        input: [{ type: "audio", uri: file.uri, mime_type: file.mimeType || c.mime }],
        generation_config: { transcription_config },
      });
      for (const block of outputBlocks(res)) {
        if (block.type === "text" && block.text) texts.push(block.text.trim());
        for (const a of block.annotations || []) {
          if (a.type !== "word_info" || !a.text) continue;
          const w = { text: a.text, start: round(c.offset + secs(a.start_offset)), end: round(c.offset + secs(a.end_offset)) };
          if (a.speaker) w.speaker = a.speaker;
          words.push(w);
        }
      }
    } finally {
      await deleteFile(key, file.name);
    }
  }
} catch (e) {
  console.error(scrub(e.message, key));
  if (e.status === 400 || e.status === 403) console.error("If the key is wrong or expired, run: node <SKILL_DIR>/scripts/gemini-key.mjs test");
  process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (!words.length && !texts.join("").trim()) {
  console.error("Gemini returned an empty transcript (no speech detected?).");
  process.exit(1);
}

words.forEach((w, i) => { w.id = `w${i}`; });
const ordered = words.map(({ id, text, start, end, speaker }) => (speaker ? { id, text, start, end, speaker } : { id, text, start, end }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(ordered, null, 2));
const base = out.replace(/\.json$/i, "");
writeFileSync(`${base}.txt`, texts.join("\n\n") || ordered.map((w) => w.text).join(" "));

if (args.srt && ordered.length) {
  const ts = (t) => {
    const ms = Math.round(t * 1000);
    const p = (n, l = 2) => String(n).padStart(l, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const cues = [];
  let cur = [];
  for (const w of ordered) {
    cur.push(w);
    const span = w.end - cur[0].start;
    if (cur.length >= 7 || span >= 3 || /[.!?؟…]$/.test(w.text)) { cues.push(cur); cur = []; }
  }
  if (cur.length) cues.push(cur);
  writeFileSync(`${base}.srt`, cues.map((c, i) => `${i + 1}\n${ts(c[0].start)} --> ${ts(c.at(-1).end)}\n${c.map((w) => w.text).join(" ")}\n`).join("\n"));
}

console.log(JSON.stringify({
  ok: true, engine: model, words: ordered.length,
  duration: ordered.length ? ordered.at(-1).end : null,
  transcript: out, text: `${base}.txt`, srt: args.srt ? `${base}.srt` : null,
  note: ordered.length ? undefined : "No word timings returned - only the plain text was written.",
}, null, 2));
