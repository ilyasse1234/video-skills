# video-skills

The complete AI video-editing toolkit for coding agents (Claude Code, Codex, Cursor, and any agent that reads `SKILL.md` skills).
Ask your agent things like *"turn this interview into a 30-second Reel with animated captions"* and it edits, captions, designs and renders the video for you.

- **HyperFrames** (HTML → video) and **Remotion** (React → video) engines
- Captions and transcription: **local first** (free, private), with **Gemini** as an automatic fallback when local transcription fails
- **Moroccan Darija** word-by-word captions, even when the speaker switches to French or English mid-sentence: Darija stays in Arabic script, French/English in Latin letters, every word timed from the audio
- **AI images and graphics** with Gemini (Nano Banana): backgrounds, icons, stickers, thumbnails, infographics, transparent PNGs
- **Sound effects synced to every graphic** (pop, whoosh, riser → impact, typing…), free and licence-safe, plus music, voiceover, colour grading and slideshows

Start every video job with the **`video-editor`** skill: it routes to the right tool and handles the Gemini setup.

## Requirements

| Tool | Why | Install (macOS) |
|---|---|---|
| Node.js 18+ | Runs HyperFrames, Remotion and the scripts | `brew install node` |
| FFmpeg | Audio/video processing | `brew install ffmpeg` |
| HyperFrames CLI | Rendering, transcription | your agent installs it on first use (see the `hyperframes` skill) |
| Python 3.10+ and WhisperX *(for Darija captions)* | Times every word from the audio | `brew install python` then `pip install whisperx==3.8.6` |
| MoulSot *(optional, Darija)* | Free local Darija speech-to-text | Apple Silicon: `pip install mlx-audio` |
| Gemini API key *(optional)* | AI images and graphics, backup transcription, Gemini voiceover and music | free at https://aistudio.google.com/apikey |

You don't need to set up the Gemini key yourself: the agent asks for it the first time it's needed and stores it in `~/.config/video-skills/gemini.env`. To set it manually:

```bash
export GEMINI_API_KEY="your-key"   # add to ~/.zshrc to keep it
```

## Install

```bash
git clone https://github.com/ilyasse1234/video-skills.git
cp -R video-skills/skills/* ~/.agents/skills/      # shared folder used by most agents
# or, for Claude Code only:
cp -R video-skills/skills/* ~/.claude/skills/
```

Update later with `cd video-skills && git pull`, then copy again.

## Skills

| Skill | What it does |
|---|---|
| `video-editor` | **Start here.** Routes any video job to the right skill, handles Darija captions, Gemini transcription fallback, AI images/graphics and sound design |
| `darija-word-captions` | Word-by-word captions synced to Darija / Arabic / French / English speech with local forced alignment (WhisperX + wav2vec2) |
| `hyperframes` | Read first to make, edit, animate or render any video with HyperFrames (HTML rendered to video), including launch films, explainers, music videos, cha |
| `hyperframes-cli` | The HyperFrames CLI by job - scaffold, check, look at frames, edit the timeline, preview, render locally or in the cloud, publish, project history - p |
| `hyperframes-registry` | About 450 ready-made HyperFrames blocks and components installed as editable source - transitions, overlays, titles, kinetic type, captions, charts, m |
| `remotion-to-hyperframes` | Bring existing video code or footage into HyperFrames and verify it frame by frame against the original - Remotion first, also Motion Canvas, Lottie,  |
| `media-use` | Get or make any media for a HyperFrames video - music, sound effects, images, icons, logos, voiceover, avatar and generated video, transcripts, cutout |
| `slideshow` | Build a HyperFrames slideshow to present live - slides, fragment reveals, branching hotspots and presenter mode with speaker notes, served by `hyperfr |
| `remotion-best-practices` | Router for all Remotion skills |
| `remotion-captions` | Transcribing, displaying and animating captions |
| `remotion-create` | Create a new Remotion video |
| `remotion-docs` | Search Remotion documentation |
| `remotion-interactivity` | Structure Remotion markup for interactivity |
| `remotion-maps` | Remotion Map animation knowledge |
| `remotion-markup` | Content, animation and effects best practices |
| `remotion-multimedia` | Interacting with Mediabunny |
| `remotion-render` | Export a Remotion video |
| `remotion-saas` | Build an app with Remotion |
| `remotion-studio` | Preview a Remotion video |
| `remotion-upgrade` | Upgrade Remotion, and related packages |

## Credits

HyperFrames and Remotion skills come from their original authors' official skill sets; rights remain with them. `darija-word-captions` is by [benmouad-ai](https://github.com/benmouad-ai/darija-word-captions) (MIT License, included in its folder). The `video-editor` skill (routing, Gemini transcription fallback and Gemini image generation) and the Darija route (MoulSot / Gemini transcription feeding the alignment) were added for this collection.
