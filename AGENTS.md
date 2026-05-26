# Repository Guidelines

## Project Structure & Module Organization

This repository contains `teleport`, a room-based paste and file sync app. The React/Vite frontend lives in `src/`, with the main component in `src/main.tsx` and global styling in `src/styles.css`. The TypeScript Node/Express API, SQLite storage, upload handling, SSE room updates, and static asset serving are in `server.ts`. Production container files are in `docker/`, `Dockerfile`, and `docker-compose.yml`. Runtime data is stored under `data/` locally, or `/app/data` in Docker; do not commit uploaded files or SQLite databases. `public/` contains legacy/static assets and should not be the primary place for new app code.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start the Vite dev server on `0.0.0.0`.
- `npm run build`: type-check the frontend, compile `server.ts` into `dist-server/`, then build frontend assets into `dist/`.
- `npm start`: run the compiled backend from `dist-server/server.js`.
- `docker build -t teleport:production .`: build the nginx + Node production image.
- `docker compose up -d --build`: build and run the production stack on port `7777`.

## Coding Style & Naming Conventions

Use TypeScript/React for frontend code and TypeScript ESM for the server. Keep indentation at two spaces, prefer `const` over `let`, and use descriptive camelCase names for functions, variables, and React state. React components use PascalCase. Keep UI changes in `src/main.tsx` and `src/styles.css` unless a new module clearly reduces complexity. Use existing lucide icons and the current light, minimal design language.

## Testing Guidelines

There is no dedicated test runner configured. Treat `npm run build` as the required baseline check before handoff. For UI changes, verify in a browser or with Playwright screenshots against `http://127.0.0.1:7777/`. For API/storage changes, exercise room item creation, deletion, file download, and 24-hour expiry behavior manually.

## Commit & Pull Request Guidelines

Git history is not available in this working copy, so use concise imperative commit messages such as `Add room intro prompt` or `Fix image paste preview`. Pull requests should include a short summary, verification steps, screenshots for UI changes, and any migration or data-volume notes.

## Security & Configuration Tips

Keep `/app/data` mounted in production so uploads and `pasteroom.sqlite` survive container replacement. Text items may be encrypted client-side; files are stored as uploaded. Avoid logging paste contents, passwords, or file paths beyond what is needed for debugging.
