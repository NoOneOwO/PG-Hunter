# PG Hunter â€” Deployment Rulebook

## Environments
Development â†’ Preview â†’ Production

## Source Control
GitHub is the source of truth for code.

## Deployment
Use Cloudflare tooling appropriate to the current Astro/Workers setup.

## Environment Variables
Separate local and production secrets.
Never commit secret values.

## Pre-Deploy Checklist
- build succeeds
- type checks pass
- tests pass
- no obvious console errors
- environment variables present
- database migrations reviewed
- security-sensitive changes reviewed

## Database Changes
Schema changes must be documented and migration-safe.

## Rollback
Every production deployment should have a known rollback/recovery approach.

## Post-Deploy
Check:
- homepage
- search
- property pages
- APIs
- authentication when enabled
- database connectivity
- error logs

## Principle
A deployment is not successful because the command exited successfully; the production user experience must work.
