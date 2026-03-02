import asyncio
import argparse
from loguru import logger

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
