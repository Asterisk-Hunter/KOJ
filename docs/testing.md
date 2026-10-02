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
seven supported languages and bounded `rlimit` probes.

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
  mapping, bounded retry backoff, scoring, invite-code handling, and rejudge
  scope parsing.
- The known-verdict corpus checks accepted output for Python, C, C++, Java, Go,
  Rust, and JavaScript, plus Python wrong-answer, runtime-error,
  compilation-error, and time-limit outcomes.
- Linux `rlimit` probes exercise wall-time termination and file-growth caps.
- Empty-database migration CI catches migration syntax/order failures, but does
  not establish which historical migrations have already run on live Neon.

## Limitations and required operational evidence

The sandbox tests run `rlimit`, which is the intended Cloud Run mode. They do
not establish filesystem or network isolation; those are not provided by
`rlimit`. No production database migration, deployed Cloud Run smoke test,
contest, or load benchmark is run by CI. Before a real contest, record a
deployment smoke test, worker-failure recovery, queue p95 latency, throughput,
and participant/submission counts. Do not publish capacity or uptime numbers
until measured on the target stack.
