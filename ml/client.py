"""Small typed boundary client for the private KOJ research API."""

from __future__ import annotations

import os
import time
from urllib.parse import urlparse
from typing import Any
from uuid import UUID

import requests


class ResearchClient:
    def __init__(self, base_url: str, secret: str | None = None, timeout_s: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        parsed_url = urlparse(self.base_url)
        local_http = parsed_url.scheme == "http" and parsed_url.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed_url.scheme != "https" and not local_http:
            raise ValueError("KOJ training API URL must use HTTPS (HTTP is allowed only for localhost)")
        self.secret = secret or os.environ.get("KOJ_TRAINING_API_SECRET", "")
        if not self.secret:
            raise ValueError("KOJ_TRAINING_API_SECRET is required")
        self.timeout_s = timeout_s
        self.session = requests.Session()
        self.session.headers.update({"X-Training-Secret": self.secret})
        self.audience = os.environ.get("KOJ_TRAINING_API_AUDIENCE", self.base_url)
        self.provided_id_token = os.environ.get("KOJ_TRAINING_API_ID_TOKEN", "")
        self.id_token = ""
        self.id_token_expiry = 0.0

    def _identity_token(self) -> str:
        if self.provided_id_token:
            return self.provided_id_token
        if self.id_token and time.time() < self.id_token_expiry:
            return self.id_token
        from google.auth.transport.requests import Request
        from google.oauth2 import id_token

        self.id_token = id_token.fetch_id_token(Request(), self.audience)
        self.id_token_expiry = time.time() + 3000
        return self.id_token

    @classmethod
    def from_environment(cls) -> "ResearchClient":
        base_url = os.environ.get("KOJ_TRAINING_API_URL", "")
        if not base_url:
            raise ValueError("KOJ_TRAINING_API_URL is required")
        return cls(base_url)

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        request_headers = dict(kwargs.pop("headers", {}))
        for attempt in range(8):
            headers = dict(request_headers)
            headers["Authorization"] = f"Bearer {self._identity_token()}"
            headers["X-Training-Secret"] = self.secret
            response = self.session.request(method, f"{self.base_url}{path}", headers=headers, timeout=self.timeout_s, **kwargs)
            if response.status_code not in (429, 503) or attempt == 7:
                break
            try:
                delay = int(response.headers.get("Retry-After", "5"))
            except ValueError:
                delay = 5
            time.sleep(min(max(delay, 1), 86_400))
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("KOJ research API returned a non-object response")
        return body

    def problems(self, dataset: str, version: str, split: str, max_results: int | None = None) -> list[dict[str, str]]:
        results: list[dict[str, str]] = []
        after: str | None = None
        dataset_sha256: str | None = None
        while True:
            params: dict[str, str] = {"dataset": dataset, "version": version, "split": split, "limit": "50"}
            if after:
                params["after"] = after
            body = self._request("GET", "/v1/research/problems", params=params)
            page = body.get("problems")
            if not isinstance(page, list):
                raise ValueError("KOJ problem response is missing its problem list")
            page_digest = body.get("dataset_sha256")
            if not page:
                return results
            if not isinstance(page_digest, str) or len(page_digest) != 64:
                raise ValueError("KOJ problem response is missing its dataset digest")
            if dataset_sha256 is None:
                dataset_sha256 = page_digest
            elif dataset_sha256 != page_digest:
                raise ValueError("KOJ dataset digest changed during pagination")
            for item in page:
                if not isinstance(item, dict) or not isinstance(item.get("problem_key"), str) or not isinstance(item.get("prompt"), str):
                    raise ValueError("KOJ returned a malformed research problem")
                results.append({"problem_key": item["problem_key"], "prompt": item["prompt"], "dataset_sha256": page_digest})
                if max_results is not None and len(results) >= max_results:
                    return results
            next_after = body.get("next_after")
            if not isinstance(next_after, str):
                return results
            after = next_after

    def submit_problem(
        self,
        *,
        dataset: str,
        version: str,
        split: str,
        model_id: str,
        round_index: int,
        problem_key: str,
        candidates: list[dict[str, str]],
        idempotency_key: str,
    ) -> UUID:
        payload = {
            "dataset": dataset,
            "version": version,
            "split": split,
            "model_id": model_id,
            "round": round_index,
            "candidates": [{"sample_id": item["sample_id"], "problem_key": problem_key, "code": item["code"]} for item in candidates],
        }
        body = self._request(
            "POST",
            "/v1/research/runs",
            headers={"Idempotency-Key": idempotency_key},
            json=payload,
        )
        return UUID(body["run_id"])

    def wait_for_run(self, run_id: UUID, poll_s: float = 5.0, timeout_s: float = 7200.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        while True:
            body = self._request("GET", f"/v1/research/runs/{run_id}")
            if body.get("status") == "completed":
                return body
            if time.monotonic() >= deadline:
                raise TimeoutError(f"KOJ research run {run_id} did not finish before the timeout")
            time.sleep(poll_s)
