---
name: video-editor
description: Start here for any video job - edit, cut, caption, subtitle, transcribe, animate, add images or graphics, make Reels/Shorts/TikToks, explainers, ads or slideshows, including Moroccan Darija and mixed Darija-French-English videos. Routes to the HyperFrames, Remotion, media and Darija caption skills, and adds Gemini as a fallback for transcription and as the engine for AI images and graphics (asks the user for their Gemini API key when needed).
---

# Video editor

The entry point for every video request. It decides which skill does the work, keeps the
user's Gemini key set up, and guarantees transcription never dead-ends.

`<SKILL_DIR>` below means the folder this file is in; `<SKILLS_ROOT>` is its parent folder,
where the other skills of this collection are installed.

## 1. Route the job

| The user wants | Use |
|---|---|
| Make, edit, animate or render a video (default engine) | `/hyperframes` (+ `/hyperframes-cli` for commands) |
| Ready-made titles, transitions, captions, charts, overlays | `/hyperframes-registry` |
| Music, sound effects, voiceover, footage, colour grading, transcripts | `/media-use` |
| A slideshow / presentation video | `/slideshow` |
| An existing Remotion project, or the user asks for Remotion | `/remotion-best-practices` (routes to the `remotion-*` skills) |
| Move a Remotion project to HyperFrames | `/remotion-to-hyperframes` |
| Captions / transcription for **Darija** or mixed Darija-French-English speech | **Section 3A below** (uses `/darija-word-captions`) |
| Transcription that failed locally (other languages) | **Section 3 below** |
| AI images, illustrations, icons, backgrounds, thumbnails, infographics | **Section 4 below** |
| Sound effects on graphics, titles, transitions | **Section 4B below** (sounds from `/media-use`) |

Read the routed skill's `SKILL.md` before working. This skill only adds the rules below.

## 2. First-run check (once per machine)

At the start of the first video job, run:

```bash
node <SKILL_DIR>/scripts/gemini-key.mjs status
```

