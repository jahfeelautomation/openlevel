# CLAUDE.md — Open Level

## Source of Truth
The state of this project is linked to the global Second Brain. 
Global reference: `C:\Users\Ghost\.openclaw\workspace\second-brain\projects\openlevel.md`

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
