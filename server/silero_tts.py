import io
import numpy as np
import torch
from loguru import logger

from pipecat.frames.frames import Frame, StartFrame, TTSAudioRawFrame
from pipecat.services.tts_service import TTSService


class SileroTTSService(TTSService):
    """Custom Pipecat TTS processor using Silero TTS v5 (Russian)."""

    def __init__(
        self,
        *,
        language: str = "ru",
        model_id: str = "v5_ru",
        speaker: str = "xenia",
        sample_rate: int = 24000,
        device: str = "cpu",
        **kwargs,
    ):
        super().__init__(sample_rate=sample_rate, **kwargs)
        self._language = language
        self._model_id = model_id
        self._speaker = speaker
        self._sample_rate = sample_rate
        self._device = torch.device(device)
        self._model = None

    async def start(self, frame: StartFrame):
        await super().start(frame)
        logger.info("Loading Silero TTS model...")
        try:
            self._model, _ = torch.hub.load(
                repo_or_dir="snakers4/silero-models",
                model="silero_tts",
                language=self._language,
                speaker=self._model_id,
                trust_repo=True,
            )
            self._model.to(self._device)
            logger.info(
                f"Silero TTS loaded. Available speakers: {self._model.speakers}"
            )
            if self._speaker not in self._model.speakers:
                self._speaker = self._model.speakers[0]
                logger.warning(
                    f"Speaker not found, using: {self._speaker}"
                )
        except Exception as e:
            logger.error(f"Failed to load Silero TTS: {e}")
            raise

    async def run_tts(self, text: str, context_id: str = ""):
        if not self._model:
            logger.error("Silero TTS model not loaded")
            return

        try:
            audio_tensor = self._model.apply_tts(
                text=text,
                speaker=self._speaker,
                sample_rate=self._sample_rate,
                put_accent=True,
                put_yo=True,
            )
            # Convert float32 [-1, 1] tensor to int16 PCM bytes
            audio_np = (audio_tensor.numpy() * 32767).astype(np.int16)
            audio_bytes = audio_np.tobytes()

            yield TTSAudioRawFrame(
                audio=audio_bytes,
                sample_rate=self._sample_rate,
                num_channels=1,
            )
        except Exception as e:
            logger.warning(f"Silero TTS synthesis failed for '{text}': {e}")
            # Don't yield ErrorFrame — skip this chunk and continue
