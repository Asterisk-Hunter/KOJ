# Judge Threat Model

## Intended use

KOJ accepts untrusted contest submissions. The public-contest target is a
dedicated Linux judge VM: a host-side worker holds restricted database
credentials, and each contestant run uses the `docker` backend in a separate
container. Cloud Run hosts the compatibility/control API. A Cloud Run worker
pool using `rlimit` is a trusted-audience fallback, not the public target.

## Docker-mode controls

- Containers have no network, a read-only root, non-root UID, dropped
  capabilities, no new privileges, a pinned seccomp profile, and no host Docker
  socket mount.
- CPU, memory, process count, writable tmpfs, output, and wall time are bounded.
- Compiled artifacts live in a per-job host `/dev/shm` tmpfs directory, mounted
  writable for compilation and read-only for each case. The host tmpfs size and
  container memory cgroup bound this storage; cleanup runs after each job.
- The host-side worker uses a separate restricted database role. The API and
  worker services keep their environment files root-owned.
- `scripts/deployment/verify-docker-host.py` probes the boundary on the target
  VM. Its success does not establish aggregate capacity or exclude a container
  escape; the kernel, Docker daemon, and host patching remain trusted.

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

## Residual risks in `rlimit` mode

`rlimit` is not a security boundary equivalent to Docker namespaces or a
dedicated judge VM. Running as non-root reduces available OS privileges, but
does not isolate the filesystem or network. A hostile program running as the
worker's UID can inspect files accessible to that UID, attempt outbound
connections, and consume shared host resources outside the limits applied to
its process. The worker's database credentials and Cloud Run identity are
high-value targets. Environment sanitization reduces accidental exposure but
does not make same-UID execution safe for hostile public users.

Do not grant the Cloud Run runtime identity unrelated project permissions.
Keep the worker pool private, use only trusted college participants, and do
not deploy this mode as a public judge for arbitrary users. The Docker VM is
the intended boundary for that threat model; validate each deployed revision.

## Not defended against

- A compromised Cloud Run host/runtime, project administrator, or judge image.
- A malicious administrator who can edit problems or inspect submissions.
- Network abuse, filesystem discovery, or cross-submission side channels in
  `rlimit` mode.
- Accurate per-process memory accounting for all supported runtimes.

The CI `rlimit` probes exercise bounded execution and known verdicts, not
filesystem or network isolation. The VM Docker probe tests the configured
boundary on one host revision; neither test proves absolute sandbox security.
