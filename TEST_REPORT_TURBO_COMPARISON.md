# SerbianWhisper - Model Comparison Report (Small vs Large-v3 Turbo)

Execution date: 2026-04-27 (Europe/Belgrade)

## Cilj

Ovaj report prikazuje uporedni kvalitet izlaza za dva modela transkripcije:

- `small`
- `large-v3-turbo` (u API-u: `transcription_model=turbo`)

Poređenje je dizajnirano kao deterministički backend test (kontrolisani input), tako da su brojevi stabilni i ponovljivi.

## Test coverage

Relevantan test fajl:
- `backend/tests/test_transcription_metrics.py`

Ključni testovi:
- `test_transcription_kpi_metrics_are_extractable` (small KPI baseline)
- `test_transcription_kpi_metrics_turbo_model` (turbo KPI)
- `test_small_vs_turbo_comparison_metrics` (direktno upoređivanje i asert da je turbo bolji)

## Kako pokrenuti

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
backend/.venv/bin/python -m pytest -q backend/tests/test_transcription_metrics.py
```

## Uporedni KPI rezultati (kontrolisani sample)

| Metric | Small | Turbo (large-v3-turbo) |
|---|---:|---:|
| WER | 0.0833 (8.33%) | 0.0000 (0.00%) |
| CER | 0.0333 (3.33%) | 0.0000 (0.00%) |
| Avg word probability | 0.8950 | 0.9475 |
| Min word probability | 0.7200 | 0.9200 |
| Low confidence rate (`p < 0.8`) | 0.0833 (8.33%) | 0.0000 (0.00%) |
| Word count | 12 | 12 |
| Duration (sec) | 7.0 | 7.0 |
| Speaking rate (WPM) | 102.86 | 102.86 |

## Zaključak

U ovom kontrolisanom test scenariju `large-v3-turbo` daje:
- niži WER/CER,
- višu prosečnu pouzdanost po reči,
- manji udeo low-confidence tokena.

To potvrđuje da backend/UI model switch radi i da možemo numerički pratiti kvalitet po modelu.

## Napomena

Ovi rezultati su iz determinističkog test harness-a (mock audio/model output). Za realnu evaluaciju u produkcionom okruženju preporučuje se isti KPI protokol nad stvarnim kliničkim snimcima i referentnim transkriptima.

