"""Render Cloud Monitoring alert policies for a configured KOJ deployment."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def quoted_filter(value: str) -> str:
    return json.dumps(value)


def render_policies(project_id: str, api_service: str, worker_pool: str, channel_id: str) -> dict[str, dict]:
    channel = f"projects/{project_id}/notificationChannels/{channel_id}"

    return {
        "api-5xx.json": {
            "displayName": "KOJ Cloud Run API: elevated 5xx responses",
            "documentation": {
                "content": "The KOJ Cloud Run compatibility API returned more than five 5xx responses in a five-minute window. Check Cloud Run revision logs and the Neon connection/health state.",
                "mimeType": "text/markdown",
            },
            "combiner": "OR",
            "conditions": [
                {
                    "displayName": "More than five 5xx responses in five minutes",
                    "conditionThreshold": {
                        "filter": (
                            'resource.type = "cloud_run_revision" AND '
                            'metric.type = "run.googleapis.com/request_count" AND '
                            'metric.labels.response_code_class = "5xx" AND '
                            f"resource.labels.service_name = {quoted_filter(api_service)} AND "
                            f"resource.labels.project_id = {quoted_filter(project_id)}"
                        ),
                        "aggregations": [
                            {
                                "alignmentPeriod": "300s",
                                "perSeriesAligner": "ALIGN_DELTA",
                                "crossSeriesReducer": "REDUCE_SUM",
                            }
                        ],
                        "comparison": "COMPARISON_GT",
                        "thresholdValue": 5,
                        "duration": "0s",
                        "trigger": {"count": 1},
                    },
                }
            ],
            "notificationChannels": [channel],
            "enabled": True,
        },
        "worker-errors.json": {
            "displayName": "KOJ Cloud Run worker: error log",
            "documentation": {
                "content": "A KOJ judge worker emitted an ERROR log. Inspect the matching Cloud Logging entry and admin queue/worker observability before retrying jobs.",
                "mimeType": "text/markdown",
            },
            "combiner": "OR",
            "conditions": [
                {
                    "displayName": "Judge worker error log entry",
                    "conditionMatchedLog": {
                        "filter": (
                            'resource.type = "cloud_run_workerpool" AND '
                            f"resource.labels.workerpool_name = {quoted_filter(worker_pool)} AND "
                            f"resource.labels.project_id = {quoted_filter(project_id)} AND severity >= ERROR"
                        )
                    },
                }
            ],
            "notificationChannels": [channel],
            "alertStrategy": {
                "notificationRateLimit": {"period": "300s"},
                "autoClose": "1800s",
            },
            "enabled": True,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="Google Cloud project ID")
    parser.add_argument("--api-service", required=True, help="Cloud Run HTTP service name")
    parser.add_argument("--worker-pool", required=True, help="Cloud Run worker pool name")
    parser.add_argument("--notification-channel", required=True, help="Existing Monitoring channel ID")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for rendered policy JSON")
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for filename, policy in render_policies(
        args.project,
        args.api_service,
        args.worker_pool,
        args.notification_channel,
    ).items():
        path = args.output_dir / filename
        path.write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")
        print(f"Rendered {path}")


if __name__ == "__main__":
    main()
