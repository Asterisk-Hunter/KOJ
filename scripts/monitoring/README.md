# KOJ Cloud Monitoring alerts

KOJ exposes queue state, worker heartbeats, oldest queued age, and recent judge failures in the admin dashboard. The `/ready/judge` endpoint provides a minimal authenticated probe for external monitoring: it returns 503 if no idle/busy worker heartbeat is newer than 180 seconds, a due queued job has been eligible for 300 seconds, or Neon cannot be queried. It returns only `{"status":"ok"}` or `{"status":"degraded"}`. The public-contest target runs the worker on the Compute Engine `koj-judge` VM; Cloud Run hosts the control API.

## Scope and limits

- API alert: more than five 5xx responses over an aligned five-minute window for the named Cloud Run HTTP service. The Cloud Run request metric labels server-error responses with `response_code_class = "5xx"`; it does not count 4xx responses.
- VM alert: sustained average CPU utilization above 90% for five minutes on the selected Compute Engine instance. This is a host saturation signal; it does not prove that `koj-worker.service` is healthy or that the Postgres worker heartbeat and queue are fresh.
- The uptime check covers worker heartbeat freshness, due queue age, Neon query availability, and the public Cloud Run probe path. It does not monitor the Vercel Next.js deployment or establish Neon provider health when the probe itself is unavailable.
- The policies use actual platform metrics and do not claim tested capacity. API and VM metrics can arrive with delay.
- One uptime check every five minutes from three regions uses about 26,280 executions per month. Google's [Cloud Monitoring pricing page](https://cloud.google.com/products/observability/pricing) currently lists a 1,000,000-execution monthly free allotment per project, then $0.30 per 1,000 executions; charges depend on other checks sharing that allotment.

## Configure

The VM policy uses the numeric Compute Engine instance ID because the Monitoring `gce_instance` resource does not expose the instance name as a filterable label. Resolve it with `gcloud compute instances describe koj-judge --zone YOUR_ZONE --format="value(id)"`. A notification channel is optional: without one, incidents appear in Cloud Monitoring but no external notification is sent. The account applying policies needs Cloud Monitoring policy permissions. Enable Cloud Monitoring API in the project.

Create a public uptime check in Cloud Monitoring for the Cloud Run service URL, with path `/ready/judge`, HTTPS, a five-minute interval, and at least three regions (for example Asia Pacific, Europe, and USA Iowa). Set a custom request header named `X-Judge-Secret` to the same `JUDGE_INTERNAL_SECRET` value configured on Cloud Run. Enable the option to encrypt/mask custom headers before saving. The endpoint rejects requests without this secret and reveals no counts or worker identifiers. Do not put the secret in a command, source file, generated policy, or shell history. Record the resulting check ID; `gcloud monitoring uptime list-configs --format="table(displayName,name)"` lists it without revealing the masked header.

The renderer covers Cloud Run API 5xx, judge VM CPU, and (when `--worker-check-id` is supplied) the heartbeat/queue uptime alert. Fill deployment values; don't commit generated files:

```powershell
gcloud beta monitoring channels list --format="table(name,displayName,type,enabled)"
python scripts/monitoring/render_policies.py `
  --project "YOUR_PROJECT_ID" `
  --api-service "YOUR_API_SERVICE" `
  --worker-instance-id "YOUR_NUMERIC_INSTANCE_ID" `
  --worker-check-id "YOUR_UPTIME_CHECK_ID" `
  --output-dir "$env:TEMP\koj-monitoring-policies"
Get-ChildItem "$env:TEMP\koj-monitoring-policies\*.json" | ForEach-Object {
  gcloud monitoring policies create --policy-from-file=$_.FullName
}
```

Add `--notification-channel "YOUR_CHANNEL_ID"` when a verified channel exists. If API 5xx or VM CPU policies already exist, create only `worker-freshness.json` to avoid duplicates:

```powershell
gcloud monitoring policies create --policy-from-file="$env:TEMP\koj-monitoring-policies\worker-freshness.json"
```

The renderer escapes Google Cloud filter string values and writes JSON only; it does not call Google APIs or include the shared secret. Review each filter and notification channel before applying. Verify policy creation in Monitoring; testing notification delivery requires a safe staging event.

## Validate without deployment credentials

```powershell
python scripts/monitoring/render_policies.py `
  --project "demo-project" --api-service "koj-api" `
  --worker-instance-id "1234567890123456789" `
  --worker-check-id "koj-judge-readiness" `
  --output-dir "$env:TEMP\koj-monitoring-policies"
Get-Content "$env:TEMP\koj-monitoring-policies\api-5xx.json" | ConvertFrom-Json | Out-Null
Get-Content "$env:TEMP\koj-monitoring-policies\worker-vm-cpu.json" | ConvertFrom-Json | Out-Null
Get-Content "$env:TEMP\koj-monitoring-policies\worker-freshness.json" | ConvertFrom-Json | Out-Null
```

This validates rendering and JSON shape only. It does not prove Google accepts a filter or that notifications reach a recipient; that requires applying the policies and testing in the target project.
