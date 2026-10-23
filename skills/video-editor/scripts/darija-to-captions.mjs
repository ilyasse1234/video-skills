#!/usr/bin/env node
// Convert darija-word-captions output (captions/words.json) into the word array
// HyperFrames/Remotion captions use: [{ id, text, start, end, lang }].
//
//   node darija-to-captions.mjs captions/words.json [--out assets/transcript.json] [--srt]
//
// - Words the aligner could not time are left out and listed - never given guessed times.
// - A standalone Arabic article (الـ / ال) is joined to the next word so no caption is only "الـ".
// - Also writes <out>.txt and, with --srt, <out>.srt.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { parseArgs } from "./lib/gemini.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["srt"] });
const src = args._[0];
if (!src || !existsSync(src)) { console.error("usage: darija-to-captions.mjs captions/words.json [--out assets/transcript.json] [--srt]"); process.exit(1); }
const out = resolve(args.out || "assets/transcript.json");
const data = JSON.parse(readFileSync(src, "utf8"));
const words = data.words || data;

const ARTICLE = /^(ال|الـ|لـ|l'|L')$/;
const untimed = [];
const result = [];
let carry = null; // article waiting for the next word
for (const w of words) {
  const ok = typeof w.start === "number" && typeof w.end === "number" && w.end > w.start;
  if (!ok) { untimed.push(w.word); continue; }
  if (ARTICLE.test(w.word)) { carry = carry ? { ...carry, word: carry.word + w.word } : { ...w }; continue; }
  // Arabic next word: attach directly (ال + كتاب). Latin next word: keep the article as written (الـ captions).
  const arabicNext = /[\u0600-\u06FF]/.test(w.word);
  const text = carry ? (arabicNext ? `${carry.word.replace(/\u0640$/, "")}${w.word}` : `${carry.word} ${w.word}`) : w.word;
  result.push({ text, start: carry ? Math.min(carry.start, w.start) : w.start, end: w.end, lang: w.lang, score: w.score ?? null });
  carry = null;
}
if (carry) result.push({ text: carry.word, start: carry.start, end: carry.end, lang: carry.lang, score: carry.score ?? null });

const r3 = (n) => Math.round(n * 1000) / 1000;
const final = result.map((w, i) => ({ id: `w${i}`, text: w.text, start: r3(w.start), end: r3(w.end), lang: w.lang }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(final, null, 2));
const base = out.replace(/\.json$/i, "");
writeFileSync(`${base}.txt`, final.map((w) => w.text).join(" "));

if (args.srt && final.length) {
  const ts = (t) => {
    const ms = Math.round(t * 1000), p = (n, l = 2) => String(n).padStart(l, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const cues = []; let cur = [];
  for (const w of final) {
    cur.push(w);
    if (cur.length >= 6 || w.end - cur[0].start >= 3 || /[.!?؟…]$/.test(w.text)) { cues.push(cur); cur = []; }
  }
  if (cur.length) cues.push(cur);
  writeFileSync(`${base}.srt`, cues.map((c, i) => `${i + 1}\n${ts(c[0].start)} --> ${ts(c.at(-1).end)}\n${c.map((w) => w.text).join(" ")}\n`).join("\n"));
}

const issuesFile = join(dirname(resolve(src)), "issues.json");
const issues = existsSync(issuesFile) ? JSON.parse(readFileSync(issuesFile, "utf8")) : [];
console.log(JSON.stringify({
  ok: true, words: final.length, transcript: out, srt: args.srt ? `${base}.srt` : null,
  untimed: untimed.length ? untimed : undefined,
  review_flags: issues.length,
  review_status: data.review_status || "automated alignment; human listening not yet done",
}, null, 2));
