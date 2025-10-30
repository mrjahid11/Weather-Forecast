# Weather App (Frontend + Backend)

This is a minimal full-stack weather forecast example.

- Backend: Express server that exposes `/api/forecast?city=NAME`. It uses OpenStreetMap's Nominatim to geocode the city name and Open-Meteo to get weather data. No API keys required.
- Frontend: Simple static HTML/JS served from `/public` that calls the backend endpoint.

Requirements
- Node.js 18+ (this project uses the global fetch API available in Node 18+)

Project structure (split):

- Backend/ — Express server and static assets (serves build from Backend/public)
- Frontend/ — Vite + React client (dev server on 5173; build outputs to Backend/public)

Quick start — production-style (one server):

```powershell
cd "e:\Course\weather-app\Frontend"
npm install
npm run build

cd "e:\Course\weather-app\Backend"
npm install
npm start
# Open http://localhost:4000
```

Dev mode — run both with one command (hot reload):

```powershell
cd "e:\Course\weather-app"
# First time only: install deps in Backend and Frontend
cd .\Backend; npm install; cd ..\Frontend; npm install; cd ..

# Then run both together (concurrently):
npm run dev
# Frontend: http://localhost:5173
# Backend:  http://localhost:4000 (proxy target)
```

Troubleshooting (Windows):
- Keep the dev server running in its own terminal; background starts may exit when the terminal session ends.
- If a build fails from the workspace root, run it from the correct folder (Frontend) as shown above.

Backend — run locally:

```powershell
cd "e:\Course\weather-app\Backend"
npm install
npm start
```

Frontend (dev server with hot reload):

```powershell
cd "e:\Course\weather-app\Frontend"
npm install
npm run dev
# open http://localhost:5173 (API proxied to http://localhost:4000)
```

Build frontend and serve via backend:

```powershell
cd "e:\Course\weather-app\Frontend"
npm install
npm run build
# Then start backend as above and open http://localhost:4000
```

Docker (build + run):

```powershell
cd "e:\Course\weather-app"
docker compose build --progress=plain
docker compose up -d
# then open http://localhost:4000
```

Visual themes and animations
----------------------------

- Automatic day/night detection and weather-based themes (sunny, cloudy, rain, storm, snow, fog) using Open‑Meteo weather codes.
- Animated backgrounds (cloud drift, stars twinkle, rain/snow fall, lightning flashes).
- Light/Dark mode: Auto by default (based on theme), with a manual toggle in the UI.
- Chart animations enhanced for smoother transitions.

Night/day visuals mapping
-------------------------

- Clear night sky: star field + moon rendered in the sky, with subtle shooting stars animation.
- Cloudy night: same as night with additional drifting clouds layered in front of the stars.
- Moon phase: shows as full or half based on an internal approximation of the lunar phase; other phases render a smaller, dimmer moon.
- Sunny day: warm gradient sky with a glowing sun; light, slow-moving clouds are present.

Accessibility and motion
------------------------

- Respects prefers-reduced-motion and the in-app Motion setting. When motion is reduced, fast animations (e.g., shooting stars, heavy precipitation) are disabled or softened.

Notes on dev server issues:
- If you see "Unexpected token '<' ... is not valid JSON" in the frontend, ensure you're using the dev server (http://localhost:5173) and that Vite proxy forwards /api to http://localhost:4000 (vite.config.mjs already configured).
- If the dev server fails to start with ESM errors, ensure the Vite config is `vite.config.mjs` (not .js) and `@vitejs/plugin-react` is installed.

Root npm scripts:

```powershell
cd "e:\Course\weather-app"
npm run backend:start   # starts Backend/server.js
npm run frontend:dev    # starts Vite dev server
npm run frontend:build  # builds to Backend/public
npm run dev             # runs both backend and frontend together (concurrently)
```

Notes
- This is intended as a small example. In production, follow API usage rules for Nominatim (identify your app, rate-limit, caching) and consider error handling and security.

APIs used:
- Nominatim (OpenStreetMap): https://nominatim.openstreetmap.org/
- Open-Meteo: https://open-meteo.com/
