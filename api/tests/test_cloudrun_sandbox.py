"""Cloud Run sandbox command construction and fail-closed behavior."""

from __future__ import annotations

import subprocess
import tarfile

import pytest

from app import judge


def test_cloudrun_invocation_uses_private_root_and_no_egress(monkeypatch, tmp_path):
    launcher = tmp_path / "sandbox"
    launcher.touch()
    rootfs = tmp_path / "private-root"
    rootfs.mkdir()
    workdir = tmp_path / "submission"
    workdir.mkdir()
    (workdir / "solution.py").write_text("print(1)", encoding="utf-8")
    source_tar = judge._cloudrun_source_tar(workdir)
    with tarfile.open(source_tar) as source:
        assert source.getnames() == ["work/solution.py"]
    monkeypatch.setattr(judge, "_CLOUDRUN_CLI", launcher)
    monkeypatch.setattr(judge, "_CLOUDRUN_ROOTFS", rootfs)
    monkeypatch.setattr(judge, "_cleanup_cloudrun_sandbox", lambda _name: None)
    commands = []

    def run(command, _timeout, _stdin=None, **_kwargs):
        commands.append(command)
        marker = command[command.index("--marker") + 1]
        archive = workdir / "koj-state.tar"
        with tarfile.open(archive, "w") as output:
            output.add(workdir / "solution.py", arcname="work/solution.py")
        return judge.ProcessResult(0, "", f"{marker}\n", False)

    monkeypatch.setattr(judge, "_run_bounded_process", run)
    result = judge._run_cloudrun(None, workdir, ["python3", "solution.py"], 128, 2, export_state=True)

    assert result.returncode == 0
    command = commands[0]
    assert command[:2] == [str(launcher), "do"]
    assert command[command.index("--rootfs") + 1] == str(rootfs)
    assert command[command.index("--import-tar") + 1] == str(source_tar)
    assert "--allow-egress" not in command
    assert "--mount" not in command
    assert "DATABASE_URL" not in " ".join(command)


def test_cloudrun_requires_injected_launcher(monkeypatch, tmp_path):
    monkeypatch.setattr(judge, "_CLOUDRUN_CLI", tmp_path / "absent")
    monkeypatch.setattr(judge, "_CLOUDRUN_ROOTFS", tmp_path)
    with pytest.raises(judge.SandboxUnavailable, match="launcher or rootfs unavailable"):
        judge._run_cloudrun(None, tmp_path, ["/bin/true"], 64, 1)


def test_cloudrun_timeout_forces_cleanup(monkeypatch, tmp_path):
    launcher = tmp_path / "sandbox"
    launcher.touch()
    monkeypatch.setattr(judge, "_CLOUDRUN_CLI", launcher)
    monkeypatch.setattr(judge, "_CLOUDRUN_ROOTFS", tmp_path)
    cleaned = []
    monkeypatch.setattr(judge, "_cleanup_cloudrun_sandbox", cleaned.append)

    def timeout(_command, _seconds, _stdin=None, **_kwargs):
        raise subprocess.TimeoutExpired("sandbox", 1)

    monkeypatch.setattr(judge, "_run_bounded_process", timeout)
    with pytest.raises(subprocess.TimeoutExpired):
        judge._run_cloudrun(None, tmp_path, ["/bin/true"], 64, 1)
    assert len(cleaned) == 1
    assert cleaned[0].startswith("koj-")


def test_cloudrun_rejects_unsafe_artifact_archive(tmp_path):
    archive = tmp_path / "bad.tar"
    with tarfile.open(archive, "w") as output:
        info = tarfile.TarInfo("../secret")
        output.addfile(info)
    with pytest.raises(judge.SandboxUnavailable, match="unsafe sandbox artifact"):
        judge._validate_cloudrun_tar(archive)
