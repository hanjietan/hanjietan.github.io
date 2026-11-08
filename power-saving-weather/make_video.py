"""Generate an isolated low-rate keep-awake candidate; no download or install."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()
    executable = args.ffmpeg or shutil.which("ffmpeg")
    if not executable:
        try:
            import imageio_ffmpeg
            executable = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            raise SystemExit("Supply an existing ffmpeg executable with --ffmpeg")
    target = ROOT / "assets/keep-awake-1fps-60s.mp4"
    command = [executable, "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
               "-i", "color=c=black:s=16x16:r=1:d=60", "-an", "-c:v", "libx264",
               "-profile:v", "baseline", "-level:v", "1.0", "-pix_fmt", "yuv420p",
               "-r", "1", "-t", "60", "-g", "60", "-keyint_min", "60",
               "-sc_threshold", "0", "-bf", "0", "-x264-params", "cabac=0:ref=1:bframes=0",
               "-tag:v", "avc1", "-video_track_timescale", "90000", "-movflags", "+faststart", str(target)]
    subprocess.run(command, check=True, capture_output=True)
    payload = target.read_bytes()
    media = {"src": "data:video/mp4;base64," + base64.b64encode(payload).decode("ascii"),
             "width": 16, "height": 16, "fps": 1, "durationSeconds": 60, "audio": False}
    (ROOT / "keep-awake-media.js").write_text(
        "/* Generated black video: 16x16, H.264 Baseline, 1fps, 60s, no audio. */\n"
        "(function(root){\"use strict\";root.PowerSavingMedia=" + json.dumps(media, separators=(",", ":")) +
        ";}(this));\n", encoding="utf-8")
    report = {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
              "encoder": "libx264", "profile": "Baseline", "level": "1.0",
              "pixelFormat": "yuv420p", "width": 16, "height": 16, "fps": 1,
              "durationSeconds": 60, "audio": False, "command": command}
    (ROOT / "video-build.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "command"}, indent=2))


if __name__ == "__main__":
    main()
