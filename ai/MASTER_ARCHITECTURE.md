# PG Hunter â€” Master Architecture

## Initial Stack
- Frontend: Astro 6
- Language: TypeScript
- Styling: Tailwind CSS 4
- Icons: Lucide
- Backend/API: Cloudflare Workers
- Database: Cloudflare D1
- Video: YouTube initially
- Source control: GitHub
- Deployment: Cloudflare Workers
- Authentication: introduce only when required; evaluate Supabase Auth at the account/management phase
- AI: Gemini or OpenAI later

## Architecture Principle
Static-first. Server-render or statically generate as much as possible. JavaScript is an island, not the default.

## Request Flow
Student â†’ Astro page â†’ Cloudflare Worker/API â†’ D1 â†’ response â†’ UI.

## Media Flow
YouTube stores/streams videos initially. PG Hunter stores metadata and YouTube video IDs, not large video files.

## Future Management Flow
Student/Owner â†’ authenticated application â†’ Worker â†’ authorization layer â†’ management data.

## Repository Principles
- Keep business logic out of presentation components.
- Keep API/database access behind clear server-side modules.
- Never expose secrets to browser code.
- Avoid unnecessary dependencies.
- Prefer platform capabilities over third-party packages.

## Scalability
The architecture must allow migration/addition of:
- object storage
- queues
- search infrastructure
- analytics
- payments
without rewriting the entire frontend.


# Cloudflare Architecture Decisions â€” Final

## Locked Architecture

PG Hunter uses:

Astro 6 + TypeScript + Tailwind CSS
        â†“
Cloudflare Workers
        â†“
Cloudflare D1
        â†“
Cloudflare R2 (images/files when required)
        â†“
YouTube (MVP property videos)

### Frontend
- Astro 6 is the locked frontend framework.
- Use Astro Islands Architecture.
- Keep pages static-first.
- Use JavaScript only where interactivity is actually required.
- Next.js is NOT part of PG Hunter.

### Backend
- Cloudflare Workers provide server/API functionality.
- Keep the Worker layer focused on application logic, authorization, validation, and database/storage access.

### Database
- Cloudflare D1 is the primary SQL database.

### Media
- Cloudflare R2 is the planned storage layer for property photos and controlled/private files.
- MVP property walkthrough videos are hosted on YouTube.
- Cloudflare Stream is NOT used for the MVP.

### Deferred Infrastructure
Postpone until a real requirement exists:
- Workers AI
- Vectorize
- Cloudflare Stream
- Queues
- Workflows
- Durable Objects
- Hyperdrive
- KV as a primary application datastore

### Core Principle
Do not introduce infrastructure simply because it exists. Build the smallest architecture that supports the current PG Hunter product and scale it when real usage justifies additional services.


# Cloudflare Architecture Decisions — Final

## Locked Architecture

PG Hunter uses:

Astro 6 + TypeScript + Tailwind CSS
        ↓
Cloudflare Workers
        ↓
Cloudflare D1
        ↓
Cloudflare R2 (images/files when required)
        ↓
YouTube (MVP property videos)

### Frontend

- Astro 6 is the locked frontend framework.
- Use Astro Islands Architecture.
- Keep pages static-first.
- Use JavaScript only where interactivity is actually required.
- Next.js is NOT part of PG Hunter.

### Backend

- Cloudflare Workers provide server/API functionality.
- Keep the Worker layer focused on application logic, authorization, validation, and database/storage access.

### Database

- Cloudflare D1 is the primary SQL database.

### Media

- Cloudflare R2 is the planned storage layer for property photos and controlled/private files.
- MVP property walkthrough videos are hosted on YouTube.
- Cloudflare Stream is NOT used for the MVP.

### Deferred Infrastructure

Postpone until a real requirement exists:

- Workers AI
- Vectorize
- Cloudflare Stream
- Queues
- Workflows
- Durable Objects
- Hyperdrive
- KV as a primary application datastore

### Core Principle

Do not introduce infrastructure simply because it exists. Build the smallest architecture that supports the current PG Hunter product and scale it when real usage justifies additional services.