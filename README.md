# RescueMesh

RescueMesh is an offline-first emergency communication and resource mapping platform. It lets people create local incident reports for help requests, water, food, shelter, first aid, charging, blocked roads, dangerous areas, and general updates even when internet or cellular service is unavailable.

The MVP uses browser IndexedDB for device-first storage, a FastAPI/SQLite local node for persistence, WebSockets for real-time LAN updates, and Leaflet/OpenStreetMap for development maps. It does not use paid APIs or Google Maps.

## Problem

During storms, earthquakes, campus incidents, large events, or infrastructure outages, internet and cellular networks can become unreliable. People still need a way to share:

- who needs help
- where resources are available
- which routes are blocked
- where first aid or charging is available
- what reports have been confirmed or resolved

RescueMesh treats every browser as a local-first field notebook. Reports are generated with globally unique IDs on the device, stored locally first, and synced with a nearby RescueMesh Node when one is reachable on the same Wi-Fi/LAN.

## Tech Stack

- Frontend: React, Vite, React Router
- Local browser storage: IndexedDB
- Backend: FastAPI
- Database: SQLite
- Realtime sync: WebSockets
- Map: Leaflet with OpenStreetMap development tiles
- Styling: plain CSS
- Tests: pytest for backend API behavior

## Project Structure

```text
rescuemesh/
  backend/
    app/
      database.py
      main.py
      schemas.py
    tests/
      test_api.py
    requirements.txt
  frontend/
    src/
      api/
      components/
      hooks/
      pages/
      storage/
      styles/
      utils/
    package.json
  docker-compose.yml
  README.md
```

## Run Locally

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend routes:

- `GET /health`
- `GET /reports`
- `POST /reports`
- `POST /sync`
- `POST /reports/{id}/confirm`
- `POST /reports/{id}/resolve`
- `DELETE /reports`
- `GET /node/status`
- `WebSocket /ws`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

If testing from another laptop or phone on the same Wi-Fi, start Vite with the host enabled and point the frontend to the backend machine:

```bash
VITE_API_BASE_URL=http://YOUR_LAN_IP:8000 npm run dev -- --host 0.0.0.0
```

## Public Deployment

The repo includes a root `Dockerfile` and `render.yaml` for a one-service Render deployment. The container builds the React frontend and serves it from FastAPI, so the live site and API share one public URL.

1. Push this repo to GitHub.
2. In Render, create a new Blueprint from the repo.
3. Use the included `render.yaml`.
4. After deploy, open the generated `https://...onrender.com` URL.

The public deployment sets `RESCUEMESH_PUBLIC_MODE=true`, which requires an admin token for destructive endpoints like `DELETE /reports`. Public visitors can add, view, confirm, and resolve reports, but they cannot clear all reports from the browser UI.

The default Render plan in `render.yaml` is free. Free services use ephemeral filesystem storage, so SQLite report data can disappear after restarts or deploys. For persistent public data, switch to a paid Render service, attach a persistent disk, and set:

```text
RESCUEMESH_DB_PATH=/var/data/rescuemesh.db
```

## Docker

Docker Compose is included for convenience:

```bash
docker compose up --build
```

Then open `http://localhost:5173`.

## Testing Sync

1. Start the backend.
2. Start the frontend.
3. Open two browser windows, or open the app from two devices on the same Wi-Fi.
4. In one window, create a report or click **Load Demo Data**.
5. Watch the second window receive reports through sync/WebSocket updates.
6. Temporarily stop the backend, create another report, then restart the backend and click **Sync Now**.

The frontend sends known report IDs and local reports to `/sync`. The backend stores new report IDs, ignores duplicate report IDs, returns reports the client is missing, and broadcasts new/updated reports to connected WebSocket clients.

## MVP Features

- Offline-first emergency report creation
- Locally generated globally unique report IDs
- Device ID stored in browser localStorage
- IndexedDB report persistence after refresh/offline usage
- FastAPI backend with SQLite persistence
- LAN-style sync through `/sync`
- WebSocket broadcasts for new and updated reports
- Duplicate report ID prevention
- Duplicate warning for similar category/title/location/time reports
- Leaflet emergency map
- Category, urgency, and status filters
- Report list view
- Timeline view
- Node status page
- Confirmation count
- Two confirmations automatically mark a report `Confirmed`
- Same local device cannot confirm the same report twice
- Resolve report workflow
- JSON and CSV incident log export
- Demo emergency data

## What Is Simulated

- Mesh networking is simulated through a local FastAPI node and WebSockets on Wi-Fi/LAN.
- Browser-to-browser sync happens through the node, not direct peer-to-peer radios.
- Offline confirmations/resolves are queued locally and replayed when the backend is reachable.
- Leaflet uses online OpenStreetMap development tiles. A TODO in `ReportMap.jsx` marks where offline tiles should be configured.

## Future Improvements

- Bluetooth syncing
- Wi-Fi Direct support
- Raspberry Pi emergency node image
- LoRa radio support
- Encrypted reports and signed device identities
- Offline map tile packs
- Responder/admin mode
- QR code for joining a local node
- SMS fallback
- Battery-saving mode
- Conflict handling for edited reports
- Richer trust scoring and report provenance

## Team Role Breakdown

- Frontend lead: React pages, map UX, IndexedDB storage, responsive UI
- Backend lead: FastAPI routes, SQLite schema, sync protocol, WebSocket broadcasts
- Sync/networking lead: LAN testing, future Bluetooth/Wi-Fi Direct/Raspberry Pi/LoRa transport adapters
- Product/design lead: emergency workflow, categories, urgency/status language, field usability
- QA lead: backend tests, multi-window sync tests, offline/reconnect scenarios
- Documentation lead: setup guide, demo script, screenshots, future roadmap

## Tests

Backend tests cover report creation, duplicate ID prevention, sync missing reports, confirming a report, and marking a report resolved:

```bash
cd backend
pytest
```

## Screenshots

Add screenshots here after running the app locally:

- Dashboard
- Emergency Map
- Create Report
- Timeline
- Node Status
