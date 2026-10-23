#!/usr/bin/env python3
"""Transcribe audio chunks with MoulSot (atlasia/moulsot.v0.3), the open Darija ASR model.

Usage: python3 moulsot_chunks.py chunk_000.wav chunk_001.wav ...
Prints JSON to stdout: {"backend": "...", "texts": ["...", ...]} (one text per chunk, same order).

Backends, tried in order:
  1. mlx-audio  (Apple Silicon Macs)  ->  pip install mlx-audio
  2. qwen_asr   (NVIDIA GPU, or CPU - slow)  ->  pip install qwen_asr
Exit code 3 = no backend installed (the caller falls back to Gemini).
"""
import json
import sys

MODEL = "atlasia/moulsot.v0.3"


def with_mlx(paths):
    from mlx_audio.stt.utils import load
    model = load(MODEL)
    return "mlx-audio", [model.generate(p).text.strip() for p in paths]


def with_qwen(paths):
    import torch
    from qwen_asr import Qwen3ASRModel
    if torch.cuda.is_available():
        device, dtype = "cuda", "bfloat16"
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        device, dtype = "mps", "float16"
    else:
        device, dtype = "cpu", "float32"
    model = Qwen3ASRModel.from_pretrained(MODEL, dtype=dtype, device_map=device)
    texts = []
    for p in paths:
        r = model.transcribe(audio=p, language="Arabic")
        r = r[0] if isinstance(r, list) else r
        texts.append((getattr(r, "text", None) or str(r)).strip())
    return f"qwen_asr-{device}", texts


def main():
    paths = sys.argv[1:]
    if not paths:
        sys.exit("usage: moulsot_chunks.py <chunk.wav>...")
    errors = []
    for runner in (with_mlx, with_qwen):
        try:
            backend, texts = runner(paths)
            print(json.dumps({"backend": backend, "model": MODEL, "texts": texts}, ensure_ascii=False))
            return
        except ImportError as e:
            errors.append(f"{runner.__name__}: not installed ({e.name})")
        except Exception as e:  # model download / runtime failure: report, let caller fall back
            print(json.dumps({"error": f"{runner.__name__}: {type(e).__name__}: {e}"}), file=sys.stderr)
            sys.exit(1)
    print("MOULSOT_UNAVAILABLE: " + "; ".join(errors) +
          "\nInstall on a Mac with Apple Silicon: pip install mlx-audio  (or: pip install qwen_asr)", file=sys.stderr)
    sys.exit(3)


if __name__ == "__main__":
    main()
