# SerbianWhisper AI - Test Report (Presentation Draft)

**Execution date:** 2026-04-27 11:10:31 CEST  
**Environment:** Local development (macOS), FastAPI backend + React/Vite frontend

## Test Scope
This report covers tests that are currently feasible and reproducible in local development:
- Backend API smoke tests
- Fallback behavior tests
- Build and syntax stability checks

## Test Results Summary
- **Total tests:** 9
- **Passed:** 9
- **Failed:** 0
- **Pass rate:** 100%

## Detailed Results

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | `GET /health` | Service metadata is returned | PASS (`200`) |
| 2 | `POST /transcribe` when model is not loaded | Controlled error response | PASS (`503`) |
| 3 | `POST /transcribe` with mocked model | Transcript + segments + words serialized | PASS (`200`) |
| 4 | `POST /transcribe-microphone` with mocked model | Same response contract as upload transcription | PASS (`200`) |
| 5 | `POST /discharge-draft` | Rule-based discharge fields generated | PASS (`200`) |
| 6 | `POST /discharge-draft-ai?fallback_to_rules=true` | AI route falls back to usable rule draft if needed | PASS (`200`) |
| 7 | `POST /transcript-corrections?fallback_noop=true` | Corrections payload (or noop fallback) returned | PASS (`200`) |
| 8 | Backend syntax check (`py_compile`) | No Python syntax errors | PASS |
| 9 | Frontend production build (`vite build`) | Successful optimized build | PASS |

## Notes for Presentation
- Transcription and microphone endpoints were validated for API contract and serialization format.
- AI-related routes were validated with fallback behavior, which is critical for demo reliability.
- Frontend build is stable and production bundle generation succeeds.
- Backend source compiles without syntax issues.

## Limitations (Transparent Disclosure)
- Core API smoke tests used a **mocked Whisper model** to avoid long/inconsistent runtime during test execution.
- Live AI quality depends on local Ollama availability and model response quality.
- Medical correctness still requires human clinical review (as designed in the app disclaimers).

## Commands Used

### Backend smoke test (with TestClient + mocked model)
Executed via backend virtual environment (`backend/.venv/bin/python`) and covered tests #1-#7.

### Backend syntax
```bash
python3 -m py_compile backend/main.py
```

### Frontend build
```bash
cd frontend
npm run build
```

