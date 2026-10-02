# Judge Threat Model

## Intended use

KOJ is designed for a trusted-college contest audience, not arbitrary public
multi-tenant code execution. Submissions are untrusted and run in a separate
Cloud Run worker pool process, but Cloud Run deployments use the `rlimit`
backend because they cannot launch nested Docker sandboxes.

## Controls in `rlimit` mode

- Each run gets a fresh temporary working directory and process group.
- CPU time, address space where supported, process count, open descriptors,
  and file growth are bounded with OS resource limits.
- Wall time is enforced and the full process group is killed on timeout.
- Standard output and error are drained with a 1 MiB cap; output floods stop
  the process instead of consuming unbounded memory.
- Child processes receive a minimal environment rather than the worker's
  database and service environment.
- Hidden-test stdout and stderr are redacted; source and test data are not
  written to application logs.

## Residual risks

`rlimit` is not a security boundary equivalent to Docker namespaces or a
dedicated judge VM. It does not isolate the filesystem or network. A hostile
program can inspect files available to the worker's OS user, attempt outbound
connections, and consume shared host resources outside the limits applied to
its process. The worker's database credentials and Cloud Run identity are
high-value targets. Environment sanitization reduces accidental exposure but
does not make shared-UID execution safe for hostile public users.

Do not grant the Cloud Run runtime identity unrelated project permissions.
Keep the worker pool private, use only trusted college participants, and do
not deploy this mode as a public judge for arbitrary users. For that threat
model, move judging to a dedicated Linux host with container or namespace
isolation and separately scoped credentials.

## Not defended against

- A compromised Cloud Run host/runtime, project administrator, or judge image.
- A malicious administrator who can edit problems or inspect submissions.
- Network abuse, filesystem discovery, or cross-submission side channels in
  `rlimit` mode.
- Accurate per-process memory accounting for all supported runtimes.

The CI probes exercise bounded execution and known verdicts. They do not
demonstrate filesystem or network isolation, and must not be described as
proof that `rlimit` safely contains hostile code.