- `CONFIGURED` → carry on silently.
- `MISSING` (exit 2) → ask the user **once**, in one short message:

  > To unlock AI images & graphics for your videos, and a backup transcription when the local one fails, paste your **Gemini API key** (free at https://aistudio.google.com/apikey). Or say "skip" to continue without it.

  If they paste a key, save it (section 5). If they skip, don't ask again this session -
  only when a step actually needs Gemini (sections 3 and 4).

Also confirm the basics exist: `node -v` (18+), `ffmpeg -version`. Install what's missing
before rendering (`brew install ffmpeg node` on macOS).

## 3. Transcription (other languages): local first, Gemini as fallback

1. **Always try local first** (free, private): the `/media-use` transcription path
   (`scripts/transcribe.mjs`, Parakeet) or `npx hyperframes transcribe <file> --json` with an
   explicit `--model` (see `/media-use` → `audio/references/transcribe.md`).
2. **Treat it as failed** when any of these happen:
   - the command errors, crashes, times out, or the model can't be installed;
   - the output is empty or has almost no words for audio that clearly has speech;
   - the text is wrong language / translated into English / gibberish / repeats itself
     (heavy music or noise; if the speech turns out to be Darija, switch to section 3A);
   - the user says the subtitles are wrong.
3. **On failure, switch to Gemini:**
   ```bash
   node <SKILL_DIR>/scripts/gemini-key.mjs status
   ```
   - `MISSING` → tell the user in one line what failed, then ask:
     > Local transcription didn't work for this video. Paste your **Gemini API key** (free at https://aistudio.google.com/apikey) and I'll transcribe it with Gemini instead.

     Wait for the key, save it (section 5), then continue.
   - `CONFIGURED` → run:
     ```bash
     node <SKILL_DIR>/scripts/gemini-transcribe.mjs <video-or-audio> --out assets/transcript.json --srt
     ```
     Options: `--lang fr-FR` (or `ar-EG`, `en-US`… comma-separated; omit to auto-detect
     for code-switching), `--speakers` for speaker labels.
4. The output is the **same word array** HyperFrames captions use
   (`[{id,text,start,end}]`), plus `.txt` and `.srt` - continue the caption workflow exactly
   as if local transcription had worked. Long files are split and re-timed automatically.
5. Run the normal caption-quality checks from `/hyperframes` on the result. Tell the user in
   one line that Gemini was used.

## 3A. Darija and code-switched speech (Moroccan Darija + French/English/MSA)

Standard models translate Darija into English, write it in Latin letters, or mis-time
French and English words. For any Darija or mixed video, use this route instead of section 3.
It writes the words first, then times every word acoustically with
`/darija-word-captions` (WhisperX forced alignment: Arabic + French + English models).

**One-time setup** (check, install what's missing, tell the user what you installed):
- Alignment (required for this route): `python3 -c "import whisperx"` → else
  `pip install whisperx==3.8.6`. First run downloads the alignment models (~1-2 GB, cached).
- Local Darija speech-to-text, free (optional): MoulSot (`atlasia/moulsot.v0.3`).
  Apple Silicon Mac: `pip install mlx-audio`. NVIDIA GPU: `pip install qwen_asr`.

**Steps**
1. Transcribe (MoulSot locally first, Gemini if MoulSot is missing or fails):
   ```bash
   node <SKILL_DIR>/scripts/darija-transcribe.mjs <video> --out captions
   ```
   - Exit 2 / `GEMINI_KEY_MISSING` → MoulSot isn't available and there's no key: ask for the
     Gemini key exactly as in section 3 step 3, save it (section 5), run again.
   - `--engine gemini` forces Gemini (better at tagging French vs English words and writing
     pronunciation aliases); `--engine moulsot` forces local only. `--latin fr` if the
     speaker's Latin words are mostly French.
   - Output: `captions/transcript.json` (+ `audio.wav`, `uncertain.json`). Darija stays in
     Arabic script, French/English stay in Latin letters - never translated or transliterated.
2. Review `transcript.json` before aligning: fix names and brand spellings, re-check every
   window in `uncertain.json`. If the output lists `needs_alias`, add each token to `aliases`
   with how it sounds in Arabic script (e.g. `"24": "ربعة وعشرين"`). MoulSot gives no aliases:
   add them for numbers and for English/French loanwords said with a Darija accent.
3. Align (times every word from the audio):
   ```bash
   python3 <SKILLS_ROOT>/darija-word-captions/scripts/align_words.py captions/transcript.json --out captions
   ```
   Fix every entry in `captions/issues.json` (usually wrong transcript text), then re-run.
4. Convert to the caption word array used by HyperFrames/Remotion:
   ```bash
   node <SKILL_DIR>/scripts/darija-to-captions.mjs captions/words.json --out assets/transcript.json --srt
   ```
   Untimed words are left out and listed, never given guessed times.
5. Render with the display rules from `/darija-word-captions` step 5: right-to-left line
   container, consecutive Latin words grouped in one `<bdi dir="ltr">`, same clock as the video.
6. Tell the user whether a human has listened to the result; automated checks don't prove
   every word is right.

**If WhisperX can't be installed** (old Python, no disk space): fall back to section 3 with
`gemini-transcribe.mjs <video> --out assets/transcript.json --srt` (no `--lang`, so it
auto-detects Darija), and warn the user the timing is less precise on mixed-language words.

## 4. AI images and graphics (Gemini)

Use Gemini whenever the video needs a visual that doesn't exist yet: B-roll stills,
backgrounds, illustrations, icons, stickers, product/scene mockups, infographics,
thumbnails, title cards with designed text. Real things (the client's logo, product,
face, place) come from their real source - use them as `--ref` images, never invent them.

1. `node <SKILL_DIR>/scripts/gemini-key.mjs status` → if `MISSING`, ask:
   > To generate the images and graphics for this video I need your **Gemini API key** (free at https://aistudio.google.com/apikey). Paste it here - or say "skip" and I'll build the graphics with code and free assets instead.

   On "skip", fall back to HTML/CSS/SVG graphics and `/media-use` free sources.
2. Generate:
   ```bash
   node <SKILL_DIR>/scripts/gemini-image.mjs "<detailed prompt>" --out assets/images/<name>.png --aspect 9:16 --size 2K
   ```
   - Match `--aspect` to where it goes: `9:16` Reels/Shorts/TikTok, `16:9` YouTube, `1:1` or `4:5` feed.
   - `--transparent` for logos, stickers, icons, cut-out objects to overlay (PNG with alpha).
   - `--ref <file>` (repeatable, up to ~10) to keep a brand, logo, product or person consistent.
   - `--model pro` for hero visuals with lots of text or brand precision; `--model lite` for quick drafts.
   - `--search` for graphics showing real, current data (prices, weather, news).
3. Write prompts like an art director: subject, style, palette (use the brand colours),
   lighting, composition, empty space for captions, and exact text in quotes.
4. **Look at every image before using it** (open it). Regenerate if text is misspelled,
   hands/faces are off, or it clashes with the brand. Keep generated files in
   `assets/images/` and reference them from the composition.
5. Each image costs a few cents on the user's Google account - generate what the edit
   needs, not dozens of variations, unless they ask.

## 4B. Sound design for graphics

Every graphic you add (title card, lower third, icon, sticker, chart, logo, image pop-in,
transition) gets a matching sound effect, unless the user asked for silence or for music only.
Sounds come from `/media-use` (Openverse, free CC0/CC BY sounds, or the bundled offline library
in `media-use/audio/assets/sfx/` - read its `manifest.json` for durations and placement hints).
Never generate sound effects.

**Match the sound to the motion**

| Graphic does | Sound (bundled name) |
|---|---|
| Icon, sticker, badge, chip pops in | `pop` |
| Title or lower third slides / swipes in | `whoosh-short` |
| Fast hard reveal, punchy transition | `whoosh` |
| Scene-to-scene sweep | `whoosh-cinematic` (swell peaks on the cut) |
| Logo or headline lands | `impact-bass-1`; with build-up: `riser` → `impact-bass-1` |
| Text typed on screen | `typing` (or `key-press` per character for short words) |
| Highlight, shine, "magic" reveal | `sparkle` |
| Number / data point / stat appears | `ping` |
| Notification, message, toast appears | `notification` |
| Success, checkmark, positive beat | `chime` |
| Wrong / error / red cross | `error` |
| Glitch or digital cut | `glitch-1` (subtle: `glitch-3`) |
| Button / UI tap | `click` (quiet: `click-soft`) |

For anything else, search Openverse with a concrete name ("paper slide", "camera shutter",
"cash register"), not a vague one ("cool sound").

**Timing - sync to the frame**
- Start each accent on the exact frame the animation starts (pop, click, whoosh) or lands
  (impact). Read the time from the composition's own animation timing, not by eye.
- Build-ups end on the hit: start a `riser` at `reveal − 10.03 s` (shorter: trim its start),
  `whoosh-cinematic` so its swell peaks on the cut, `impact-bass-2` so its peak lands on the reveal.
- Keep every effect on the same clock as the video: if you trim or speed up the edit, move the sounds too.

**Taste**
- Not every movement: sound the moments that matter (entrances, reveals, transitions), skip
  idle loops, small drifts and exits unless they're a feature.
- No two identical sounds back to back within ~1 s; alternate (`whoosh` / `whoosh-short`) or drop one.
- Several elements popping together = one sound, not a stack.
- SFX sit under voice and music: about 0.35 volume, a bit lower under speech. Put them in
  their own `sfx` audio group (see `/media-use` → `references/mixing.md`); in Remotion,
  follow `/remotion-markup` → `sfx.md`.

**Credits** - keep `assets/sfx/CREDITS.md` with the project and tell the user to include
the CC BY credits wherever the video is published.

**Check** - before delivering, play every sound moment in the preview and confirm each one
hits its visual. Tell the user which effects you used and where.

## 5. Handling the key

- Save what the user pastes, without echoing it back:
  ```bash
  printf '%s' '<KEY>' | node <SKILL_DIR>/scripts/gemini-key.mjs save
  ```
  It validates the key with Google, then stores it in `~/.config/video-skills/gemini.env`
  (owner-only permissions). `SAVED` = done; anything else = tell the user the key was
  rejected and ask for a new one.
- Users who prefer not to paste keys in chat can run that command themselves, or
  `export GEMINI_API_KEY=...` in their shell profile - the scripts read env vars first.
- Other skills (e.g. `/media-use` Gemini voiceover or Lyria music) read `GEMINI_API_KEY`
  from the environment. Make the saved key available to them with
  `eval "$(node <SKILL_DIR>/scripts/gemini-key.mjs export)"` in the same command.
- Never print, log, commit or write the key into project files. Never put it in a URL.
- `gemini-key.mjs test` checks a key; `gemini-key.mjs remove` deletes it.

## Reference

`references/gemini.md` - models, limits, languages, costs and troubleshooting.
