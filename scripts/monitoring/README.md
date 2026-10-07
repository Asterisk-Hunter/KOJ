# KOJ Cloud Monitoring alerts

KOJ currently exposes queue state, worker heartbeats, oldest queued age, and recent judge failures in the admin dashboard. That is operator-visible polling, not alert delivery. The API policy template uses Cloud Run's built-in request metric. The public-contest target runs the worker on the Compute Engine `koj-judge` VM, while the worker-error template still targets a Cloud Run worker-pool log resource. That worker policy does not match the VM deployment. The configured GCP project had no alert policies or notification channels at the 2026-10-07 inventory.

## Scope and limits

- API alert: more than five 5xx responses over an aligned five-minute window for the named Cloud Run HTTP service. The Cloud Run request metric labels server-error responses with `response_code_class = "5xx"`; it does not count 4xx responses.
- Worker alert template: each matching Cloud Run worker-pool `ERROR` log can open an incident; notifications are rate-limited to one per five minutes. Current infrastructure retries are logged at `WARNING`, so this template would not alert on every judge retry even if a pool were deployed.
- The templates do not monitor the Vercel Next.js deployment, Neon provider health, queue age thresholds, VM worker heartbeat, or VM availability. The GCE worker's relevant logs were not observed in Cloud Logging during inventory, so verify log shipping before creating a VM log alert.
- The policies use actual platform metrics/logs and do not publish or imply performance targets. API metrics are sampled at one-minute intervals and may arrive with delay.

## Configure

For the current VM target, first confirm that `koj-worker.service` logs reach Cloud Logging and choose an alert source that matches the GCE instance. Also decide how to alert on missing `judge_workers` heartbeats and excessive queue age. Create and verify a Monitoring notification channel; do not print its address or credentials. The account applying policies needs Cloud Monitoring policy permissions. Enable Cloud Monitoring and Cloud Logging APIs in the project.

The renderer currently covers the Cloud Run API and an optional Cloud Run worker-pool fallback; it does not render a VM worker alert. PowerShell example for that Cloud Run configuration (fill values from the deployment; don't commit generated files):

```powershell
gcloud beta monitoring channels list --format="table(name,displayName,type,enabled)"
python scripts/monitoring/render_policies.py `
  --project "YOUR_PROJECT_ID" `
  --api-service "YOUR_API_SERVICE" `
  --worker-pool "YOUR_WORKER_POOL" `
  --notification-channel "YOUR_CHANNEL_ID" `
  --output-dir "$env:TEMP\koj-monitoring-policies"
Get-ChildItem "$env:TEMP\koj-monitoring-policies\*.json" | ForEach-Object {
  gcloud monitoring policies create --policy-from-file=$_.FullName
}
```

The renderer escapes Google Cloud filter string values and writes JSON only; it does not call Google APIs. Its worker filter is for a Cloud Run worker pool, not the deployed VM. Do not apply that worker policy as VM coverage. Review each filter and recipient before applying, then test delivery with a staging-only event. Avoid artificial failures in production. Verify created policies and recipients without exposing channel addresses.

## Validate without deployment credentials

```powershell
python scripts/monitoring/render_policies.py `
  --project "demo-project" --api-service "koj-api" `
  --worker-pool "koj-judge" --notification-channel "channel-id" `
  --output-dir "$env:TEMP\koj-monitoring-policies"
Get-Content "$env:TEMP\koj-monitoring-policies\api-5xx.json" | ConvertFrom-Json | Out-Null
Get-Content "$env:TEMP\koj-monitoring-policies\worker-errors.json" | ConvertFrom-Json | Out-Null
```

This validates rendering and JSON shape only. It does not prove Google accepts a filter or that notifications reach a recipient; that requires applying the policies and testing in the target project.
