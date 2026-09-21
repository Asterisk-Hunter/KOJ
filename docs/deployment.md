# Deployment Guide

This guide covers deployment workflows for KOJ across local development, Vercel (Next.js frontend), Google Cloud Run (FastAPI judge service), and Neon (serverless Postgres).

---

## Architecture Overview

KOJ runs as a decoupled 3-tier architecture:

```
┌────────────────────────────────────────────────────────┐
│  Vercel (Next.js 16 + React 19)                        │
│  - App Router (UI & Server Components)                 │
│  - API Route Handlers (/api/*)                         │
│  - Clerk Authentication Middleware & Proxies           │
│  - Drizzle ORM client pool (max: 10)                   │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             │ Internal async HTTP POST  │ (X-Judge-Secret)
             ▼                           ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  Google Cloud Run (FastAPI)  │   │  Neon Serverless Postgres    │
│  - Multi-language sandbox    │   │  - Core tables               │
│  - C, C++, Python, Java      │   │  - Pooled connection pooler  │
│  - Direct DB verdict updates │   │  - sslmode=require           │
│  - 4 uvicorn workers         │   │                              │
└──────────────┬───────────────┘   └──────────────┬───────────────┘
               │ SQL (psycopg 3)                  │ SQL (pg/drizzle)
               └──────────────────────────────────┘
```

- **Frontend**: Hosted on Vercel with edge-capable routing and SSR.
- **Judge Worker**: Hosted on Google Cloud Run in a container containing gcc, g++, and OpenJDK.
- **Database**: Hosted on Neon Postgres with pgBouncer pooling.

---

## 1. Database Setup: Neon Postgres & Drizzle

KOJ uses Neon Postgres with Drizzle ORM for schema definitions and migrations.

