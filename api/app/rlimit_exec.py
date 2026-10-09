"""Install limits in a fresh interpreter, never in a threaded parent's fork hook."""

from __future__ import annotations

import argparse
import os
import resource
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cpu-seconds", type=int, required=True)
    parser.add_argument("--memory-mb", type=int, required=True)
    parser.add_argument("--file-bytes", type=int, required=True)
    parser.add_argument("--nproc", type=int, required=True)
    parser.add_argument("--marker", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.cpu_seconds < 1 or min(args.memory_mb, args.file_bytes, args.nproc) < 0:
        parser.error("invalid process limits or command")

    try:
        resource.setrlimit(resource.RLIMIT_CPU, (args.cpu_seconds, args.cpu_seconds + 1))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if args.file_bytes:
            resource.setrlimit(resource.RLIMIT_FSIZE, (args.file_bytes, args.file_bytes))
        if args.memory_mb:
            cap = args.memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
        if args.nproc:
            resource.setrlimit(resource.RLIMIT_NPROC, (args.nproc, args.nproc))
        _, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        cap = min(256, hard) if hard != resource.RLIM_INFINITY else 256
        resource.setrlimit(resource.RLIMIT_NOFILE, (cap, cap))
        os.write(2, f"{args.marker}\n".encode("ascii"))
        os.execvpe(command[0], command, os.environ)
    except (OSError, ValueError):
        # The parent distinguishes setup/exec failures from contestant exits,
        # without publishing paths or any exception details.
        os.write(2, f"{args.marker}:failed\n".encode("ascii"))
        sys.exit(125)


if __name__ == "__main__":
    main()
