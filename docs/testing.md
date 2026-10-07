# Testing Strategy

## Local checks

Install Node 22+, Python, and the Python test dependencies once:

```bash
npm install
python -m pip install -r api/requirements-test.txt
```

`npm test` runs colocated TypeScript tests and Python unit tests on Windows,
macOS, and Linux. Python integration tests are deliberately excluded from that
fast, hermetic command.

```bash
npm run lint
npx tsc --noEmit
npm run build
npm test
```

## CI coverage

GitHub Actions runs lint, typecheck, production build, TypeScript/Python unit
tests, a migration apply against an empty PostgreSQL database, and a Linux
judge-image job. The judge-image job runs the known-verdict corpus across the
seven supported languages and bounded `rlimit` probes. These probes do not
exercise the public target's Docker boundary on the actual judge VM.

The integration corpus can also be run on Linux with the same compiler
toolchains as the judge image:

```bash
cd api
python -m pip install -r requirements-test.txt
python -m pytest -q -m integration integration_tests
```

## What is covered

- Output capture stops a child after 1 MiB of combined stdout or stderr.
- Unit tests cover verdict helpers, output normalization/redaction, resource
  mapping, bounded retry backoff, output comparator tolerance boundaries,
  special-checker result handling and process separation, streaming request-body
  limits, scoring, invite-code handling, rejudge scope parsing, contest freeze,
  participation and clarification policies, audit metadata filtering, and
  monitoring-policy rendering.
- The known-verdict corpus checks accepted output for Python, C, C++, Java, Go,
  Rust, and JavaScript, plus Python wrong-answer, runtime-error,
  compilation-error, and time-limit outcomes.
- Linux `rlimit` probes exercise wall-time termination and file-growth caps. The Docker boundary still requires `scripts/deployment/verify-docker-host.py` on the target VM.
- Empty-database migration CI catches migration syntax/order failures, but does
  not establish which historical migrations have already run on live Neon.

The repository includes an opt-in k6 smoke/load script (`scripts/load/k6.js`);
it requires a configured base URL and does not submit source unless explicitly
enabled. Cloud Monitoring policy YAML is rendered with
`python scripts/monitoring/render_policies.py`; rendering does not create or
deploy policies.

## Limitations and required operational evidence

The CI sandbox tests run `rlimit`; they do not establish the Docker boundary
on the production VM. Empty-database migrations do not verify the live Neon
ledger. The 2026-10-07 audit checked the live ledger, worker heartbeat, Docker
host probe, and Cloud Run-to-VM direct judge canary outside CI; see
`docs/status.md`. No authenticated submission/contest rehearsal or load
benchmark is run by CI. Before a real contest, deploy the current revision,
rerun those checks, complete an authenticated submission canary, and record
queue latency and throughput under rehearsal load. Do not publish capacity or
uptime numbers until measured on the target stack.
