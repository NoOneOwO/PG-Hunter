# PG Hunter â€” Performance Rulebook

## Goal
PG Hunter should feel extremely fast on Indian mobile networks and low-end devices.

## Principles
- Astro-first rendering
- Minimal client JavaScript
- Islands only when interactivity requires it
- Lazy-load below-the-fold content
- Optimize images
- Avoid loading all videos at once
- Avoid unnecessary third-party scripts

## Video
Do not render dozens of active YouTube players on a listing page.
Use thumbnails/placeholders and activate playback only when appropriate.

## Images
- Use responsive image sizes.
- Prefer modern formats where supported.
- Always specify dimensions/aspect ratio to reduce layout shift.

## Fonts
Use a limited font stack. Avoid unnecessary font weights.

## Components
Do not turn every small element into a client-side component.

## Performance Verification
Before declaring a major feature complete:
- production build succeeds
- no obvious console errors
- mobile layout checked
- network requests inspected
- unnecessary JS removed
- loading states considered

## Principle
Performance is a product feature.
