from pathlib import Path
import sys
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.monitoring.render_policies import render_policies


def test_rendered_cloud_run_alerts_use_the_expected_resource_filters():
    policies = render_policies("demo-project", 'api"service', "judge-pool", "channel-1")

    api_filter = policies["api-5xx.json"]["conditions"][0]["conditionThreshold"]["filter"]
    worker_filter = policies["worker-errors.json"]["conditions"][0]["conditionMatchedLog"]["filter"]
    escaped_service = json.dumps('api"service')

    assert 'metric.labels.response_code_class = "5xx"' in api_filter
    assert f"resource.labels.service_name = {escaped_service}" in api_filter
    assert 'resource.type = "cloud_run_workerpool"' in worker_filter
    assert 'resource.labels.workerpool_name = "judge-pool"' in worker_filter
