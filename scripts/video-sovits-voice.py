"""Render a video narration manifest through a local GPT-SoVITS v4 API.

The supplied model and reference must already be configured locally.
No remote credentials, uploads or changes to the companion app are used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request
import urllib.error
from urllib.parse import urlparse
import wave


def sentences(text: str) -> list[str]:
    """Keep short exclamations with a neighbour so the model has context."""
    parts = [value for value in re.findall(r"[^。！？!?]+[。！？!?]?", text) if value.strip()]
    groups: list[str] = []
    pending = ""
    for part in parts:
        pending += part
        if len(pending) >= 9:
            groups.append(pending)
            pending = ""
    if pending:
        if groups:
            groups[-1] += pending
        else:
            groups.append(pending)
    return groups


def command(args: list[str]) -> str:
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr[-2500:])
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:9881")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--reference-text", required=True)
    parser.add_argument("--reference-language", default="zh")
    parser.add_argument("--speed", type=float, default=1.03)
    parser.add_argument("--only", help="Comma-separated segment IDs for an initial listening check")
    args = parser.parse_args()
    if urlparse(args.url).hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("This runner only sends reference paths to a local TTS API")
    reference = args.reference.resolve(strict=True)
    project = json.loads(args.input.read_text(encoding="utf-8-sig"))
    args.output.mkdir(parents=True, exist_ok=True)
    chunks_dir = args.output / "chunks"
    chunks_dir.mkdir(exist_ok=True)
    manifest = {"engine": "GPT-SoVITS-v4", "reference": str(reference), "segments": []}
    for index, segment in enumerate(project["segments"]):
        name = segment["id"]
        if args.only and name not in args.only.split(","):
            continue
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", name):
            raise ValueError(f"Unsafe segment id: {name}")
        payload = {"text_lang": "zh", "ref_audio_path": str(reference),
                   "prompt_text": args.reference_text, "prompt_lang": args.reference_language,
                   "top_k": 15, "top_p": 1, "temperature": 0.85, "text_split_method": "cut5",
                   "batch_size": 1, "speed_factor": args.speed, "fragment_interval": 0.26,
                   "seed": 20261101 + index, "parallel_infer": False, "repetition_penalty": 1.35,
                   "sample_steps": 32, "super_sampling": False, "streaming_mode": False,
                   "media_type": "wav"}
        raw = args.output / f"{name}.raw.wav"
        wav = args.output / f"{name}.wav"
        mp3 = args.output / f"{name}.mp3"
        pieces = sentences(segment["text"])
        boundaries = []
        position = 0
        with wave.open(str(raw), "wb") as joined:
            joined.setnchannels(1)
            joined.setsampwidth(2)
            joined.setframerate(48000)
            for sentence_index, sentence in enumerate(pieces):
                body = json.dumps({**payload, "text": sentence}, ensure_ascii=False).encode("utf-8")
                signature = hashlib.sha256(body).hexdigest()
                chunk = chunks_dir / f"{name}-{sentence_index:02d}-{signature[:10]}.wav"
                normalized = chunk.with_suffix(".pcm.wav")
                if not chunk.exists():
                    request = urllib.request.Request(args.url.rstrip("/") + "/tts", data=body,
                                                     headers={"Content-Type": "application/json"})
                    try:
                        with urllib.request.urlopen(request, timeout=600) as response:
                            audio = response.read()
                    except urllib.error.HTTPError as error:
                        raise RuntimeError(error.read().decode("utf-8", errors="replace")) from error
                    if not audio.startswith(b"RIFF") or len(audio) < 1000:
                        raise RuntimeError(f"TTS returned no usable WAV for {name}: {audio[:100]!r}")
                    chunk.write_bytes(audio)
                command(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(chunk),
                         "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", str(normalized)])
                with wave.open(str(normalized), "rb") as source:
                    count = source.getnframes()
                    joined.writeframes(source.readframes(count))
                boundaries.append({"text": sentence, "start": position / 48000,
                                   "duration": count / 48000})
                position += count
                if sentence_index < len(pieces) - 1:
                    silence = round(0.16 * 48000)
                    joined.writeframes(b"\0\0" * silence)
                    position += silence
                print(json.dumps({"id": name, "sentence": sentence_index + 1,
                                  "duration": count / 48000}, ensure_ascii=False), flush=True)
        command(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw),
                 "-af", "highpass=f=65,loudnorm=I=-18:TP=-1.5:LRA=7", "-ar", "48000",
                 "-ac", "1", "-c:a", "pcm_s16le", str(wav)])
        command(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                 "-c:a", "libmp3lame", "-b:a", "192k", str(mp3)])
        duration = float(command(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                  "-of", "default=noprint_wrappers=1:nokey=1", str(wav)]).strip())
        item = {**segment, "voice": "user-selected-shigeju-v4", "wav": str(wav.resolve()),
                "mp3": str(mp3.resolve()), "duration": duration, "boundaries": boundaries,
                "boundarySource": "independently generated sentence audio frames"}
        manifest["segments"].append(item)
        (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"id": name, "duration": duration}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
