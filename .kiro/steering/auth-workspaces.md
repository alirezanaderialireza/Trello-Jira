# Auth & Workspaces Architecture

## Decision Log
| # | Decision | Choice | Reason |
|---|----------|--------|--------|
| D-1 | Auth lib | Auth.js v5 | Official, Drizzle adapter, large community |
| D-2 | Hash | argon2id (@node-rs/argon2) | OWASP 2024, GPU-resistant |
| D-3 | Session | Database sessions | Revocable, Auth.js built-in |
| D-4 | Email | Resend (prod) + console (dev) | Simple API, Iran-friendly |
| D-5 | Verification | Magic-link = auto-verified | |
| D-6 | Auto workspace | Yes, personal workspace on signup | |
| D-7 | Slug | Auto from name + editable | |
| D-8 | Existing data | DB empty — clean migration | |
| D-9 | Last-owner | Enforce from day 1 | |

## Schema Overview (ER)
```
users ─1:N─► workspaces (owner)
users ─M:N─► workspaces (via workspace_members)
workspaces ─1:N─► boards (via boards.tenant_id = workspaces.id)
users ─1:N─► accounts (OAuth)
users ─1:N─► sessions (DB sessions)
```

## Key Rules
- Email: always query via `email_normalized` (lowercased)
- Slug: ASCII only `[a-z0-9-]`, 2-60 chars
- Last-owner: app layer enforces >= 1 OWNER per workspace
- Personal workspace: cannot be deleted while user exists
- Session: `httpOnly`, `secure` (prod), `sameSite: lax`

## Traps
1. Email case sensitivity → always normalize before lookup
2. Auth.js Edge Runtime → no native crypto in middleware
3. Drizzle adapter column names must match exactly
4. Slug uniqueness is global (not per-tenant)
5. Personal workspace deletion blocked
6. Workspace ID from URL, never from session cookie
7. Magic link single-use → delete token after verify
8. Last-owner protection in application layer with transaction
