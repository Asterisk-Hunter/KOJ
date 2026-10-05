"""Apply per-command limits before launching code inside a Cloud Run sandbox."""

from __future__ import annotations

import argparse
import ctypes
import os
import resource


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
    if not command or args.cpu_seconds < 1 or args.memory_mb < 0 or args.file_bytes < 1 or args.nproc < 1:
        parser.error("invalid sandbox limits or command")

    resource.setrlimit(resource.RLIMIT_CPU, (args.cpu_seconds, args.cpu_seconds + 1))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (args.file_bytes, args.file_bytes))
    if args.memory_mb:
        cap = args.memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
    resource.setrlimit(resource.RLIMIT_NPROC, (args.nproc, args.nproc))
    _, nofile_hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    nofile = min(256, nofile_hard) if nofile_hard != resource.RLIM_INFINITY else 256
    resource.setrlimit(resource.RLIMIT_NOFILE, (nofile, nofile))
    if os.geteuid() == 0:
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "failed to set no_new_privs")
    os.write(2, f"{args.marker}\n".encode("ascii"))
    os.execvpe(command[0], command, {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/work", "TMPDIR": "/work", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"})


if __name__ == "__main__":
    main()
