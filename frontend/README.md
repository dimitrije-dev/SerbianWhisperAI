# Frontend (React + Vite)

## 1) Setup

```bash
cd frontend
npm install
```

## 2) Run

```bash
cd frontend
npm run dev
```

Frontend URL: `http://localhost:5173`

By default it calls backend at `http://localhost:8000`.

Optional override:

```bash
cd frontend
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

## What the page does

- Upload audio file
- Optional language input
- Optional word timestamps toggle
- POSTs multipart/form-data to `/transcribe`
- Displays detected language, full transcript, and timestamped segments
- Includes `Otpusna lista` page with mode selector:
  - `AI model` calls `/discharge-draft-ai?fallback_to_rules=false`
  - `Rule-based` calls `/discharge-draft`
- Includes `AI ispravi transkript` action (calls `/transcript-corrections`) before discharge draft generation
