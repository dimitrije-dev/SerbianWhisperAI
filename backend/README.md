# Backend (FastAPI + faster-whisper)

## 1) Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 2) Run

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API base URL: `http://localhost:8000`

## Endpoints

- `GET /health`
- `POST /transcribe`

## Example request

```bash
curl -X POST "http://localhost:8000/transcribe" \
  -F "file=@/absolute/path/to/audio.mp3" \
  -F "language=sr" \
  -F "word_timestamps=true"
```

## Example response shape

```json
{
  "detected_language": "sr",
  "language_probability": 0.98,
  "text": "Full transcript text...",
  "segments": [
    {
      "start": 0.0,
      "end": 4.2,
      "text": "First segment text",
      "words": [
        {
          "start": 0.0,
          "end": 0.4,
          "word": "First",
          "probability": 0.93
        }
      ]
    }
  ]
}
```

`words` is included only when `word_timestamps=true`.

## Config (optional env vars)

- `WHISPER_MODEL` (default: `small`)
- `WHISPER_DEVICE` (default: `cpu`)
- `WHISPER_COMPUTE_TYPE` (default: `int8`)

For local macOS MVP development, keep CPU defaults first.

## Notes

- First transcription may take longer because model weights are downloaded.
- `vad_filter=True` and `beam_size=5` are enabled in code.
