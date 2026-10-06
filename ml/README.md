# KOJ Verified Code Training

This package runs a private, bounded Python-only rejection-sampling loop against KOJ's server-held tests. Accepted code is the only SFT input. Base vs. round 1 vs. round 2 is evaluated on held-out problems with the unbiased pass@k estimator; an independently imported `external` split can be evaluated the same way. GRPO is deliberately not required.

## State and deployment

The code is behind a separate feature branch and disabled by default. It adds database migrations, a private FastAPI research API, worker support, a license-gated dataset importer, and this GPU-side training client. It has **not** been migrated or deployed to the live Cloud Run API / judge VM. Do not send experiments to the hosted judge until the branch is reviewed, both migrations are applied, the same code version is deployed to the API and worker, and the verification procedure below passes.

Model-generated source is untrusted. The research worker uses the same private Docker judge as normal submissions and never accepts tests, expected outputs, language, checker, limits, or container flags from the caller. Model samples remain out of public submissions, rankings, and contest tables. `TRAINING_API_SECRET` protects the research API, and an empty value disables it. The Docker worker uses the separate `TRAINING_WORKER_ENABLED` switch and does not receive the API secret. The `TRAINING_ORGANIZATION_ID` setting binds imported datasets and access to one DB organization. These endpoints intentionally do not use Clerk sessions or per-user cooldowns, but enforce bounded candidate size, 64 samples/run, 128 active samples, 3,000 daily samples, 100,000 retained samples, an idempotency key, and a single active research execution. Completed runs expire after 30 days. Hidden test inputs/outputs, per-test results, process output, and code are never returned by the API.

## 1. Register a licensed dataset

Create two local files; do not commit dataset contents or hidden tests:

`manifest.json`:

```json
{
  "slug": "my-code-set",
  "version": "source-commit-sha-or-immutable-release",
  "source_url": "https://example.org/dataset",
  "license_id": "CC-BY-4.0",
  "license_url": "https://creativecommons.org/licenses/by/4.0/",
  "license_reviewed": true
}
```

`problems.jsonl` has one object per problem and requires **per-problem** attribution and a reviewed license. The `tests` array is private server-side hidden test data:

```json
{"source_problem_id":"task-001","source_url":"https://example.org/task-001","license_id":"CC-BY-4.0","license_url":"https://creativecommons.org/licenses/by/4.0/","license_reviewed":true,"split":"train","prompt":"Read two integers and print their sum.","reference_solution":"a, b = map(int, input().split())\nprint(a + b)","tests":[{"stdin":"2 3\n","expected_stdout":"5\n"}]}
{"source_problem_id":"task-002","source_url":"https://example.org/task-002","license_id":"MIT","license_url":"https://opensource.org/license/mit/","license_reviewed":true,"split":"heldout","prompt":"...","reference_solution":"...","tests":[{"stdin":"...","expected_stdout":"..."}]}
```

Splits are assigned **by problem**, are immutable within a dataset version, and must not overlap. Keep a newer source revision as a new dataset version. Import from an operator machine with `DATABASE_URL` configured in `api/.env`:

```powershell
cd api
python -m app.research_import --manifest ..\ml\data\manifest.json --problems ..\ml\data\problems.jsonl
```

The importer refuses missing/unreviewed license metadata, non-HTTPS provenance, ambiguous case fields, duplicate problem IDs, oversized problems, and attempt to overwrite an imported version. It requires an operator-supplied Python reference solution for every task, runs each solution in the Docker sandbox against the proposed tests, and rejects the entire import if any reference is not accepted. It does not download or execute dataset loader scripts.

### Initial source review

