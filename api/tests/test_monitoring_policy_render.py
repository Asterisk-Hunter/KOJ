from pathlib import Path
import sys
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.monitoring.render_policies import render_policies


def test_rendered_alerts_target_the_cloud_run_api_and_compute_engine_worker_vm():
    policies = render_policies("demo-project", 'api"service', '123"456', "channel-1")

    api_filter = policies["api-5xx.json"]["conditions"][0]["conditionThreshold"]["filter"]
    worker_policy = policies["worker-vm-cpu.json"]
    worker_condition = worker_policy["conditions"][0]["conditionThreshold"]
    worker_filter = worker_condition["filter"]
    escaped_service = json.dumps('api"service')
    escaped_instance_id = json.dumps('123"456')

    assert 'metric.labels.response_code_class = "5xx"' in api_filter
    assert f"resource.labels.service_name = {escaped_service}" in api_filter
    assert 'resource.type = "gce_instance"' in worker_filter
    assert 'metric.type = "compute.googleapis.com/instance/cpu/utilization"' in worker_filter
    assert f"resource.labels.instance_id = {escaped_instance_id}" in worker_filter
    assert worker_condition["thresholdValue"] == 0.9
    assert worker_condition["duration"] == "300s"
    assert worker_policy["notificationChannels"] == [
        "projects/demo-project/notificationChannels/channel-1"
    ]


def test_rendered_alerts_can_be_created_without_notification_channels():
    policies = render_policies("demo-project", "koj-api", "123456", None)

    assert all(policy["notificationChannels"] == [] for policy in policies.values())


def test_worker_freshness_policy_targets_uptime_check_without_internal_secret():
    policies = render_policies(
        "demo-project", "koj-api", "123456", "channel-1", "koj-judge-readiness"
    )
    policy = policies["worker-freshness.json"]
    condition = policy["conditions"][0]["conditionThreshold"]

    assert 'metric.type = "monitoring.googleapis.com/uptime_check/check_passed"' in condition["filter"]
    assert 'metric.label.check_id = "koj-judge-readiness"' in condition["filter"]
    assert condition["duration"] == "300s"
    assert policy["notificationChannels"] == [
        "projects/demo-project/notificationChannels/channel-1"
    ]
    assert "JUDGE_INTERNAL_SECRET" not in json.dumps(policy)
