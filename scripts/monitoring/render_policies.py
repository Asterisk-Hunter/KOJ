"""Render Cloud Monitoring alert policies for a configured KOJ deployment."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def quoted_filter(value: str) -> str:
    return json.dumps(value)


def render_policies(
    project_id: str,
    api_service: str,
    worker_instance_id: str,
    channel_id: str | None,
    worker_check_id: str | None = None,
) -> dict[str, dict]:
    channels = (
        [f"projects/{project_id}/notificationChannels/{channel_id}"]
        if channel_id
        else []
    )

    policies = {
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
            "notificationChannels": channels,
            "enabled": True,
        },
        "worker-vm-cpu.json": {
            "displayName": "KOJ judge VM: sustained CPU utilization",
            "documentation": {
                "content": "The KOJ judge VM has sustained CPU utilization above 90%. Check VM and Docker resource usage, then inspect admin queue and worker observability. This policy does not verify worker process or Postgres queue freshness.",
                "mimeType": "text/markdown",
            },
            "combiner": "OR",
            "conditions": [
                {
                    "displayName": "Judge VM CPU above 90% for five minutes",
                    "conditionThreshold": {
                        "filter": (
                            'resource.type = "gce_instance" AND '
                            'metric.type = "compute.googleapis.com/instance/cpu/utilization" AND '
                            f"resource.labels.instance_id = {quoted_filter(worker_instance_id)} AND "
                            f"resource.labels.project_id = {quoted_filter(project_id)}"
                        ),
                        "aggregations": [
                            {
                                "alignmentPeriod": "300s",
                                "perSeriesAligner": "ALIGN_MEAN",
                            }
                        ],
                        "comparison": "COMPARISON_GT",
                        "thresholdValue": 0.9,
                        "duration": "300s",
                        "trigger": {"count": 1},
                    },
                }
            ],
            "notificationChannels": channels,
            "enabled": True,
        },
    }
    if worker_check_id:
        policies["worker-freshness.json"] = {
            "displayName": "KOJ judge worker: heartbeat or queue stale",
            "documentation": {
                "content": (
                    "The authenticated /ready/judge probe failed. It reports degraded when no idle/busy worker "
                    "has checked in within 180 seconds, when a due queued job has been eligible for 300 seconds, or "
                    "when Neon cannot be queried. Check koj-worker.service, Neon connectivity, and the KOJ queue."
                ),
                "mimeType": "text/markdown",
            },
            "combiner": "OR",
            "conditions": [
                {
                    "displayName": "Judge readiness uptime check failing",
                    "conditionThreshold": {
                        "filter": (
                            'metric.type = "monitoring.googleapis.com/uptime_check/check_passed" AND '
                            f"metric.label.check_id = {quoted_filter(worker_check_id)} AND "
                            'resource.type = "uptime_url"'
                        ),
                        "aggregations": [
                            {
                                "alignmentPeriod": "600s",
                                "perSeriesAligner": "ALIGN_NEXT_OLDER",
                                "crossSeriesReducer": "REDUCE_COUNT_FALSE",
                            }
                        ],
                        "comparison": "COMPARISON_GT",
                        "thresholdValue": 1,
                        "duration": "300s",
                        "trigger": {"count": 1},
                    },
                }
            ],
            "notificationChannels": channels,
            "enabled": True,
        }
    return policies


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="Google Cloud project ID")
    parser.add_argument("--api-service", required=True, help="Cloud Run HTTP service name")
    parser.add_argument("--worker-instance-id", required=True, help="Numeric Compute Engine instance ID")
    parser.add_argument("--notification-channel", help="Existing Monitoring channel ID")
    parser.add_argument("--worker-check-id", help="Check ID returned when creating the /ready/judge uptime check")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for rendered policy JSON")
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for filename, policy in render_policies(
        args.project,
        args.api_service,
        args.worker_instance_id,
        args.notification_channel,
        args.worker_check_id,
    ).items():
        path = args.output_dir / filename
        path.write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")
        print(f"Rendered {path}")


if __name__ == "__main__":
    main()