- **Qwen2.5-Coder-1.5B** is the initial model: the upstream card describes a 1.54B code-specialized pretrained causal LM, Apache-2.0, and identifies SFT/RL as post-training paths. Pin its Hugging Face commit SHA (`--revision`) for each run. [Model card](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B)
- **APPS**' current Hugging Face card tags its dataset MIT, while the original repository's MIT `LICENSE` grants rights over the repository software; the tasks are curated from Codewars, AtCoder, Kattis, Codeforces and other sites. Do not infer the same license applies to every task. [Dataset card](https://huggingface.co/datasets/codeparrot/apps), [original repository](https://github.com/hendrycks/apps)
- **CodeContests** provides train/validation/test data and says non-code materials are CC BY 4.0, but its own notice warns third-party data may have separate terms; source provenance includes Codeforces, Description2Code, and CodeNet. Review each record before re-hosting. [Official repository and license notes](https://github.com/google-deepmind/code_contests)
- **TACO** says the authored dataset is Apache-2.0, while also containing MIT-licensed and web-crawled CC BY 4.0 material. Preserve row-level source/attribution and review applicable site terms; do not label the entire mixed dataset Apache by default. [Official repository and license notes](https://github.com/FlagOpen/TACO), [dataset card](https://huggingface.co/datasets/BAAI/TACO)

No external corpus is bundled or silently imported. The importer deliberately requires the owner/operator to review and record each problem's source license. APPS, CodeContests, and TACO include public tests; they are usable as KOJ-held tests only after this source review and contamination/split audit.

## 2. Install the GPU-side environment

Use one disposable GCE `g2-standard-4` (one L4, 4 vCPU, 16 GiB RAM, 24 GiB VRAM), not an always-on GPU. The package uses Transformers and PEFT directly and generates one candidate at a time to keep VRAM predictable. It refuses CPU sampling/training. Sampling flushes each candidate to JSONL, and LoRA training resumes from Transformers checkpoints; both are restartable when the persistent boot disk is retained. Pin `ml/requirements.txt` dependencies in a locked environment before a measured run.

Environment variables (never commit these):

```text
KOJ_TRAINING_API_URL=https://<private-research-api-origin>
KOJ_TRAINING_API_SECRET=<Secret-Manager-delivered-value>
KOJ_TRAINING_API_AUDIENCE=https://<private-research-api-origin>
```

Configure the research Cloud Run service to **require authentication** and grant `roles/run.invoker` only to the GPU VM service account. The client obtains an audience-bound Google ID token from VM metadata credentials; a local operator can provide a short-lived `KOJ_TRAINING_API_ID_TOKEN` for a manual smoke test. The API still checks its independent `X-Training-Secret`, and the client refuses non-HTTPS origins except localhost. Do not make this service public or expose it to the browser.

Configure the API with `TRAINING_OIDC_AUDIENCE` equal to the Cloud Run service URL and `TRAINING_OIDC_PRINCIPAL` equal to the GPU VM service-account email. The API verifies the Google token's signature, issuer, audience, verified email, and principal in addition to the training secret.
Set `TRAINING_ORGANIZATION_ID` explicitly to the approved Neon organization; leaving it empty keeps research disabled rather than defaulting to an organization.

Run one two-round experiment (the default limits 100 train and 100 held-out problems to start):

```powershell
python -m pip install -r ml/requirements.txt
python -m ml loop --dataset my-code-set --version <immutable-source-revision> `
  --model Qwen/Qwen2.5-Coder-1.5B --revision <hugging-face-commit-sha> `
  --train-problems 100 --eval-problems 100 --train-samples 16 --eval-samples 16 `
  --external-dataset <independent-benchmark> --external-version <benchmark-revision> `
  --output runs/experiment-001
```

The run performs: base held-out/external sampling and KOJ judging → train-split sampling and judging → keep only accepted code → LoRA SFT → repeat for each round. GPU artifacts, accepted code, raw generated outputs, and per-run score JSON are written to ignored local `ml/runs` or the specified output directory, not to Git. If the daily KOJ research cap is reached, the client observes `Retry-After` and resumes after the reset. Holdout/external splits are never loaded into the SFT corpus.

For each model round, `*-metrics.json` contains per-problem unbiased pass@k averages for k values supported by the sample count. Do not average raw sample-level correctness as pass@k. Failed infrastructure samples are excluded and surfaced separately; repeat them only after investigating the queue, and keep the sampling protocol fixed across base/R1/R2. A separate `external` dataset and hidden tests are required for external evaluation. Function-only benchmarks such as HumanEval+/MBPP+ need a reviewed stdin/stdout adapter or their official evaluator; do not pretend the standard KOJ input/output API evaluates function calls directly.

## 3. GPU quota and spend guardrails

The active GCP project already reports **one standard NVIDIA L4** in `us-central1`; one is enough for this model, so no A100 request is needed. It reports zero dedicated `PREEMPTIBLE_CPUS`. Google documents that Free Trial billing accounts cannot request quota changes, and Spot/preemptible capacity can be reclaimed. The project's exact $300 credit state/expiry must be checked in Billing Overview before launch; `gcloud billing projects describe` only proves billing is enabled.

At the current published US G2 rate, `g2-standard-4` is about **$0.7068/hour on-demand** and **$0.4027/hour Spot**, before storage/network and any region/account adjustment. 100 on-demand GPU hours are about $70.68. Spot costs less but can disappear mid-run, so keep the boot persistent disk (`--boot-disk-auto-delete=no`), resume using the identical command/output path, and do not rely on Spot for an uninterrupted deadline. A retained disk still costs while the VM is stopped; delete it after copying run artifacts to a reviewed durable store. [G2 pricing](https://cloud.google.com/products/compute/pricing/accelerator-optimized), [Spot pricing and behavior](https://cloud.google.com/spot-vms/pricing), [quota rules](https://docs.cloud.google.com/compute/resource-usage), [Free Trial overview](https://docs.cloud.google.com/free/docs/free-cloud-features).

KOJ's existing backend has a separate estimated baseline of roughly $160/90 days before egress, storage, Cloud Run variability, and other use; this is not a guaranteed cap. Credit remaining is therefore unverified. Use short-lived VMs, persistent checkpoints, cost alerts plus a manual stop check, and delete the GPU VM immediately after sampling/training. Alerts are not spend caps. First measure one sampling batch, one LoRA epoch, and KOJ submissions/second; adjust dataset/sample counts to the measured throughput and remaining credit before scaling to hundreds of tasks.

## 4. Deploy and verify this feature branch

Do not deploy to the existing public service from this branch. When the feature is reviewed and merged, run the two new Drizzle migrations on a reviewed database, deploy the research API as a private Cloud Run service, and deploy the same source revision to the isolated Docker VM worker. Deliver `TRAINING_API_SECRET` from Secret Manager only to the private API; set `TRAINING_WORKER_ENABLED=true` only on the Docker worker. Keep `TRAINING_ORGANIZATION_ID` bound to the approved research organization. The API remains disabled when the secret is absent, and the worker remains disabled unless explicitly enabled.

Verification before first GPU run:

1. Typecheck/build/lint/unit suite; apply migrations to a disposable Postgres and verify dataset/problem/run/sample rows.
2. Verify missing/incorrect secrets fail; reject bad splits, hidden-test fields, unsupported languages, oversized payloads, duplicate IDs, idempotency mismatch, and queue/daily/storage limits.
3. Submit a known-correct and known-wrong Python candidate in each split; verify final verdicts with no test count, stdin/stdout/stderr, code, or per-case result in API responses/logs.
4. Kill the worker mid-candidate; verify lease expiry reclaims it and a stale attempt cannot overwrite the new verdict. Confirm regular submissions remain ahead of research work.
5. Run 16 samples/problem on a small reviewed research split; check dataset hashes, model commit SHA, seeds, accepted-only SFT inputs, held-out isolation, and manually inspect accepted samples for hard-coded sample outputs/weak tests.
6. Record base/R1/R2 pass@1 and pass@k on the identical held-out problems, independent external score, number of accepted samples, judge throughput, GPU hours, actual spend, and contamination limitations. No result claims until these are measured.
