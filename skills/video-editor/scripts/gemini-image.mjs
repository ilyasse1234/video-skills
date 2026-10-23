#!/usr/bin/env node
// Generate or edit images/graphics for a video with Gemini (Nano Banana).
//
//   node gemini-image.mjs "prompt" --out assets/images/hero.png
//        [--aspect 9:16] [--size 2K] [--model nb2|lite|pro|<id>]
//        [--ref logo.png --ref style.jpg] [--transparent] [--search] [--thinking high]
//
// Aspect ratios: 1:1 3:2 2:3 3:4 4:3 4:5 5:4 9:16 16:9 21:9   Sizes: 1K 2K 4K (uppercase K)
// --transparent : generates on a flat green screen and keys it out to a PNG with alpha (needs ffmpeg)
// --search      : lets Gemini ground the image in Google Search (real data, current events)
// Exit 2 = no Gemini key configured (ask the user for one).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { requireKey, interact, outputBlocks, parseArgs, scrub } from "./lib/gemini.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["transparent", "search"], multi: ["ref"] });
let prompt = args._.join(" ").trim();
if (!prompt) {
  console.error('usage: gemini-image.mjs "prompt" --out file.png [--aspect 16:9] [--size 2K] [--ref img] [--transparent] [--search]');
  process.exit(1);
}
const key = requireKey();

const MODELS = {
  nb2: "gemini-nano-banana-2.1", flash: "gemini-nano-banana-2.1", default: "gemini-nano-banana-2.1",
  lite: "gemini-3.1-flash-lite-image", pro: "gemini-3-pro-image",
};
const model = MODELS[args.model || "default"] || args.model;
const ASPECTS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
if (args.aspect && !ASPECTS.includes(args.aspect)) { console.error(`--aspect must be one of ${ASPECTS.join(" ")}`); process.exit(1); }
const size = args.size ? args.size.toUpperCase() : undefined;
if (size && !["1K", "2K", "4K"].includes(size)) { console.error("--size must be 1K, 2K or 4K"); process.exit(1); }

const out = resolve(args.out || `assets/images/gen-${Date.now()}.png`);
mkdirSync(dirname(out), { recursive: true });

if (args.transparent) {
  prompt += ". Place the subject on a perfectly flat, uniform pure green (#00FF00) background with no shadows, gradients, reflections or green on the subject itself.";
}

const IMG_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".heic": "image/heic" };
const input = [{ type: "text", text: prompt }];
for (const ref of args.ref || []) {
  if (!existsSync(ref)) { console.error(`reference not found: ${ref}`); process.exit(1); }
  const mime = IMG_MIME[extname(ref).toLowerCase()];
  if (!mime) { console.error(`unsupported reference image type: ${ref}`); process.exit(1); }
  input.push({ type: "image", mime_type: mime, data: readFileSync(ref).toString("base64") });
}

const body = { model, input, response_format: { type: "image", mime_type: "image/png" } };
if (args.aspect) body.response_format.aspect_ratio = args.aspect;
if (size) body.response_format.image_size = size;
if (args.search) body.tools = [{ type: "google_search" }];
if (args.thinking) body.generation_config = { thinking_level: args.thinking };

let res;
try {
  res = await interact(key, body);
} catch (e) {
  console.error(scrub(e.message, key));
  process.exit(1);
}

const blocks = outputBlocks(res);
const image = blocks.filter((b) => b.type === "image" && b.data).at(-1);
const note = blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n").trim();
if (!image) {
  console.error(`Gemini returned no image.${note ? ` Model said: ${note}` : ""}`);
  process.exit(1);
}

const raw = out.replace(/\.[^.]+$/, "") + (image.mime_type === "image/jpeg" ? ".raw.jpg" : ".raw.png");
writeFileSync(raw, Buffer.from(image.data, "base64"));

let final = out;
if (args.transparent) {
  if (!final.toLowerCase().endsWith(".png")) final = final.replace(/\.[^.]+$/, "") + ".png";
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw,
    "-vf", "colorkey=0x00FF00:0.30:0.08,despill=type=green", "-frames:v", "1", final], { encoding: "utf8" });
  if (r.status !== 0) { console.error(`Keying failed (is ffmpeg installed?): ${r.stderr}`); process.exit(1); }
  rmSync(raw);
} else {
  const want = extname(out).toLowerCase().replace(".jpeg", ".jpg");
  const got = extname(raw).toLowerCase();
  if (want === got || !hasFfmpeg()) {
    renameSync(raw, (final = out.replace(/\.[^.]+$/, "") + got));
  } else {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-frames:v", "1", final]);
    if (r.status === 0) rmSync(raw); else renameSync(raw, (final = out.replace(/\.[^.]+$/, "") + got));
  }
}

function hasFfmpeg() { return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0; }

const dims = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", final], { encoding: "utf8" });
console.log(JSON.stringify({
  ok: true, model, file: final, size: dims.status === 0 ? dims.stdout.trim() : null,
  transparent: Boolean(args.transparent), model_note: note || undefined,
}, null, 2));
