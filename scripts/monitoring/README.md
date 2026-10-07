# KOJ Cloud Monitoring alerts

KOJ currently exposes queue state, worker heartbeats, oldest queued age, and recent judge failures in the admin dashboard. That is operator-visible polling, not alert delivery. The API policy template uses Cloud Run's built-in request metric. The public-contest target runs the worker on the Compute Engine `koj-judge` VM. The configured GCP project had no alert policies or notification channels at the 2026-10-07 inventory.

## Scope and limits

- API alert: more than five 5xx responses over an aligned five-minute window for the named Cloud Run HTTP service. The Cloud Run request metric labels server-error responses with `response_code_class = "5xx"`; it does not count 4xx responses.
- VM alert: sustained average CPU utilization above 90% for five minutes on the selected Compute Engine instance. This is a host saturation signal; it does not prove that `koj-worker.service` is healthy or that the Postgres worker heartbeat and queue are fresh.
- The templates do not monitor the Vercel Next.js deployment, Neon provider health, queue age thresholds, VM worker heartbeat, or VM availability. The worker heartbeat and queue age live in Neon and are not exported to Cloud Monitoring.
- The policies use actual platform metrics and do not claim tested capacity. API and VM metrics can arrive with delay.

## Configure

The VM policy uses the numeric Compute Engine instance ID because the Monitoring `gce_instance` resource does not expose the instance name as a filterable label. Resolve it with `gcloud compute instances describe koj-judge --zone YOUR_ZONE --format="value(id)"`. A notification channel is optional: without one, incidents appear in Cloud Monitoring but no external notification is sent. The account applying policies needs Cloud Monitoring policy permissions. Enable Cloud Monitoring API in the project.

The renderer covers the Cloud Run API and a Compute Engine VM CPU alert. Fill deployment values; don't commit generated files:

```powershell
gcloud beta monitoring channels list --format="table(name,displayName,type,enabled)"
python scripts/monitoring/render_policies.py `
  --project "YOUR_PROJECT_ID" `
  --api-service "YOUR_API_SERVICE" `
  --worker-instance-id "YOUR_NUMERIC_INSTANCE_ID" `
  --output-dir "$env:TEMP\koj-monitoring-policies"
Get-ChildItem "$env:TEMP\koj-monitoring-policies\*.json" | ForEach-Object {
  gcloud monitoring policies create --policy-from-file=$_.FullName
}
```

Add `--notification-channel "YOUR_CHANNEL_ID"` to both policies when a verified channel exists. The renderer escapes Google Cloud filter string values and writes JSON only; it does not call Google APIs. Review each filter and notification channel before applying. Verify policy creation in Monitoring; testing notification delivery requires a safe staging event.

## Validate without deployment credentials

```powershell
python scripts/monitoring/render_policies.py `
  --project "demo-project" --api-service "koj-api" `
  --worker-instance-id "1234567890123456789" `
  --output-dir "$env:TEMP\koj-monitoring-policies"
Get-Content "$env:TEMP\koj-monitoring-policies\api-5xx.json" | ConvertFrom-Json | Out-Null
Get-Content "$env:TEMP\koj-monitoring-policies\worker-vm-cpu.json" | ConvertFrom-Json | Out-Null
```

This validates rendering and JSON shape only. It does not prove Google accepts a filter or that notifications reach a recipient; that requires applying the policies and testing in the target project.
