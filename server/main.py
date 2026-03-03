import asyncio
import argparse
import os
import site
from loguru import logger

# On Windows, ctranslate2 uses plain LoadLibrary() which searches PATH, not the
# add_dll_directory() list. Add nvidia pip-package bin dirs to PATH before any CUDA load.
for _sp in site.getsitepackages():
    _nvidia = os.path.join(_sp, "nvidia")
    if os.path.isdir(_nvidia):
        for _pkg in os.listdir(_nvidia):
            _bin = os.path.join(_nvidia, _pkg, "bin")
            if os.path.isdir(_bin) and _bin not in os.environ.get("PATH", ""):
                os.environ["PATH"] = _bin + os.pathsep + os.environ.get("PATH", "")

from tutor_pipeline import run_tutor_pipeline


def parse_args():
    parser = argparse.ArgumentParser(description="Elena — Russian Language Tutor")
    parser.add_argument("--host", default="0.0.0.0", help="Server host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port (default: 8765)")
    parser.add_argument("--cpu-stt", action="store_true", help="Run Whisper on CPU instead of CUDA")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    stt_device = "cpu" if args.cpu_stt else "cuda"
    logger.info(f"Starting Elena tutor server on ws://{args.host}:{args.port} (STT device: {stt_device})")
    asyncio.run(run_tutor_pipeline(host=args.host, port=args.port, stt_device=stt_device))
