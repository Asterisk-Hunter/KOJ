# KOJ API

Minimal FastAPI service that lives alongside the Next.js app in this repo.
It is a **separate process** from `next dev` and runs on its own port
(default `8000`, while Next.js stays on `3000`).

## 1. Create a virtualenv

Windows (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\activate
```

macOS / Linux:

```bash
python -m venv .venv
source .venv/bin/activate
```

## 2. Install dependencies

```bash
pip install -r api/requirements.txt
```

## 3. Configure environment

Copy the example file and fill in your Neon connection string (the same
`DATABASE_URL` used by the Next.js app in `.env.local`):

Windows:

```powershell
copy api\.env.example api\.env
```

macOS / Linux:

```bash
cp api/.env.example api/.env
```

Then edit `api/.env`:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
FASTAPI_HOST=127.0.0.1
FASTAPI_PORT=8000
```

> The `DATABASE_URL` placeholder is intentionally invalid — replace
> `USER`, `PASSWORD`, `HOST`, and `DB` with your real Neon values.

## 4. Run the service

From inside the `api/` directory (so the relative `.env` file is found):

```bash
cd api
uvicorn app.main:app --reload --port 8000
```

Then open:

- <http://127.0.0.1:8000/>             — service index
- <http://127.0.0.1:8000/health>       — liveness + DB readiness
- <http://127.0.0.1:8000/docs>         — interactive Swagger UI

## Notes

- This service is **not** a Next.js route handler. It runs in its own
  Python process — start it in a second terminal alongside `next dev`.
- CORS is pre-configured to allow `http://localhost:3000` (Next.js) and
  the service's own origin defined by `FASTAPI_HOST` / `FASTAPI_PORT`.
- Never commit `api/.env`; only `.env.example` is tracked.
