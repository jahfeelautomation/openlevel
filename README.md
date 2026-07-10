# OpenLevel & OpenConnector

**OpenLevel** is an open-source, self-hosted alternative to platforms like GoHighLevel. It provides a full CRM, unified inbox (SMS, Webchat, Email), pipeline management, reputation management (reviews), and calendar booking system all in one lightweight Node/React stack.

**OpenConnector** is the accompanying React Native (Expo) mobile app (the open-source alternative to LeadConnector). It allows operators to manage conversations, contacts, pipelines, and calendars on the go, without relying on proprietary app stores (designed for easy internal side-loading).

## Features

*   **Unified Inbox**: Handle SMS, Webchat, and emails in a single conversation thread.
*   **CRM & Contacts**: Keep track of leads, custom fields, notes, tasks, and tags.
*   **Pipeline Management**: Kanban board for visual sales pipeline tracking and opportunity values.
*   **Calendars & Booking**: Native scheduling, double-booking prevention, and public booking links.
*   **Reputation Management**: Request and manage reviews, calculate aggregate ratings.
*   **Mobile App (OpenConnector)**: Full native mobile app for operators to use the CRM on iOS and Android.

## Architecture

We use a "One API, Two Clients" pattern:
- `server/` - The backend API (Hono, SQLite/Postgres, Drizzle ORM).
- `src/` - The web application SPA (Vite, React, Tailwind).
- `mobile/` - The mobile application (Expo, React Native, NativeWind).

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL (or SQLite for local dev if configured)

### Installation

1.  **Clone the repository**
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Environment Setup**:
    Copy `.env.example` to `.env` and fill in your database credentials and required secrets.
    ```bash
    cp .env.example .env
    ```
4.  **Database Migration**:
    ```bash
    npm run db:migrate
    ```
5.  **Start the web app & API server**:
    ```bash
    npm run dev
    ```

### Running the Mobile App (OpenConnector)

1.  Navigate to the app directory:
    ```bash
    cd mobile
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the Expo development server:
    ```bash
    npm start
    ```
4.  Follow the prompts to run in an iOS Simulator, Android Emulator, or scan the QR code with the Expo Go app on a physical device.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
