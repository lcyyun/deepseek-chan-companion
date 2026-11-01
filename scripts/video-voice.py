"""Generate ordinary Edge TTS narration clips plus lossless editing audio.

python scripts/video-voice.py input.json output/directory
Input: {"voice":"zh-CN-XiaoyiNeural","rate":"+6%","pitch":"+8Hz",
        "segments":[{"id":"intro","text":"你好。"}]}
This does not clone a voice or call any configured companion provider.
Requires edge-tts >= 7.3.1 for the current service protocol, plus ffmpeg.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import re
import shutil
import subprocess

import edge_tts


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr[-3000:])
    return result.stdout


async def synthesize(spec: dict, directory: Path, defaults: dict) -> dict:
    name = str(spec["id"])
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", name):
        raise ValueError(f"Unsafe segment id: {name}")
    text = str(spec["text"]).strip()
    if not text:
        raise ValueError(f"Empty text: {name}")
    voice = spec.get("voice", defaults.get("voice", "zh-CN-XiaoyiNeural"))
    rate = spec.get("rate", defaults.get("rate", "+6%"))
    pitch = spec.get("pitch", defaults.get("pitch", "+8Hz"))
    volume = spec.get("volume", defaults.get("volume", "+0%"))
    mp3 = directory / f"{name}.mp3"
    wav = directory / f"{name}.wav"
    boundaries: list[dict] = []
    for attempt in range(3):
        try:
            communicator = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume,
                                              boundary="SentenceBoundary", receive_timeout=60)
            boundaries = []
            with mp3.open("wb") as target:
                async for item in communicator.stream():
                    if item["type"] == "audio":
                        target.write(item["data"])
                    elif item["type"] in ("WordBoundary", "SentenceBoundary"):
                        boundaries.append({"text": item["text"], "start": item["offset"] / 10_000_000,
                                           "duration": item["duration"] / 10_000_000})
            if mp3.stat().st_size < 1000:
                raise RuntimeError(f"No usable audio: {name}")
            break
        except Exception:
            if attempt == 2:
                raise
            await asyncio.sleep(1 + attempt * 2)
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(mp3),
         "-af", "highpass=f=65,loudnorm=I=-18:TP=-1.5:LRA=7", "-ar", "48000", "-ac", "1",
         "-c:a", "pcm_s16le", str(wav)])
    duration = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=noprint_wrappers=1:nokey=1", str(wav)]).strip())
    return {**spec, "voice": voice, "rate": rate, "pitch": pitch, "volume": volume,
            "mp3": str(mp3.resolve()), "wav": str(wav.resolve()), "duration": duration,
            "boundaries": boundaries}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("ffmpeg and ffprobe must be available on PATH")
    payload = json.loads(args.input.read_text(encoding="utf-8-sig"))
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for spec in payload["segments"]:
        result = await synthesize(spec, args.output, payload)
        results.append(result)
        print(json.dumps({"id": result["id"], "voice": result["voice"], "duration": result["duration"]}, ensure_ascii=False), flush=True)
        (args.output / "manifest.json").write_text(json.dumps({"engine": "edge-tts", "segments": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Written {len(results)} segments: {(args.output / 'manifest.json').resolve()}")


if __name__ == "__main__":
    asyncio.run(main())
