# NUSGo

Navigate your way in NUS! Check bus timings, locate hard-to-find classrooms, and find the best route to your destination.

**Live at [nusgo.app](https://nusgo.app/)** (v1). NUSGo is an independent project and is not affiliated with NUS.

![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![MapLibre](https://img.shields.io/badge/MapLibre_GL_JS-6-396CB2?logo=maplibre&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22+-5FA04E?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Valhalla](https://img.shields.io/badge/Valhalla-routing-6C757D)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Licence: MIT](https://img.shields.io/badge/Licence-MIT-yellow)

| Nearby stops | Live journey |
| --- | --- |
| <img src="docs/qa/screenshots/prototype-nearby-stops-live.png" width="180" alt="Nearby stops with live arrivals and favourite stops"> | <img src="docs/qa/screenshots/prototype-journey-live.png" width="180" alt="Recommended live journey from Prince George's Park to UTown Auditorium 2"> |

| Shuttle routes (dark) | LT17 venue details (dark) |
| --- | --- |
| <img src="docs/qa/screenshots/prototype-shuttle-routes-dark.png" width="180" alt="Dark Shuttle Routes view with route A1 selected"> | <img src="docs/qa/screenshots/prototype-venue-lt17-dark.png" width="180" alt="Dark venue details for LT17 with nearby stops"> |

## Features

- **Explore:** 729 venues and 251 buildings, from NUSMods and NUS Digital Twin location data. Also browse the 8 NUS shuttle bus routes.
- **Stops:** nearby and favourite stops, with live arrivals for NUS and public buses.
- **Plan:** the best walking and bus journey to your destination. Bus waits use live uNivUS arrival data.
- **No account needed:** your favourites and settings stay on your device.
- **Phone and desktop:** works on both, with light and dark themes.

## Planned

- Custom waypoints and navigation, so you can save specific locations on the map.
- Crowdsourced data: images, venues and buildings.
- More maps: water coolers, toilets and food.
- Indoor navigation, to find the best stairways, corridors and lifts.
- Calendar import, so the app can remind you which bus to take to your next class.
- A mobile app.

## How it works

- **Frontend:** a React, TypeScript and Vite app that draws the map with MapLibre GL JS. Venue, building and bus-network data ship as static JSON.
- **Backend:** an Express API for journey planning and live bus arrivals. It keeps provider credentials out of the browser.
- **Walking routes:** a private Valhalla service, which the backend calls to work out walking times and paths.

The live site at [nusgo.app](https://nusgo.app/) serves the frontend from Cloudflare Pages. The API and Valhalla run together on one VM, reached through a Cloudflare Tunnel. See the [production deployment guide](docs/production-deploy.md).

The three npm workspaces are `frontend`, `backend` and `shared` (types and data validation used by both). For module boundaries, see the [architecture guide](docs/agents/architecture.md).

## Project layout

```text
frontend/   React app, static data and map code
backend/    Express API, journey planning and live arrivals
shared/     Types and validation shared by frontend and backend
docker/     Valhalla routing service setup
scripts/    Data generation and local development helpers
docs/       Project status, local services, QA notes, ADRs and research
```

## Run locally

Requirements: Node.js 22 or later, npm, and Docker Desktop with Docker Compose.

```bash
npm install
npm run dev
```

The root command starts Vite, Express and local Valhalla together. On the first run, Docker downloads map data and builds routing tiles, which can take several minutes and use local disk space. To run the services separately or rehearse a built frontend against local Express, follow the [local services guide](docs/local-services.md).

### Live data settings

- Copy `.env.example` to `.env` for frontend settings.
- Copy `backend/.env.example` to `backend/.env` for Express settings and provider credentials.
- Keep credentials in `backend/.env` only. Anything prefixed with `VITE_` is included in the public browser build.
- Local development can leave `VITE_API_ORIGIN` blank to use Vite's proxy. Hosted builds need an explicit HTTPS API origin.

### Useful commands

```bash
npm test
npm run lint
npm run build
npm run build:local-rehearsal
npm run preview:local-rehearsal
npm run preview
```

`npm run build` creates the hosted frontend and requires `VITE_API_ORIGIN`. The local rehearsal commands use the checked-in loopback profile and write to a separate output directory, so the deployment workflows do not publish that build.

## Status and limitations

NUSGo v1 is live, but it is still early. Journey planning needs a running Valhalla service, and live arrivals need provider credentials in Express. Building locations are a snapshot from 13/10/2026, and no building entrance has been verified yet. Walking routes may miss covered walkways and indoor connections.

See [project status](docs/project-status.md) for current capabilities and known gaps. The [manual smoke checklist](docs/qa/manual-smoke-check.md) covers the main user flows, and [shuttle timing](docs/shuttle-timing.md) explains how arrival times are worked out.

## Contributing

Issues and feature ideas are tracked in GitHub Issues. Before changing code, read the [coding standards](docs/agents/coding-standards.md) (Conventional Commits and the checks to run), the [workflow guide](docs/agents/workflow.md) and [CONTEXT.md](CONTEXT.md) for the project's vocabulary. If you use an AI coding assistant, point it at [AGENTS.md](AGENTS.md) first.

## AI use

NUSGo is built with AI coding assistants (Claude Code and Codex). Every change goes through human review, tests and linting before it is merged.

## Credits and licence

- Map style: [OpenFreeMap](https://openfreemap.org/) (Liberty), with data from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Attribution appears in the app. Review OpenFreeMap's usage terms before deploying publicly or at scale.
- Buildings: NUS Digital Twin. Venues and bus stop associations: NUSMods.
- Live arrivals: uNivUS (NUS shuttles) and LTA DataMall (public buses).

Released under the [MIT licence](LICENSE).
