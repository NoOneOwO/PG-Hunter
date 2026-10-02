# PG Hunter â€” Coding Standards

## General
- TypeScript preferred.
- Keep functions focused.
- Prefer readable code over clever code.
- Avoid unnecessary abstractions.
- Avoid premature optimization.

## Astro
- Prefer .astro components for static UI.
- Use client-side islands only where required.
- Keep data fetching server-side when possible.

## Naming
- Components: PascalCase
- Variables/functions: camelCase
- Constants: UPPER_SNAKE_CASE only when appropriate
- Files: consistent kebab-case or project convention

## Components
Build reusable components for:
- navigation
- buttons
- inputs
- property cards
- badges
- filters
- modals
- notifications

Do not create abstractions for one-off elements unless useful.

## Styling
Use Tailwind utility classes consistently with the design system.
Do not scatter arbitrary colors or spacing values when design tokens exist.

## Error Handling
Errors must produce useful user-facing states and useful developer diagnostics without leaking secrets.

## Git
Use small, meaningful commits.
Do not mix unrelated changes.
