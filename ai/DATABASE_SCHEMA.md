# PG Hunter â€” Database Schema

## Core Tables

### users
id, role, name, email, phone_private, created_at, updated_at

### colleges
id, name, slug, city, locality, latitude, longitude, created_at

### properties
id, owner_id, name, slug, property_type, address, locality, latitude, longitude, description, verification_status, status, created_at, updated_at

### property_colleges
property_id, college_id, distance_meters

### rooms
id, property_id, room_type, occupancy, rent, deposit, available_count, status

### amenities
id, name, slug

### property_amenities
property_id, amenity_id

### media
id, property_id, type, provider, external_id, title, sort_order

### reviews
id, property_id, user_id, rating, title, body, status, created_at

### leads
id, property_id, student_id, source, budget, move_in_date, status, created_at, updated_at

## Future Management Tables
residents
messages
message_attachments
announcements
notifications
bills
bill_items
payments
maintenance_requests
documents

## Rules
- Use stable IDs.
- Add created_at and updated_at to mutable entities.
- Never store unnecessary personal data.
- Never store raw passwords.
- Phone numbers are private.
- Keep verification status explicit.
- Do not store video files in D1.
- Database constraints and indexes must be deliberate.

## Index Priorities
Plan indexes around:
- college
- locality
- rent
- property status
- verification status
- owner
- availability
- lead status


# Cloudflare Architecture Decisions â€” Database Addendum

## Property and Room Model

A PG/property may contain multiple room or occupancy options.

Property
  â†“
Rooms
  â”œâ”€â”€ Single
  â”œâ”€â”€ Double sharing
  â”œâ”€â”€ Triple sharing
  â””â”€â”€ Other supported occupancy types

Rent should be represented at the room/occupancy level where appropriate.

Example:
- Single room â†’ â‚¹18,000/month
- Double sharing â†’ â‚¹13,000/month
- Triple sharing â†’ â‚¹10,000/month

The UI may display a "starting from" price while preserving room-level pricing.

## Verification Model

Do not model PG Hunter verification as only a boolean.

Use:
- `unverified`
- `pg_hunter_verified`
- `rishabh_irl_verified`

Future verification metadata may include:
- verified_at
- verified_by
- verification_method
- verification_notes

"Verified by Rishabh IRL" is a meaningful product/brand state and must not be treated as identical to an ordinary listing.

## Database Principle

D1 is the primary structured datastore for the MVP. Keep the schema normalized enough to support multiple room types, colleges, localities, amenities, leads, and verification records without premature complexity.


# Cloudflare Architecture Decisions — Database Addendum

## Property and Room Model

A PG/property may contain multiple room or occupancy options.

Property
  ↓
Rooms
  ├── Single
  ├── Double sharing
  ├── Triple sharing
  └── Other supported occupancy types

Rent should be represented at the room/occupancy level where appropriate.

Example:

- Single room → ₹18,000/month
- Double sharing → ₹13,000/month
- Triple sharing → ₹10,000/month

The UI may display a "starting from" price while preserving room-level pricing.

## Verification Model

Do not model PG Hunter verification as only a boolean.

Use:

- `unverified`
- `pg_hunter_verified`
- `rishabh_irl_verified`

Future verification metadata may include:

- verified_at
- verified_by
- verification_method
- verification_notes

"Verified by Rishabh IRL" is a meaningful product/brand state and must not be treated as identical to an ordinary listing.

## Database Principle

D1 is the primary structured datastore for the MVP.

Keep the schema normalized enough to support multiple room types, colleges, localities, amenities, leads, and verification records without premature complexity.