# KOJ — Kottayam Online Judge

> Self-hosted competitive programming and contest hosting platform with an integrated problem archive for IIIT Kottayam.

---

## Architecture Overview

KOJ is engineered as a decoupled, 3-tier distributed system designed for scalability, security, and low-latency feedback:

1. **Frontend / Web Layer (Next.js 16)**:
   - Built with Next.js App Router, React 19, and Tailwind CSS v4.
   - Distinct dark neon-terminal aesthetic with responsive mobile/desktop layouts.
   - Authentication powered by Clerk (email/password and social OAuth via GitHub/Google).
   - Server-side and client-side data fetching connected to Neon Postgres via Drizzle ORM.
   - Role-based routing for contestants, problem setters, and administrators.

2. **Judge Service (FastAPI)**:
   - Python-based asynchronous judging service designed to run on Google Cloud Run.
   - Multi-language code evaluation: Python (3.11), C (GCC), C++ (G++), and Java (OpenJDK).
   - Subprocess sandbox isolation with strict memory (`setrlimit`) and CPU time limits.
   - Asynchronous execution worker (`POST /judge-async`) with real-time Server-Sent Events (SSE) verdict streaming to contestants.

3. **Database Layer (Neon Postgres)**:
   - Serverless Postgres database utilizing connection pooling.
   - Type-safe schema definitions and migrations managed through Drizzle ORM.
   - Houses problems, test cases, contests, registrations, submissions, and ICPC leaderboard metrics.

---

## Tech Stack Summary

| Layer | Technologies |
|---|---|
| **Frontend Web** | Next.js 16.3, React 19, Tailwind CSS v4, TypeScript, Lucide Icons |
| **Authentication** | Clerk (JWT, User Management, Organizations) |
| **Database & ORM** | Neon Serverless Postgres, Drizzle ORM, Drizzle Kit, `pg` / `psycopg 3` |
| **Backend Judge** | FastAPI, Python 3.11, Uvicorn, GCC, G++, OpenJDK |
| **Realtime** | Server-Sent Events (SSE) for submission verdict streaming & live leaderboard |
| **Hosting Targets** | Vercel (Frontend & Route Handlers), Google Cloud Run (Judge Sandbox) |

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+ (Node 22+ recommended)
- Python 3.11+
- C, C++, and Java compilers (`gcc`, `g++`, `default-jdk-headless`)

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/Asterisk-Hunter/KOJ.git
cd KOJ

# Install frontend dependencies
npm install

# Install judge service dependencies
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment
Create `.env.local` in the project root and `api/.env` in the `api/` directory with your database connection string and Clerk credentials (see [Deployment Guide](deployment.md#5-environment-variables-reference) for the complete reference).

### 3. Run Database Migrations
```bash
npm run db:migrate
```

### 4. Start Services
In one terminal, start the FastAPI judge:
```bash
cd api
uvicorn app.main:app --reload --port 8000
```

In a second terminal, start the Next.js development server:
```bash
npm run dev
```

Visit <http://localhost:3000> to access KOJ. Health checks are accessible at <http://localhost:3000/api/health> and <http://127.0.0.1:8000/health>.

---

## Documentation Index

Explore the detailed guides and technical documentation:

### User Guides
- **[Contestant User Guide](user-guide.md)** — Registration, browsing problems, code editor usage, verdicts (AC, WA, TLE, MLE, RE, CE, PE), contest participation, ICPC scoring, and dashboard.
- **[Problem Setter Guide](problem-setter-guide.md)** — Admin panel access, creating problems, markdown statements, uploading test cases (10MB limit, sample vs hidden), problem states, and authoring best practices.

### System & Engineering Docs
- **[Deployment Guide](deployment.md)** — Production deployment instructions for Vercel, Google Cloud Run, Neon Postgres, local development, and environment variables table.
- **[Implementation Status](status.md)** — Authoritative status of features, routes, schemas, and verification evidence.
- **[Architecture](architecture.md)** — System architecture diagrams, module decomposition, and data flow pipelines.
- **[Features](features.md)** — Detailed specification of implemented vs. planned features.
- **[Project Overview](overview.md)** — Project motivation, problem statement, objectives, and target user personas.
- **[Tech Stack & Rationale](stack.md)** — Deep dive into framework and infrastructure trade-offs.
- **[Testing Strategy](testing.md)** — Verification procedures, compiler checks, smoke tests, and quality assurance reports.
- **[UI Design System](ui-design.md)** — Dark neon-terminal design specifications, typography, and component library.
- **[Hard Problems](hard-problems.md)** — Security sandboxing, execution isolation, and deterministic time/memory measurement.
- **[Glossary](glossary.md)** — Terminology, acronyms, and platform definitions.
