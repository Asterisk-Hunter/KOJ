# Clerk production cutover: fresh accounts

## Decision and data boundary

The owner has approved starting with new accounts in Clerk Production. Clerk Development and Production have separate user pools; users are not transferred between instances. This cutover does **not** migrate or remap Clerk IDs, roles, memberships, submissions, or account ownership. Old Neon rows and history remain as legacy historical data; they are not attached to new accounts. Do not describe this as a user/history migration. See [Clerk environments](https://clerk.com/docs/guides/development/managing-environments).

New production accounts receive their own Neon rows on first activity or through the user-created webhook. Existing development-ID rows must remain untouched. Old submissions may remain available only as historical records attributed to old IDs; new accounts cannot access them as their own history. Do not delete or anonymize those rows as part of this cutover.

## Preflight

1. Confirm production Clerk domain/DNS/SSL/mail readiness and finish setup for every intended OAuth provider. Verify the Clerk Production instance is configured for the production domain and the Vercel production environment will use its keys; keep development/preview environments separate.
2. Take and verify a restorable Neon backup. Archive a read-only inventory of existing user rows, roles, memberships, and history counts for incident reference. Preserve the archive under the project’s approved access controls; do not include secrets or session data.
3. Schedule a short maintenance window. Pause signups and user-authenticated writes while changing production auth configuration. Do not run Admin → Sync before, during, or after this cutover: it compares Clerk IDs and may delete or anonymize old Neon rows absent from the Production directory.
4. Prepare production `ADMIN_CLERK_IDS` using only verified Production Clerk user IDs for the intended bootstrap administrators. Remove all development Clerk IDs from the production allowlist. Keep Neon role data unchanged; admin access also depends on the existing Neon authorization gate.
5. Prepare the Clerk Production webhook at `/api/webhooks/clerk` for `user.created`, `user.updated`, and `user.deleted`, using its Production signing secret in the Production environment. Do not point Development webhook settings or secrets at Production. The receiver does not synchronize Clerk organization memberships into Neon; KOJ’s application roles and memberships remain Neon data.

## Cutover and rehearsal

1. Before deployment, confirm backup availability, OAuth/domain checks, production admin IDs, and that the production deployment is not configured with Development Clerk credentials.
2. Set Production `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, and `ADMIN_CLERK_IDS` in the production hosting environment, then deploy/activate the Production Clerk configuration. Do not alter Neon user IDs or historical rows.
3. Verify Production sign-in and sign-up on the production domain with designated test accounts. Confirm a new account resolves to a new Neon ID, gets the expected default contestant role, and cannot impersonate or inherit any old account’s role, memberships, or submissions. Confirm the intended Production admin can access admin functions and a non-admin is denied.
4. Verify a signed Production `user.created`/`user.updated` webhook creates or updates only the new account row, and inspect service logs for signature or database errors. Verify a controlled user deletion does not unexpectedly remove archived development-ID history; do not delete an old account as a test.
5. Check that historical submission and contest counts remain unchanged, old Neon rows still exist, and no Development IDs remain in the Production admin allowlist. Keep Admin → Sync disabled for this cutover. Resume writes only when all checks pass; record the cutover time and check results.

## Rollback

- If Production sign-in or webhook checks fail, put the app in maintenance mode and keep the Neon backup and historical rows untouched. Correct the Production Clerk configuration or roll back the application deployment while retaining Production Clerk keys for any Production sessions/accounts already created.
- Do not switch back to Development keys after Production accounts or writes exist; those identities are separate, and doing so would make the new accounts unable to sign in. If the owner chooses to return to Development, first pause writes and plan a separate recovery that accounts for every Production account and all new records. Do not restore the backup over newer data without an explicit recovery decision.

## Implementation references

- Neon user identity, memberships, and history references: `db/schema.ts`.
- Clerk user webhook synchronization and deletion behavior: `app/api/webhooks/clerk/route.ts`.
- Admin bootstrap allowlist and Neon role checks: `app/api/admin/authz.ts`.
- Admin Sync can delete or anonymize Neon rows missing from the configured Clerk directory: `app/api/admin/users/sync/route.ts`.
- Production environment variable names: `docs/deployment.md`.
