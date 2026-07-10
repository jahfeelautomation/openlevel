# CLAUDE.md — Open Level Mobile App (LeadConnector Replacement)

## Source of Truth
This is the LeadConnector equivalent mobile application for the Open Level project. 
It connects to the `server/` API located in the parent directory.
Parent project map: `../CLAUDE.md`

## Architecture
- **Framework**: React Native + Expo (Expo Router for navigation)
- **Styling**: NativeWind (Tailwind CSS for React Native)
- **State/Data**: TanStack Query to interface with the Node/Hono API
- **Distribution**: TestFlight (iOS) and APK sideloading (Android) via EAS.

## Rules
- Standard ICM methodology applies here.
- Components should mirror the logic (where applicable) of the `src/` web application but use native mobile UX patterns.
- Do not store secrets here; use `.env` linked to the Expo environment variables.
