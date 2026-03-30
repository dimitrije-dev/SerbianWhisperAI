import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel


MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
MODEL_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
MODEL_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

app = FastAPI(title="Faster Whisper API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model: Optional[WhisperModel] = None

MIME_SUFFIX_MAP = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}


@app.on_event("startup")
def load_model() -> None:
    global model
    model = WhisperModel(
        MODEL_NAME,
        device=MODEL_DEVICE,
        compute_type=MODEL_COMPUTE_TYPE,
    )


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_name": MODEL_NAME,
        "device": MODEL_DEVICE,
        "compute_type": MODEL_COMPUTE_TYPE,
        "model_loaded": model is not None,
    }


def _resolve_suffix(file: UploadFile) -> str:
    explicit = Path(file.filename or "").suffix
    if explicit:
        return explicit

    content_type = (file.content_type or "").lower()
    if content_type in MIME_SUFFIX_MAP:
        return MIME_SUFFIX_MAP[content_type]

    base_type = content_type.split(";")[0].strip()
    if base_type in MIME_SUFFIX_MAP:
        return MIME_SUFFIX_MAP[base_type]

    return ".webm"


async def _transcribe_upload(file: UploadFile, language: Optional[str], word_timestamps: bool) -> dict:
    if model is None:
        raise HTTPException(status_code=503, detail="Model is not loaded yet.")

    suffix = _resolve_suffix(file)
    temp_path: Optional[str] = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_path = tmp.name
            shutil.copyfileobj(file.file, tmp)

        segments, info = model.transcribe(
            temp_path,
            language=language or None,
            word_timestamps=word_timestamps,
            vad_filter=True,
            beam_size=5,
        )

        full_text_parts = []
        serialized_segments = []

        for segment in segments:
            full_text_parts.append(segment.text)
            payload = {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            }

            if word_timestamps:
                payload["words"] = [
                    {
                        "start": word.start,
                        "end": word.end,
                        "word": word.word,
                        "probability": word.probability,
                    }
                    for word in (segment.words or [])
                ]

            serialized_segments.append(payload)

        return {
            "detected_language": info.language,
            "language_probability": info.language_probability,
            "text": " ".join(part.strip() for part in full_text_parts if part.strip()),
            "segments": serialized_segments,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        await file.close()


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    word_timestamps: bool = Form(default=False),
) -> dict:
    return await _transcribe_upload(
        file=file,
        language=language,
        word_timestamps=word_timestamps,
    )


@app.post("/transcribe-microphone")
async def transcribe_microphone(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    word_timestamps: bool = Form(default=False),
) -> dict:
    return await _transcribe_upload(
        file=file,
        language=language,
        word_timestamps=word_timestamps,
    )