### Neon Project Creation
1. Create a project in [Neon Console](https://console.neon.tech).
2. Copy the **Pooled Connection String** (format: `postgresql://[user]:[password]@[host]-pooler.neon.tech/[db]?sslmode=require&channel_binding=require`).

### Schema Migrations
Run Drizzle Kit from the project root:

```bash
# Generate SQL migrations when db/schema.ts is modified
npm run db:generate

# Apply pending SQL migrations to the target database in DATABASE_URL
npm run db:migrate

# (Dev only) Inspect tables visually in Drizzle Studio
npm run db:studio
```

#### Pre-migration safety check

Before applying migrations on a database with existing user data, verify there are no duplicate emails (which would violate the `users.email` uniqueness constraint):

```sql
SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;
```

This query must return **zero rows**. If duplicates exist, deduplicate them before running `npm run db:migrate`.

### Seeding Initial Data
Populate the database with default problems, test cases, and sample contests. The seed script requires an existing Clerk user ID to assign ownership:

```bash
SEED_USER_CLERK_ID=user_xxx SEED_USER_EMAIL=admin@example.com npm run db:seed
```

---

## 2. Frontend Deployment: Vercel

The Next.js 16 application is deployed to Vercel.

### Setup Instructions
1. Import the repository into your Vercel team/account.
2. Ensure the **Framework Preset** is detected as **Next.js**.
3. Set the root directory to the repository root (`.`).
4. Note that `.vercelignore` ignores the `api/` directory so Vercel only builds the Next.js application.

### Required Environment Variables on Vercel

Configure these in **Project Settings → Environment Variables**:

| Variable | Example / Description |
|---|---|
| `DATABASE_URL` | Neon pooled DSN (`postgresql://...@...-pooler...neon.tech/koj?sslmode=require`) |
| `FASTAPI_URL` | Origin of the deployed Cloud Run judge (e.g. `https://koj-judge-xyz-uc.a.run.app`) |
| `JUDGE_INTERNAL_SECRET` | 32+ character random secret string (must match Cloud Run) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_live_...` or `pk_test_...`) |
| `CLERK_SECRET_KEY` | Clerk secret key (`sk_live_...` or `sk_test_...`) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard` |
| `CLERK_WEBHOOK_SECRET` | Clerk webhook signing secret (`whsec_...`) — required for `POST /api/webhooks/clerk` |

### Function Timeout Configuration
`app/api/submissions` uses asynchronous fire-and-forget handoff to the FastAPI judge via `POST /judge-async`. The submission handler dispatches the job in under 500ms and returns `202 Accepted` while the client subscribes to Server-Sent Events (SSE). Vercel's default function limits are sufficient.

---

## 3. Backend / Judge Service: Google Cloud Run

The judge service executes untrusted code in an isolated subprocess sandbox. It must be hosted on Google Cloud Run (or another Docker-capable container host) rather than Vercel serverless.

### Container Build & Deployment
The `api/Dockerfile` contains Python 3.11-slim, `gcc`, `g++`, and `default-jdk-headless`.

Deploy directly using the Google Cloud SDK:

```bash
# Navigate to project root or api directory
cd /home/prajwal-k/Projects/KOJ

# Deploy to Cloud Run
gcloud run deploy koj-judge \
  --source ./api \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --concurrency 4 \
  --cpu 2 \
  --memory 2Gi \
  --timeout 120s \
  --set-env-vars "DATABASE_URL=postgresql://...,JUDGE_INTERNAL_SECRET=your_shared_secret,FRONTEND_URL=https://your-app.vercel.app,FASTAPI_HOST=0.0.0.0"
```

### Key Deployment Settings for Cloud Run
- **Concurrency (`--concurrency 4`)**: Set to 4 to match the 4 uvicorn worker processes in `api/Dockerfile`. Cloud Run spins up additional container instances automatically when submissions spike (`REQ-JUDGE-13`).
- **Memory & CPU (`--memory 2Gi --cpu 2`)**: Ensures adequate resources for compilation (`gcc`, `g++`, `javac`) and execution limits (up to 256MB RAM per process).
- **Authentication**: Protected via `X-Judge-Secret` header validation. Requests missing the shared secret are rejected with `401 Unauthorized`.

---

## 4. Local Development Workflow

Run the frontend and backend locally for development and testing.

### Prerequisites
- Node.js 20+ (Node 22+ recommended)
- Python 3.11+
- GCC, G++, and Java JDK installed on your host OS
- Access to a Neon database or local Postgres instance

### 1. Configure Local Environment Files

**In repository root (`.env.local`):**
```env
DATABASE_URL="postgresql://user:password@ep-sample-pooler.neon.tech/koj?sslmode=require"
FASTAPI_URL="http://127.0.0.1:8000"
JUDGE_INTERNAL_SECRET="dev-judge-secret-local"
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL="/dashboard"
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL="/dashboard"
```

**In `api/.env`:**
```env
DATABASE_URL="postgresql://user:password@ep-sample-pooler.neon.tech/koj?sslmode=require"
FASTAPI_HOST=0.0.0.0
FASTAPI_PORT=8000
JUDGE_INTERNAL_SECRET="dev-judge-secret-local"
FRONTEND_URL="http://localhost:3000"
```

### 2. Start the Backend Judge Service

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Verify the judge is live at <http://127.0.0.1:8000/health>.

### 3. Start the Next.js Frontend

```bash
# In the project root:
npm install
npm run db:migrate
npm run dev
```
Open <http://localhost:3000> in your browser. Verify database health at <http://localhost:3000/api/health>.

---

## 5. Environment Variables Reference

| Variable | Applied To | Required | Description |
|---|---|---|---|
| `DATABASE_URL` (or `NEON_DSN`) | Next.js & FastAPI | Yes | Neon pooled connection string with `sslmode=require`. |
| `FASTAPI_URL` | Next.js (`.env.local`) | Yes | Base URL where FastAPI judge is hosted (e.g., `http://127.0.0.1:8000` or Cloud Run URL). |
| `JUDGE_INTERNAL_SECRET` | Next.js & FastAPI | Yes | Shared secret header (`X-Judge-Secret`) authorizing judge triggers. |
| `FRONTEND_URL` | FastAPI (`.env`) | Yes | Frontend origin for CORS allow-listing (e.g. `https://koj.vercel.app` or `http://localhost:3000`). |
| `FASTAPI_HOST` | FastAPI (`.env`) | Yes | Network bind address (`0.0.0.0` in Docker/Cloud Run, `127.0.0.1` in dev). |
| `FASTAPI_PORT` | FastAPI (`.env`) | Yes | Port to listen on (Cloud Run sets `PORT` automatically). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next.js | Yes | Clerk publishable key from Clerk dashboard. |
| `CLERK_SECRET_KEY` | Next.js | Yes | Clerk secret key from Clerk dashboard. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Next.js | Yes | Route for authentication sign in (`/sign-in`). |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Next.js | Yes | Route for authentication sign up (`/sign-up`). |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Next.js | Yes | Default redirect after sign-in (`/dashboard`). |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Next.js | Yes | Default redirect after sign-up (`/dashboard`). |
| `CLERK_WEBHOOK_SECRET` | Next.js (Vercel) | Yes (for webhooks) | Clerk webhook signing secret (`whsec_...`) for `POST /api/webhooks/clerk`. |

> [!CAUTION]
> Never commit `.env`, `.env.local`, or any credentials to Git. Always inject sensitive values via Vercel and Google Cloud Run environment variable configuration.

---

## 6. Clerk Dashboard Configuration

After deploying, verify the following in the [Clerk Dashboard](https://dashboard.clerk.com):

### Authentication methods
- [ ] Enable **GitHub** and **Google** OAuth providers (under *User & Authentication → Social Connections*).

### Organizations
- [ ] **Organizations** are enabled (under *Organizations*). This is required for `org:admin` role gating on admin APIs.
- [ ] Create the `contest_setter` organization role (under *Organizations → Roles*) if contest-setter access is desired. DB roles are admin-managed; this only enables Clerk-side `org:contest_setter` checks.

### Webhooks
- [ ] Add a webhook endpoint: set **Endpoint URL** to `https://<your-app>.vercel.app/api/webhooks/clerk`.
- [ ] Subscribe to events: `user.created`, `user.updated`, `user.deleted`.
- [ ] Copy the **Signing Secret** (`whsec_...`) and add it as `CLERK_WEBHOOK_SECRET` in Vercel environment variables.

### Sign-in / Sign-up
- [ ] Confirm **Sign-in URL** is `/sign-in` and **Sign-up URL** is `/sign-up`.
- [ ] Confirm **After sign-in redirect** is `/dashboard` and **After sign-up redirect** is `/dashboard`.
