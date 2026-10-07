"""Static deployment checks: no gcloud, Docker daemon, secrets, or database."""

from pathlib import Path

import yaml

_API = Path(__file__).resolve().parents[1]
_DEPLOYMENT = _API.parent / "scripts" / "deployment"


def test_worker_pool_is_always_on_and_overrides_http_image_command():
    manifest = yaml.safe_load((_DEPLOYMENT / "cloudrun-worker-pool.example.yaml").read_text())
    assert manifest["apiVersion"] == "run.googleapis.com/v1"
    assert manifest["kind"] == "WorkerPool"
    assert int(manifest["metadata"]["annotations"]["run.googleapis.com/manualInstanceCount"]) > 0
    spec = manifest["spec"]["template"]["spec"]
    container, = spec["containers"]
    assert container["command"] == ["python"]
    assert container["args"] == ["-m", "app.worker"]
    env = {item["name"]: item for item in container["env"]}
    assert env["JUDGE_SANDBOX_MODE"]["value"] == "rlimit"
    assert env["DATABASE_TLS_VERIFY"]["value"] == "true"
    assert env["JUDGE_HTTP_EXECUTION_ENABLED"]["value"] == "false"
    assert "value" not in env["DATABASE_URL"]
    assert set(env["DATABASE_URL"]["valueFrom"]["secretKeyRef"]) == {"name", "key"}
    assert "serviceAccountName" in spec
    assert "ports" not in container
    assert "startupProbe" not in container


def test_repository_root_cloud_build_contexts_resolve_existing_dockerfiles():
    for filename, dockerfile in (
        ("cloudbuild-worker.yaml", "api/Dockerfile"),
        ("cloudbuild-control.yaml", "api/Dockerfile.control"),
    ):
        config = yaml.safe_load((_DEPLOYMENT / filename).read_text())
        step, = config["steps"]
        assert step["args"] == ["build", "-f", dockerfile, "-t", "${_IMAGE}", "api"]
        assert config["images"] == ["${_IMAGE}"]
        assert (_API / Path(dockerfile).name).is_file()


def test_production_image_uses_nonroot_rlimit_and_port_aware_api_command():
    dockerfile = (_API / "Dockerfile").read_text()
    assert "USER 10001:10001" in dockerfile
    assert "JUDGE_SANDBOX_MODE=rlimit" in dockerfile
    assert "${PORT:-8000}" in dockerfile
    assert "COPY requirements.txt" in dockerfile
    assert "COPY app ./app" in dockerfile
    assert (_API / "requirements.txt").is_file()
    assert (_API / "app" / "rlimit_exec.py").is_file()


def test_docker_host_probe_checks_host_environment_and_docker_socket_isolation():
    probe = (_DEPLOYMENT / "verify-docker-host.py").read_text()

    assert '"KOJ_HOST_ENV_PROBE": "koj-host-env-probe-marker"' in probe
    assert "KOJ_HOST_ENV_PROBE=koj-host-env-probe-marker" in probe
    assert "pathlib.Path('/proc').iterdir()" in probe
    assert "docker.sock" in probe
