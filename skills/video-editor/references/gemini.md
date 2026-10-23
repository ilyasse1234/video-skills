# Gemini reference for video-editor

All calls go to the Gemini Developer API (`generativelanguage.googleapis.com`, Interactions API)
with the user's own key. Scripts need Node 18+; `ffmpeg`/`ffprobe` are used for audio
extraction, chunking, format conversion and green-screen keying.

## Transcription - `gemini-transcribe.mjs`

- Model: `gemini-3.5-transcribe` (override with `--model`). Verbatim mode with word-level
  timestamps; `--speakers` adds diarization (up to 8 speakers).
- Audio is extracted to mono 16 kHz MP3 first, uploaded via the Files API, and the upload is
  deleted afterwards (Google also auto-deletes after 48 h).
- Word timestamps are limited to 30 min per request, so files longer than 25 min are split
  and re-timed automatically - the output timeline is continuous.
- Languages: 85+ with automatic detection and code-switching. Leave `--lang` empty for
  Moroccan Darija or mixed Arabic/French/English. Pass a BCP-47 code (`fr-FR`, `en-US`,
  `es-ES`, `ar-EG`…) only when the language is certain.
- Output: `<out>.json` (word array), `<out>.txt` (clean text), `<out>.srt` with `--srt`
  (cues of up to 7 words / 3 s, split at punctuation).

## Images - `gemini-image.mjs`

| `--model` | Model ID | Use for |
|---|---|---|
| default / `nb2` | `gemini-nano-banana-2.1` | Most images and graphics, good text rendering, 1K-4K |
| `lite` | `gemini-3.1-flash-lite-image` | Fast cheap drafts (1K only) |
| `pro` | `gemini-3-pro-image` | Hero visuals, heavy text, strict brand consistency |
| any other value | used as-is | New models as Google releases them |

- `--aspect`: `1:1 3:2 2:3 3:4 4:3 4:5 5:4 9:16 16:9 21:9`. `--size`: `1K 2K 4K`.
- `--ref`: reference images (logo, product, person, style). Gemini keeps them consistent.
- `--transparent`: generated on pure green, then keyed out with ffmpeg to an RGBA PNG.
  Avoid green in the subject; if edges show a green fringe, regenerate with a different
  subject colour or describe "no green tones".
- `--search`: grounds the image in Google Search for real, current information.
- `--thinking high`: more reasoning for complex layouts (slower).
- All Gemini images carry an invisible SynthID watermark.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Exit code 2 / `GEMINI_KEY_MISSING` | Ask the user for a key, save it (`SKILL.md` §5) |
| `403` / `API key not valid` | Key wrong, revoked, or API not enabled → `gemini-key.mjs test`, ask for a new key |
| `429` / quota | Free-tier limit hit - wait a minute, or the user enables billing in AI Studio |
| `400` on a model ID | Model renamed - check https://ai.google.dev/gemini-api/docs/models and pass `--model <new-id>` |
| Region error | The Gemini API isn't available in the user's country - use local tools only |
| Empty transcript | No speech detected, or audio is silent/music only - check the source audio |

## Darija route - `darija-transcribe.mjs`, `moulsot_chunks.py`, `darija-to-captions.mjs`

- Audio is cut into 10-30 s chunks at the longest pause in range (`silencedetect -35 dB, 0.3 s`),
  never inside a word; a hard cut only happens when there is no pause at all, and is warned about.
- `--engine auto` (default): MoulSot (`atlasia/moulsot.v0.3`, Apache 2.0, fine-tuned from
  Qwen3-ASR for Darija) via `mlx-audio` on Apple Silicon or `qwen_asr` elsewhere; Gemini
  (`gemini-3.8-flash`, override `--model`) when MoulSot is missing or fails.
- The Gemini prompt enforces Arabic script for Darija/MSA and Latin script for French/English,
  verbatim fillers and repetitions, 2-5 s clauses, Arabic-script pronunciation aliases for
  numbers and Latin words, and a language tag per Latin word. Mixed segments become `spans`
  so French runs are timed with the French model and English runs with the English one.
- Clause times outside the chunk or out of order are discarded and the chunk is used as one
  segment (alignment searches the whole window anyway).
- Timing itself always comes from `darija-word-captions/scripts/align_words.py` (WhisperX
  CTC forced alignment). `darija-to-captions.mjs` never invents a time for an unaligned word.
