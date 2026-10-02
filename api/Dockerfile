# KOJ judge API and pull worker — seven-language judge.
# Deploy as a Cloud Run service for HTTP and a worker pool for queue processing.
# Run: docker build -t koj-judge ./api && docker run -p 8000:8000 --env-file api/.env koj-judge
# Cloud Run sets $PORT automatically; the CMD honors it.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc g++ default-jdk-headless \
        golang-go rustc nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV FASTAPI_HOST=0.0.0.0

# The API service uses one process. Queue workers use `python -m app.worker`.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
