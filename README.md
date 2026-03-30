# SebianWhisper

<p align="center">
  <img src="./assets/mini-logo.png" alt="SebianWhisper Mini Logo" width="72" />
</p>

<p align="center">
  <strong>Local-first audio transcription web app</strong><br/>
  React + Vite frontend, FastAPI backend, Faster-Whisper transcription engine.
</p>

<p align="center">
  <img src="./assets/serbianwhisper-logo.jpg" alt="SebianWhisper Main Logo" width="620" />
</p>

## Screenshots

### Transcription View

![Transcription View](./assets/screenshots/ss1.png)

### History View

![History View](./assets/screenshots/ss2.png)

## Overview

SebianWhisper is a minimal but production-minded MVP for audio transcription:
- upload audio from browser
- send file via `multipart/form-data` to backend
- transcribe using `faster-whisper`
- return and render full transcript + timestamped segments

The model runs only on the backend (never in the browser).

## Key Features

- FastAPI backend with reusable Whisper model instance (loaded once at startup)
- React frontend with clean UI, menu, About page, and responsive mobile hamburger menu
- Light/Dark theme with sun/moon icons
- Loading card + spinner during transcription
- Optional language input
- Optional word-level timestamps
- Segment-level timestamps always returned

## Tech Stack

- Frontend: React + Vite (JavaScript)
- Backend: Python + FastAPI
- Transcription: `faster-whisper` (`WhisperModel`)
- Upload protocol: `multipart/form-data`

## Project Structure

```text
SerbianWhisper/
├── assets/
│   ├── mini-logo.png
│   ├── serbianwhisper-logo.jpg
│   └── screenshots/
│       ├── ss1.png
│       └── ss2.png
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── README.md
├── frontend/
│   ├── public/
│   │   ├── mini-logo.png
│   │   └── serbianwhisper-logo.jpg
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   └── main.jsx
│   ├── package.json
│   └── README.md
└── README.md
```

## Backend Spec

- `GET /health`
- `POST /transcribe`

`POST /transcribe` accepts:
- `file` (required)
- `language` (optional, e.g. `sr`, `en`)
- `word_timestamps` (optional, `true`/`false`)

Transcription settings:
- model: `small` (default)
- device: `cpu` (default)
- compute type: `int8` (default)
- `vad_filter=True`
- `beam_size=5`

Response shape:

```json
{
  "detected_language": "sr",
  "language_probability": 0.98,
  "text": "Full transcript text...",
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "Segment text",
      "words": [
        {
          "start": 0.0,
          "end": 0.4,
          "word": "Zdravo",
          "probability": 0.92
        }
      ]
    }
  ]
}
```

`words` is returned only when `word_timestamps=true`.

## Frontend Spec

- Audio file picker
- Optional language field
- Word timestamps toggle
- Submit to `POST /transcribe` using `fetch` + `FormData`
- Render:
  - detected language + confidence
  - full transcript
  - segment list with timestamps
- Professional responsive UI (desktop + mobile)

## Local Setup (macOS)

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend URL: `http://localhost:8000`

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend URL: `http://localhost:5173`

## Example Request

```bash
curl -X POST "http://localhost:8000/transcribe" \
  -F "file=@/absolute/path/to/audio.mp3" \
  -F "language=sr" \
  -F "word_timestamps=true"
```

## Troubleshooting

- If frontend shows `Failed to fetch`, check backend is running at `http://localhost:8000`.
- If backend crashes with missing package, reactivate venv and run `pip install -r requirements.txt`.
- First transcription is slower (model download on first run).
- Recommended for local Mac MVP: keep CPU defaults (`small`, `cpu`, `int8`).

## Author

**Dimitrije Milenkovic**
