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
- `POST /transcribe-microphone`
- `POST /discharge-draft` (free local demo generator)
- `POST /discharge-draft-ai` (local LLM via Ollama, with optional fallback)
- `POST /transcript-corrections` (AI transcript proofreading)

## Example request

```bash
curl -X POST "http://localhost:8000/transcribe" \
  -F "file=@/absolute/path/to/audio.mp3" \
  -F "language=sr" \
  -F "word_timestamps=true"
```

Microphone recording request example:

```bash
curl -X POST "http://localhost:8000/transcribe-microphone" \
  -F "file=@/absolute/path/to/recording.webm" \
  -F "language=sr" \
  -F "word_timestamps=true"
```

Discharge draft request example:

```bash
curl -X POST "http://localhost:8000/discharge-draft" \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Pacijent primljen zbog bola u grudima. Tokom hospitalizacije uradjen EKG...",
    "detected_language": "sr",
    "patient_name": "Petar Petrovic",
    "patient_id": "HIS-2026-00125",
    "doctor_name": "Dr Dimitrije Milenkovic",
    "department": "Interno odeljenje",
    "admission_date": "2026-04-24",
    "discharge_date": "2026-04-26"
  }'
```

AI discharge draft request example:

```bash
curl -X POST "http://localhost:8000/discharge-draft-ai?fallback_to_rules=true" \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Pacijent primljen zbog bola u grudima. Tokom hospitalizacije uradjen EKG...",
    "detected_language": "sr",
    "patient_name": "Petar Petrovic",
    "patient_id": "HIS-2026-00125",
    "doctor_name": "Dr Dimitrije Milenkovic",
    "department": "Interno odeljenje",
    "admission_date": "2026-04-24",
    "discharge_date": "2026-04-26"
  }'
```

Transcript correction request example:

```bash
curl -X POST "http://localhost:8000/transcript-corrections?fallback_noop=true" \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Pacijent primlen zbog bol u grudima i gusenja pri napor.",
    "detected_language": "sr",
    "max_corrections": 20
  }'
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

`/discharge-draft` returns a rule-based demo JSON structure with editable fields for an otpusna lista draft.

`/discharge-draft-ai` uses a local Ollama model (default: `qwen2.5:3b-instruct`) and returns the same structure.  
If Ollama is unavailable and `fallback_to_rules=true`, backend automatically returns rule-based draft.

`/transcript-corrections` reviews transcript text and returns:
- `corrected_transcript`
- `corrections` (original -> suggested, reason, confidence)
- `quality_notes`

## Config (optional env vars)

- `WHISPER_MODEL` (default: `small`)
- `WHISPER_DEVICE` (default: `cpu`)
- `WHISPER_COMPUTE_TYPE` (default: `int8`)
- `OLLAMA_ENABLED` (default: `true`)
- `OLLAMA_BASE_URL` (default: `http://localhost:11434`)
- `OLLAMA_MODEL` (default: `qwen2.5:3b-instruct`)
- `OLLAMA_TIMEOUT_SECONDS` (default: `90`)

For local macOS MVP development, keep CPU defaults first.

## Optional: local AI draft setup (Ollama)

```bash
brew install ollama
ollama serve
ollama pull qwen2.5:3b-instruct
```

## Notes

- First transcription may take longer because model weights are downloaded.
- `vad_filter=True` and `beam_size=5` are enabled in code.
