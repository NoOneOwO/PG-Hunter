# PG Hunter â€” Security Rulebook

## Core Rule
Security is part of every feature, not a final checklist.

## Secrets
- Never commit API keys, tokens or passwords.
- Use environment variables/secrets.
- Never expose server secrets to client-side JavaScript.

## Authorization
Authentication is not authorization.
Every protected server operation must verify that the current user is allowed to perform it.

## Owner Data
Owners can only modify properties they are authorized to manage.

## Student Data
Students must not see another student's private information.

## Messaging
Phone numbers must not be exposed merely because two users communicate through PG Hunter.

## Files
- Validate file type.
- Validate file size.
- Do not trust filenames.
- Restrict access to private documents.
- Never expose private documents through predictable public URLs.

## Input Validation
Validate all user-controlled input on the server.

## Database
Use parameterized queries. Never concatenate user input into SQL.

## Logging
Never log passwords, authentication tokens, full phone numbers or private documents.

## Abuse Prevention
Plan for:
- spam
- fake listings
- fraudulent owners
- malicious uploads
- abusive messages
- fake reviews
- automated scraping

## Verification
A verification badge is a trust claim. It must only be granted according to the documented verification process.


# Cloudflare Architecture Decisions â€” Security Addendum

## Turnstile

Turnstile tokens must be verified server-side by the Cloudflare Worker before accepting protected submissions.

Turnstile tokens must NOT be permanently stored in the database.

Flow:
Browser â†’ Worker â†’ Turnstile verification â†’ valid request â†’ process/store application data

## Contact and Privacy

Student and owner phone numbers must not be automatically exposed in public listing HTML or APIs unless explicitly required by an approved product flow.

Prefer:
Student â†’ Contact / Enquire â†’ PG Hunter records lead â†’ Authorized owner/admin receives lead

The future PG management system should support privacy-preserving student-owner communication.

## Authorization

Authentication and authorization must be enforced server-side. Never rely on frontend UI restrictions for access control.

## R2 Security

Public property images may be public where appropriate. Private files such as owner documents, verification evidence, or student files must use controlled access.

## MVP Security Principle

Use WAF, rate limiting, Turnstile, authorization, input validation, and secure storage where they solve real risks. Do not build unnecessary enterprise security infrastructure before the product has users.


# Cloudflare Architecture Decisions — Security Addendum

## Turnstile

Turnstile tokens must be verified server-side by the Cloudflare Worker before accepting protected submissions.

Turnstile tokens must NOT be permanently stored in the database.

Flow:

Browser
  ↓
Worker
  ↓
Turnstile verification
  ↓
Valid request
  ↓
Process and store required application data

## Contact and Privacy

Student and owner phone numbers must not be automatically exposed in public listing HTML or APIs unless explicitly required by an approved product flow.

Prefer:

Student
  ↓
Contact / Enquire
  ↓
PG Hunter records lead
  ↓
Authorized owner/admin receives lead

The future PG management system should support privacy-preserving student-owner communication.

## Authorization

Authentication and authorization must be enforced server-side.

Never rely on frontend UI restrictions for access control.

## R2 Security

Public property images may be public where appropriate.

Private files such as:

- owner documents
- verification evidence
- student files

must use controlled access.

## MVP Security Principle

Use WAF, rate limiting, Turnstile, authorization, input validation, and secure storage where they solve real risks.

Do not build unnecessary enterprise security infrastructure before the product has users.