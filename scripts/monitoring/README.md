# KOJ Cloud Monitoring alerts

KOJ currently exposes queue state, worker heartbeats, oldest queued age, and recent judge failures in the admin dashboard. That is operator-visible polling, not alert delivery. These small policy definitions add Cloud Monitoring notifications for Cloud Run HTTP API 5xxs and judge-worker `ERROR` logs. They use Cloud Run's built-in request metric and the worker pool's Cloud Logging resource; there is no new runtime, database table, secret, or application code.

## Scope and limits

- API alert: more than five 5xx responses over an aligned five-minute window for the named Cloud Run HTTP service. The Cloud Run request metric labels server-error responses with `response_code_class = "5xx"`; it does not count 4xx responses.
- Worker alert: each matching worker `ERROR` log can open an incident; notifications are rate-limited to one per five minutes. Current worker infrastructure retries are logged at `WARNING`, so this detects unexpected exceptions/queue failures, not every judge infrastructure retry.
- These are Cloud Run alerts only. They do not monitor the Vercel Next.js deployment, Neon database provider health, queue age thresholds, or Cloud Run worker-pool instance count. Keep the admin dashboard and provider-level monitoring in the operational checklist; don't treat these policies as end-to-end coverage.
- The policies use actual platform metrics/logs and do not publish or imply performance targets. API metrics are sampled at one-minute intervals and may arrive with delay.

## Configure

Create and verify an email, PagerDuty, or other Monitoring notification channel first. Confirm the recipient; store only the non-secret channel ID in your shell, not an email API credential. The account applying policies needs Cloud Monitoring policy permissions. Enable Cloud Monitoring and Cloud Logging APIs in the project.

PowerShell example (fill values from your own staging/production Cloud Run deployment; don't commit generated files):

```powershell
gcloud monitoring channels list --format="table(name,displayName,type,enabled)"
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

Review each rendered filter and recipient before applying. The renderer escapes Google Cloud filter string values and writes JSON only; it does not call Google APIs. Use Cloud Monitoring's policy list/details to verify the created policies, then deliberately generate a staging-only API failure / worker error to test delivery. Avoid creating artificial failures in production. Delete or disable test policies after verification.

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
