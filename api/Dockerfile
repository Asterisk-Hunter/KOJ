# KOJ judge API and pull worker — seven-language judge.
# Deploy as a Cloud Run service for HTTP and a worker pool for queue processing.
# Run: docker build -t koj-judge ./api && docker run -p 8000:8000 --env-file api/.env koj-judge
# Cloud Run sets $PORT automatically; the CMD honors it.
FROM python:3.11-slim AS toolchain

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates gcc g++ default-jdk-headless \
        golang-go rustc nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY sandbox_exec.py /usr/local/bin/koj-sandbox-exec.py

RUN mkdir -p /work /tmp \
    && chmod 1777 /work /tmp \
    && printf 'package main\nfunc main() {}\n' > /tmp/koj-warm.go \
    && GOCACHE=/work/gocache go build -o /tmp/koj-warm /tmp/koj-warm.go \
    && chmod -R a+rwX /work/gocache \
    && rm /tmp/koj-warm.go /tmp/koj-warm

FROM toolchain AS runtime

COPY --from=toolchain / /opt/koj-sandbox-root/

RUN find /opt/koj-sandbox-root -type f -perm /6000 -exec chmod a-s {} +

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV FASTAPI_HOST=0.0.0.0

RUN groupadd --system --gid 10001 koj \
    && useradd --system --uid 10001 --gid koj --home-dir /home/koj --create-home --shell /usr/sbin/nologin koj

USER 10001:10001

# The API service uses one process. Queue workers use `python -m app.worker`.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
