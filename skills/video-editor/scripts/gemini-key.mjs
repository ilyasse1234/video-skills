#!/usr/bin/env node
// Manage the user's Gemini API key for the video-editor skill.
//   status          -> prints CONFIGURED (+ source, masked key) or MISSING (exit 2)
//   save            -> reads the key from stdin (or --key), validates it, stores it (chmod 600)
//   test            -> checks the configured key against the API
//   remove          -> deletes the saved key file
//   export          -> prints `export GEMINI_API_KEY=...` for eval in a shell (never echo this to the user)
import { mkdirSync, writeFileSync, chmodSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { findKey, KEY_FILE, GET_KEY_URL, EXIT_NO_KEY, mask, apiFetch, parseArgs } from "./lib/gemini.mjs";

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || "status";

async function validate(key) {
  try {
    await apiFetch(key, "/v1beta/models?pageSize=1");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

if (cmd === "status") {
  const f = findKey();
  if (!f) {
    console.log(`MISSING - no Gemini API key. Get one free at ${GET_KEY_URL}`);
    process.exit(EXIT_NO_KEY);
  }
  console.log(`CONFIGURED - ${mask(f.key)} (from ${f.source})`);
} else if (cmd === "save") {
  const key = (args.key || (await readStdin())).trim();
  if (!/^[A-Za-z0-9_\-]{20,}$/.test(key)) {
    console.error("That does not look like a Gemini API key (expected a long string, usually starting with AIza).");
    process.exit(1);
  }
  const v = await validate(key);
  if (!v.ok) {
    console.error(`Key rejected by Gemini: ${v.error}`);
    process.exit(1);
  }
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, `GEMINI_API_KEY=${key}\n`, { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
  console.log(`SAVED - key ${mask(key)} verified and stored in ${KEY_FILE}`);
} else if (cmd === "test") {
  const f = findKey();
  if (!f) { console.log("MISSING"); process.exit(EXIT_NO_KEY); }
  const v = await validate(f.key);
  console.log(v.ok ? `OK - ${mask(f.key)} works` : `INVALID - ${v.error}`);
  process.exit(v.ok ? 0 : 1);
} else if (cmd === "remove") {
  if (existsSync(KEY_FILE)) unlinkSync(KEY_FILE);
  console.log("REMOVED");
} else if (cmd === "export") {
  const f = findKey();
  if (!f) process.exit(EXIT_NO_KEY);
  process.stdout.write(`export GEMINI_API_KEY='${f.key}'\n`);
} else {
  console.error("usage: gemini-key.mjs status|save|test|remove|export");
  process.exit(1);
}
