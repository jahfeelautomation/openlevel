# CLAUDE.md — Open Level

## Source of Truth
Project notes live in shared memory (`C:\Users\bryan\.openclaw\workspace\ai-context\memory\`). Open the `project_openlevel_*` entries from `MEMORY-INDEX.md`, starting with `project_openlevel_scope_locked.md`.
OpenLevel stays separate from the client portal: see D-46 in `ai-context\rules\DECISIONS_ACTIVE.md`.

## Architecture & Routing
This project consists of two main clients that connect to a single backend API (mimicking GoHighLevel).

| Component | Path | Description |
|-----------|------|-------------|
| **Web App** | `src/` | React/Vite front-end for agencies/admins (GoHighLevel equivalent). |
| **Mobile App** | `mobile/` | Expo/React Native app for users on the go (LeadConnector equivalent). See `mobile/CLAUDE.md`. |
| **Backend API** | `server/` | Node/Hono API backend and database (shared). |

## Rules
- Standard ICM methodology applies here.
- Any major architectural changes must be reflected in the Second Brain.
