# Lime Security Checklist

This file records the current security baseline for Lime and the remaining launch blockers that require external infrastructure or operator decisions.

## Current Code Baseline

- ASP.NET Identity uses a password policy of 8+ characters with at least one digit, unique email addresses, lockout after 5 failed sign-in attempts for 15 minutes, and a shared login policy for UI, MVC models, and Identity.
- Authentication cookies, session cookies, and antiforgery cookies have explicit `HttpOnly`, `SameSite=Lax`, and `SecurePolicy=SameAsRequest` settings.
- Unsafe HTTP methods are protected by global antiforgery validation, with explicit opt-outs only for public form submit, billing webhook, and CSP report ingestion.
- Sensitive POST endpoints use explicit request-size limits; heavy export endpoints and external API proxies have rate limits.
- Public form submissions use honeypot, time trap, same-host return redirects, request-size limits, and IP rate limits.
- Profile changes require the current password for login, email, or password changes. Email changes reset confirmation and send a new confirmation email.
- Logout is side-effect-free on GET and requires POST plus antiforgery for the real sign-out.
- Public published pages get strict CSP. App pages get report-only CSP while inline editor scripts still exist.
- Baseline security headers include `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy`.
- Authenticated responses are marked `no-store`.
- Media upload validation checks extension, MIME type, magic bytes, server-side image decoding, file size, request size, and plan storage limits.
- Local media storage rejects path segments in stored file names.
- Production startup validation fails fast for unsafe `AllowedHosts`, partial SMTP config, email-confirmation without SMTP, missing database config, and partial AI config.
- Dependency audit checks have been run for NuGet and npm during the hardening sprint.

## Production Required Settings

Before exposing Lime to real users, production must set:

- `AllowedHosts` to the real public host, not `*`, empty, or localhost-only.
- `POSTGRES_PASSWORD` to a non-default secret.
- `DOMAIN` in `compose.prod.yml` / `.env`.
- `SMTP_HOST` and `SMTP_FROM` together if email delivery is enabled.
- `Identity__RequireConfirmedEmail=true` only after SMTP is actually configured and tested.
- `AI_API_KEY` only on the server, never in frontend code.
- `STOCK_PEXELS_KEY` only on the server.

Recommended pre-release commands:

```bash
dotnet test Lime_Editor.sln
dotnet list Lime_Editor.sln package --vulnerable --include-transitive
npm audit --audit-level=moderate
```

## Remaining External Blockers

These are not code-hardening tasks and need infrastructure or account setup:

- SMTP provider: required before enabling `Identity__RequireConfirmedEmail=true`.
- Off-site backups: sync `backups_data` to S3/R2 or another external store and perform a staging restore drill.
- Redis or equivalent shared state: required before running multiple app instances, because sessions and rate limits are currently process-local.
- S3/R2 media storage: required before multi-instance or ephemeral-container deployment of user media.
- Error tracking and log aggregation: Sentry/GlitchTip plus Seq/Loki or equivalent should be configured before real beta users.
- Payment provider: `ManualPaymentProvider` is still a placeholder; real billing needs signed webhooks and subscription application.

## Operator Notes

- Do not commit `.env`, local secrets, database dumps, media archives, or backup archives.
- Treat CSP reports as telemetry, not as trusted user input.
- Treat public published pages as user-controlled content. Keep strict CSP on `/u/*` until publications are isolated on a separate domain.
- Re-run dependency audits after package updates and before public releases.
