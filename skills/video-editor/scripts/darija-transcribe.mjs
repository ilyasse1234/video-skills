#!/usr/bin/env node
// Darija / code-switched transcription that feeds forced alignment
// (darija-word-captions/scripts/align_words.py).
//
//   node darija-transcribe.mjs <video-or-audio> [--out captions] [--engine auto|moulsot|gemini]
//        [--model gemini-3.8-flash] [--latin en|fr] [--python python3]
//
// 1. Extracts mono 16 kHz audio and cuts it into 10-30 s chunks at pauses (never inside a word).
// 2. Transcribes each chunk verbatim:
//      moulsot - free local Darija model (Apple Silicon via mlx-audio, or qwen_asr)
//      gemini  - Gemini audio model with strict script rules (needs the user's key)
//      auto    - moulsot first, Gemini if MoulSot is not installed or fails
// 3. Writes <out>/audio.wav and <out>/transcript.json in the format align_words.py expects
//    (Darija in Arabic script, French/English in Latin script, aliases for numbers and loanwords).
// Exit 2 = Gemini needed but no key configured (ask the user for one).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findKey, requireKey, interact, outputBlocks, parseArgs, scrub } from "./lib/gemini.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const input = args._[0];
if (!input || !existsSync(input)) {
  console.error("usage: darija-transcribe.mjs <video-or-audio> [--out captions] [--engine auto|moulsot|gemini]");
  process.exit(1);
}
const outDir = resolve(args.out || "captions");
const engine = args.engine || "auto";
const geminiModel = args.model || "gemini-3.8-flash";
const latinDefault = args.latin || "en";
const python = args.python || "python3";
const MIN_CHUNK = 10, MAX_CHUNK = 30;

const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
const log = (m) => process.stderr.write(m + "\n");
const r3 = (n) => Math.round(n * 1000) / 1000;

// ---------- 1. audio + chunks at pauses ----------
mkdirSync(join(outDir, "chunks"), { recursive: true });
const audio = join(outDir, "audio.wav");
let r = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", audio]);
if (r.status !== 0) { console.error(`ffmpeg failed (is it installed?): ${r.stderr}`); process.exit(1); }
const duration = parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio]).stdout);

r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", audio, "-af", "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"]);
const silences = [];
let open = null;
for (const line of r.stderr.split("\n")) {
  const s = line.match(/silence_start: ([\d.]+)/);
  const e = line.match(/silence_end: ([\d.]+)/);
  if (s) open = parseFloat(s[1]);
  if (e && open !== null) { silences.push({ start: open, end: parseFloat(e[1]), mid: (open + parseFloat(e[1])) / 2 }); open = null; }
}

const chunks = [];
let cursor = 0;
while (duration - cursor > MAX_CHUNK) {
  const inRange = silences.filter((s) => s.mid > cursor + MIN_CHUNK && s.mid <= cursor + MAX_CHUNK);
  // Prefer the longest pause in range; a longer pause is a safer cut.
  let cut = inRange.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]?.mid;
  if (cut === undefined) {
    const next = silences.find((s) => s.mid > cursor + MAX_CHUNK);
    cut = next && next.mid - cursor <= MAX_CHUNK * 1.5 ? next.mid : cursor + MAX_CHUNK;
    if (!next || next.mid - cursor > MAX_CHUNK * 1.5) log(`warning: no pause near ${cut.toFixed(1)}s - cutting there; check that word`);
  }
  chunks.push({ start: r3(cursor), end: r3(cut) });
  cursor = cut;
}
chunks.push({ start: r3(cursor), end: r3(duration) });
chunks.forEach((c, i) => {
  c.file = join(outDir, "chunks", `chunk_${String(i).padStart(3, "0")}.wav`);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", audio, "-ss", String(c.start), "-to", String(c.end), "-ac", "1", "-ar", "16000", c.file]);
});
log(`${chunks.length} chunks (${MIN_CHUNK}-${MAX_CHUNK}s, cut at pauses) from ${duration.toFixed(1)}s of audio`);

// ---------- 2a. MoulSot (local, free) ----------
function moulsot() {
  log("Transcribing with MoulSot (local Darija model)…");
  const res = run(python, [join(HERE, "moulsot_chunks.py"), ...chunks.map((c) => c.file)], { stdio: ["ignore", "pipe", "pipe"] });
  if (res.status !== 0) { log(`MoulSot unavailable: ${res.stderr.trim().split("\n").slice(-2).join(" ")}`); return null; }
  const out = JSON.parse(res.stdout);
  return {
    provider: `${out.model} (${out.backend})`,
    segments: chunks.map((c, i) => ({ start: c.start, end: c.end, text: out.texts[i] || "" })).filter((s) => s.text),
    aliases: {}, uncertain: [],
  };
}

