# SerbianWhisper - AI/Qwen Test Report

Execution date: 2026-04-27 (Europe/Belgrade)

## Purpose

Ovaj dokument pokriva dodatni test set fokusiran na AI/Qwen tokove iza faster-whisper transkripcije.

Cilj je da validira:
- da transkripcija endpoint vraca stabilan JSON ugovor,
- da AI korekcija radi kroz `Ollama /api/chat`,
- da fallback na `Ollama /api/generate` radi ako je `chat` endpoint nedostupan,
- da AI draft otpusne liste radi nakon transkripcije.

## Test file

- `backend/tests/test_ai_qwen_pipeline.py`

## Test scenarios

| # | Scenario | Coverage |
|---|---|---|
| 1 | `POST /transcribe` sa mock Whisper modelom | Segment serialization + `words` payload |
| 2 | `POST /transcript-corrections` (Qwen chat path) | Parsiranje AI JSON output-a i normalization corrections |
| 3 | `POST /transcript-corrections` (chat=404 -> generate fallback) | Kompatibilnost sa Ollama API varijantama |
| 4 | `POST /discharge-draft-ai` nakon transkripcije | End-to-end backend tok transkript -> AI draft |

## How to run

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
backend/.venv/bin/python -m pytest -q backend/tests/test_ai_qwen_pipeline.py
```

## Latest local run result

```text
4 passed, 8 warnings in 0.27s
```

## Notes

- Testovi koriste mock Whisper i mock Ollama odgovore da bi bili deterministicki i brzi.
- Time validiramo aplikacionu logiku, endpoint ugovor i fallback mehanizme bez zavisnosti od realnog model latency-ja.
- Za live demonstraciju preporuceno je dodatno odraditi manual smoke sa pravim Ollama servisom (`ollama serve`) i modelom `qwen2.5:3b-instruct`.

## Optional live smoke (manual)

1. Pokreni backend i Ollama.
2. U frontendu uradi transkripciju realnog audio fajla.
3. Klikni AI korekciju transkripta.
4. U Otpusna lista modulu prebaci engine na `AI model`.
5. Proveri da odgovor sadrzi `engine` tipa `ollama:qwen...` i popunjena `fields` polja.

