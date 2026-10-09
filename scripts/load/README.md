# KOJ staging load smoke test

This small k6 harness exercises authenticated contest detail, standings, and a user's contest-submission list. It uses bounded traffic and polls by default. It does **not** register users or alter contest configuration.

## Safety first

Only run this against a staging deployment you own and have permission to test. Never point it at production or a live public contest. Enabling `KOJ_ENABLE_SUBMIT=true` creates a **real judge submission**, consumes queue/worker capacity, and may affect standings. It sends exactly one submission for the single configured Clerk user/problem per invocation; the app's per-user/per-problem 30-second rate limit may reject it if that user submitted recently. Keep submission opt-in disabled unless you explicitly want to create that record.

The defaults are one poll VU for 30 seconds; maximums are five poll VUs and 60 seconds. The optional submission scenario is fixed at one VU and one iteration. The configured contest must be public/live or ended for rankings and must allow the user's participation to submit; polling-only requests can still exercise contest detail and rankings when the user is not registered.

## Requirements

- k6 installed locally; this harness makes no package-manager changes.
- A staging KOJ base URL, Clerk session JWT for a staging user, numeric problem ID, and numeric contest ID.
- For a real submission, a contest-eligible user and a problem linked to the contest, with test cases configured. `KOJ_SOURCE_CODE` must solve the selected problem if accepted output is desired; its default is only a trivial stdin echo.

Pass the JWT through the environment rather than writing it into this directory or a committed file. Clerk session tokens are sensitive credentials. A fresh session JWT may expire during longer setup; the run is intentionally capped at one minute.

## Run

PowerShell:

```powershell
$env:KOJ_BASE_URL = "https://your-staging.example"
$env:KOJ_AUTH_TOKEN = "<staging Clerk session JWT>"
$env:KOJ_PROBLEM_ID = "123"
$env:KOJ_CONTEST_ID = "456"
$env:KOJ_POLL_VUS = "1"
$env:KOJ_DURATION = "30s"
k6 run scripts/load/k6.js
```

To explicitly create one real staging submission, set the opt-in and, if useful, the solution source:

```powershell
$env:KOJ_ENABLE_SUBMIT = "true"
$env:KOJ_SOURCE_CODE = "print(input())"
k6 run scripts/load/k6.js
```

Unset `KOJ_ENABLE_SUBMIT` (or set it to anything other than `true`) for polling-only mode. To increase polling traffic within the guardrails, use `KOJ_POLL_VUS` from `1` to `5` and `KOJ_DURATION` from `1s` to `60s`.

## Results

k6 prints the measurements from each actual run (request rate, latency percentiles, failed-request rate, checks, and any threshold failures). Record its raw summary, timestamp, target environment, deployment revision, and test-data setup with the run report. This repository contains no pre-recorded performance numbers; do not treat a local run as Cloud Run capacity evidence.