// ---------- 2b. Gemini with script rules ----------
const PROMPT = `Transcribe ONLY this audio chunk exactly as spoken. The speaker mixes Moroccan Darija with French and English, sometimes Modern Standard Arabic.
Rules:
- Write Darija and Arabic in Arabic script. Write French and English words in Latin letters exactly as spoken.
- Never translate. Never transliterate English or French into Arabic script, or Darija into Latin letters.
- Keep every audible word, filler and repetition (verbatim, not cleaned up).
- Split into short clauses of 2-5 seconds with start/end in seconds from the start of THIS chunk.
- aliases: for every number, and for every French or English word, give how it SOUNDS written in Arabic script (e.g. "24" -> "ربعة وعشرين", "captions" -> "كابشنز"), and its language: "fr" or "en" for Latin words, "ar" for numbers said in Darija/Arabic.
- uncertain: anything you could not hear clearly.`;
const SCHEMA = {
  type: "object",
  properties: {
    segments: { type: "array", items: { type: "object", properties: {
      start: { type: "number" }, end: { type: "number" }, text: { type: "string" } }, required: ["start", "end", "text"] } },
    aliases: { type: "array", items: { type: "object", properties: {
      word: { type: "string" }, spoken: { type: "string" }, lang: { type: "string", enum: ["fr", "en", "ar"] } }, required: ["word", "spoken"] } },
    uncertain: { type: "array", items: { type: "object", properties: {
      start: { type: "number" }, end: { type: "number" }, heard: { type: "string" }, reason: { type: "string" } } } },
  },
  required: ["segments"],
};

async function gemini() {
  const key = requireKey(); // exits 2 with GEMINI_KEY_MISSING when absent
  const segments = [], aliases = {}, uncertain = [], wordLang = {};
  for (const [i, c] of chunks.entries()) {
    log(`Gemini ${geminiModel}: chunk ${i + 1}/${chunks.length}`);
    let data;
    try {
      const res = await interact(key, {
        model: geminiModel,
        input: [
          { type: "audio", mime_type: "audio/wav", data: readFileSync(c.file).toString("base64") },
          { type: "text", text: PROMPT },
        ],
        response_format: SCHEMA,
      });
      const text = outputBlocks(res).filter((b) => b.type === "text").map((b) => b.text).join("");
      data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch (e) {
      console.error(scrub(e.message, key));
      process.exit(1);
    }
    const len = c.end - c.start;
    const segs = (data.segments || []).filter((s) => s.text && s.text.trim());
    // Clause times must be inside the chunk and in order; otherwise use the whole chunk as one segment.
    const valid = segs.length && segs.every((s, k) => s.start >= -0.5 && s.end <= len + 0.5 && s.end > s.start && (k === 0 || s.start >= segs[k - 1].start));
    if (valid) {
      for (const s of segs) segments.push({ start: r3(c.start + Math.max(0, s.start)), end: r3(c.start + Math.min(len, s.end)), text: s.text.trim() });
    } else if (segs.length) {
      segments.push({ start: c.start, end: c.end, text: segs.map((s) => s.text.trim()).join(" ") });
    }
    for (const a of data.aliases || []) {
      if (a.word && a.spoken) aliases[a.word] = a.spoken;
      if (a.word && (a.lang === "fr" || a.lang === "en")) wordLang[a.word] = a.lang;
    }
    for (const u of data.uncertain || []) uncertain.push({ ...u, start: r3(c.start + (u.start || 0)), end: r3(c.start + (u.end || 0)) });
  }
  return { provider: geminiModel, segments: segments.map((seg) => withSpans(seg, wordLang)), aliases, uncertain };
}

// Split a segment into language runs so each Latin run is timed by the right model (French vs English).
function withSpans(seg, wordLang) {
  const tokens = seg.text.split(/\s+/).filter(Boolean);
  const langOf = (t) => (/[\u0600-\u06FF]/.test(t) ? "ar" : /[A-Za-zÀ-ÿ]/.test(t) ? (wordLang[t] || wordLang[t.replace(/[.,!?;:]+$/, "")] || latinDefault) : "ar");
  const runs = [];
  for (const t of tokens) {
    const l = langOf(t);
    if (runs.length && runs.at(-1).lang === l) runs.at(-1).words.push(t);
    else runs.push({ lang: l, words: [t] });
  }
  if (!runs.some((r) => r.lang !== "ar" && r.lang !== latinDefault)) return seg; // nothing to override
  return { start: seg.start, end: seg.end, spans: runs.map((r) => ({ lang: r.lang, text: r.words.join(" ") })) };
}

let result = null;
if (engine === "moulsot" || engine === "auto") result = moulsot();
if (!result && engine === "moulsot") process.exit(3);
if (!result) {
  if (engine === "auto" && !findKey()) {
    console.error("GEMINI_KEY_MISSING: MoulSot is not available locally, and Gemini needs the user's API key.");
    process.exit(2);
  }
  result = await gemini();
}
if (!result.segments.length) { console.error("Empty transcript - no speech found."); process.exit(1); }

// Every token without letters (numbers, symbols) needs a spoken alias or the aligner stops.
const segText = (s) => s.text ?? s.spans.map((p) => p.text).join(" ");
const needAlias = [...new Set(result.segments.flatMap((s) => segText(s).split(/\s+/))
  .filter((t) => t && !/[\p{L}]/u.test(t) && !result.aliases[t]))];

const transcript = {
  audio: "audio.wav",
  provider: result.provider,
  latin_default: latinDefault,
  aliases: result.aliases,
  segments: result.segments,
};
writeFileSync(join(outDir, "transcript.json"), JSON.stringify(transcript, null, 2));
if (result.uncertain.length) writeFileSync(join(outDir, "uncertain.json"), JSON.stringify(result.uncertain, null, 2));

console.log(JSON.stringify({
  ok: true, provider: result.provider, chunks: chunks.length, segments: result.segments.length,
  transcript: join(outDir, "transcript.json"), audio,
  uncertain: result.uncertain.length || undefined,
  needs_alias: needAlias.length ? needAlias : undefined,
  next: `python3 <REPO>/darija-word-captions/scripts/align_words.py ${join(outDir, "transcript.json")} --out ${outDir}`,
}, null, 2));
