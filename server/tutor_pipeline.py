import asyncio
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMMessagesUpdateFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.ollama import OLLamaLLMService
from pipecat.services.whisper.stt import Model, WhisperSTTService
from pipecat.transports.network.websocket_server import (
    WebsocketServerParams,
    WebsocketServerTransport,
)

from prompts import TUTOR_SYSTEM_PROMPT
from raw_serializer import RawFrameSerializer
from silero_tts import SileroTTSService
from transcript_forwarder import TranscriptForwarder


async def run_tutor_pipeline(host: str = "0.0.0.0", port: int = 8765, stt_device: str = "cuda"):
    transport = WebsocketServerTransport(
        params=WebsocketServerParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=RawFrameSerializer(sample_rate=16000),
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(
                    confidence=0.7,
                    start_secs=0.2,
                    stop_secs=2.1,
                    min_volume=0.5,
                )
            ),
        ),
        host=host,
        port=port,
    )

    compute_type = "float16" if stt_device == "cuda" else "int8"
    stt = WhisperSTTService(
        model=Model.LARGE_V3_TURBO,
        device=stt_device,
        compute_type=compute_type,
        language="ru",
        no_speech_prob=0.4,
    )

    llm = OLLamaLLMService(
        model="elena",
        base_url="http://localhost:11434/v1",
    )

    tts = SileroTTSService(
        language="ru",
        model_id="v5_ru",
        speaker="xenia",
        sample_rate=24000,
        device="cpu",
    )

    messages = [{"role": "system", "content": TUTOR_SYSTEM_PROMPT}]
    context = OpenAILLMContext(messages)
    context_aggregator = llm.create_context_aggregator(context)

    user_transcript = TranscriptForwarder(transport)
    assistant_transcript = TranscriptForwarder(transport)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_transcript,
            context_aggregator.user(),
            llm,
            assistant_transcript,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
            allow_interruptions=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"Client connected")
        # Prompt the LLM to open the conversation
        opening = list(messages) + [
            {
                "role": "user",
                "content": "[Начни разговор — поздоровайся и предложи тему.]",
            }
        ]
        await task.queue_frames([LLMMessagesUpdateFrame(messages=opening, run_llm=True)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=True)
    await runner.run(task)
