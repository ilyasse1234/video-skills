// Shared helpers for the video-editor Gemini scripts. Node 18+, no dependencies.
import { readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const API = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
export const KEY_FILE = join(homedir(), ".config", "video-skills", "gemini.env");
export const GET_KEY_URL = "https://aistudio.google.com/apikey";

/** Exit code every script uses when no key is configured, so the agent knows to ask the user. */
export const EXIT_NO_KEY = 2;

export function readKeyFile() {
  if (!existsSync(KEY_FILE)) return null;
  for (const line of readFileSync(KEY_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/);
    if (m) return m[1];
  }
  return null;
}

/** Key lookup order: GEMINI_API_KEY, GOOGLE_API_KEY, then the saved key file. */
export function findKey() {
  if (process.env.GEMINI_API_KEY) return { key: process.env.GEMINI_API_KEY, source: "env GEMINI_API_KEY" };
  if (process.env.GOOGLE_API_KEY) return { key: process.env.GOOGLE_API_KEY, source: "env GOOGLE_API_KEY" };
  const k = readKeyFile();
  if (k) return { key: k, source: KEY_FILE };
  return null;
}

export function requireKey() {
  const found = findKey();
  if (!found) {
    console.error(
      `GEMINI_KEY_MISSING: no Gemini API key found.\n` +
      `Ask the user for their key (free at ${GET_KEY_URL}), then save it with:\n` +
      `  node <SKILL_DIR>/scripts/gemini-key.mjs save   (key on stdin)`,
    );
    process.exit(EXIT_NO_KEY);
  }
  return found.key;
}

export function mask(key) {
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "****";
}

/** Never let the key leak into logs. */
export function scrub(text, key) {
  return key ? String(text).split(key).join(mask(key)) : String(text);
}

export async function apiFetch(key, path, init = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: { "x-goog-api-key": key, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(scrub(`Gemini API ${res.status} ${res.statusText}: ${body.slice(0, 800)}`, key));
    err.status = res.status;
    throw err;
  }
  return res;
}

export async function interact(key, body) {
  const res = await apiFetch(key, "/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Resumable upload to the Files API; waits until the file is ACTIVE. */
export async function uploadFile(key, filePath, mimeType, displayName = "video-editor") {
  const size = statSync(filePath).size;
  const start = await apiFetch(key, "/upload/v1beta/files", {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Files API did not return an upload URL");
  const done = await apiFetch(key, uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: readFileSync(filePath),
  });
  let file = (await done.json()).file;
  for (let i = 0; file.state && file.state !== "ACTIVE" && i < 120; i++) {
    if (file.state === "FAILED") throw new Error(`Gemini could not process ${filePath}`);
    await new Promise((r) => setTimeout(r, 2000));
    file = await (await apiFetch(key, `/v1beta/${file.name}`)).json();
  }
  return file; // { name, uri, mimeType, state }
}

export async function deleteFile(key, name) {
  try { await apiFetch(key, `/v1beta/${name}`, { method: "DELETE" }); } catch { /* auto-deleted after 48h anyway */ }
}

/** All content blocks the model produced (model_output steps), in order. */
export function outputBlocks(interaction) {
  const blocks = [];
  for (const step of interaction.steps || []) {
    if (step.type && step.type !== "model_output") continue;
    for (const c of step.content || []) blocks.push(c);
  }
  if (!blocks.length && Array.isArray(interaction.outputs)) blocks.push(...interaction.outputs);
  return blocks;
}

export function parseArgs(argv, { flags = [], multi = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const name = a.slice(2);
    if (flags.includes(name)) { out[name] = true; continue; }
    const val = argv[++i];
    if (val === undefined) throw new Error(`--${name} needs a value`);
    if (multi.includes(name)) (out[name] ||= []).push(val);
    else out[name] = val;
  }
  return out;
}

export const AUDIO_MIME = {
  ".mp3": "audio/mp3", ".wav": "audio/wav", ".m4a": "audio/m4a", ".aac": "audio/aac",
  ".ogg": "audio/ogg", ".flac": "audio/flac", ".opus": "audio/opus", ".webm": "audio/webm",
  ".aiff": "audio/aiff",
};
