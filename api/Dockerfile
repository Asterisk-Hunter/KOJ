# KOJ judge service — FastAPI + multi-language judge (python, c, c++, java).
# Built for Google Cloud Run (also works on any container host).
# Run: docker build -t koj-judge ./api && docker run -p 8000:8000 --env-file api/.env koj-judge
# Cloud Run sets $PORT automatically; the CMD honors it.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV FASTAPI_HOST=0.0.0.0

# Concurrency: 4 workers × 1 judge task per worker = 4 concurrent tasks per
# instance. Cloud Run auto-scales instances to meet REQ-JUDGE-13 (10 concurrent).
# Set --concurrency=4 on Cloud Run to match (1 request per worker).
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 4
