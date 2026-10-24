# Data and map

What data the app ships with and how the map is built. For a one-page summary see [project status](project-status.md). The Express side (live arrivals, snapshots, configuration) is in [Express live transit data](backend-live-data.md).

## Venues

- `frontend/public/data/venues.json` holds 729 venues, searchable by venue code or room name.

## Buildings

- `frontend/public/data/buildings.json` holds 251 NUS Digital Twin buildings from a one-off import (snapshot of 13/10/2026). The frontend loader (`loadBuildingCatalogue`) and backend startup both validate it.
- Buildings are separate from `venues.json`. A room links to its building through the building's `roomCodePrefixes`, and rooms that match no building still work as venues. Some venues are whole buildings, such as LT17, and show only as the building.
- Locations are API centroids, except 29 buildings that use an accepted but unverified OpenStreetMap entrance (`locationKind: "provisional-entrance"`). No entrance is verified yet. The entrance review in #260 is open.
- Buildings that belong to one complex are grouped into a single search entry with block labels (#399). A group sits at the part nearest the centre of all its parts, and Navigate resolves to that part.
- A building opens a details panel with its address, room count and nearby stops. Plan endpoints, markers and the map camera all accept a building or a group.
- How to re-run the import, the overrides and the credit are in [the Digital Twin research notes](research/nus-digital-twin/README.md).

## Bus network

- `frontend/public/data/shuttle-network.json` has 8 internal routes, 33 stops, service associations and ordered stop IDs. Route geometry is bundled road-following GeoJSON.
- The transit loader returns one immutable canonical network through `index.network`. Network and geometry fetches start in parallel and are validated deterministically, and references are validated before any marker renders.
- `frontend/public/data/bus-routes.json` is the original route-name source. The app now uses the normalised network model.
- A checked-in verification manifest ties the network and geometry together. CI checks that they stay in sync.
- Timing estimates are generated at build time. See [shuttle timing](shuttle-timing.md).

## Basemap and markers

- The basemap is the OpenFreeMap Liberty style on OpenStreetMap data. Bus POI labels are hidden and low-priority local POIs are reduced, while rail, airport and major campus context stay visible. Attribution stays visible as a small footer on mobile and desktop.
- The map reports tile errors and has the standard MapLibre navigation controls.
- Bus stops are neutral transit-ring markers with collision-aware short-name labels from zoom 14. Stops and labels outside the selected route fade to 20% from zoom 14, and open stops stay visible below that zoom.
- Route lines are neutral and subdued when all routes show. Official route colours are used for the selected route only.
- Venue markers are neutral pins.

## Code layout

Module ownership is in [Application Architecture](agents/architecture.md). In short:
- MapLibre lifecycle, the basemap, transit layers and markers sit in focused adapters under `frontend/src/infrastructure/map/`. The app uses the framework-free MapSession contract in `frontend/src/app/contracts/`.
- `frontend/src/app/navigation-session.ts` owns application state and commands: loaded data, Explore history, route selection, trip endpoints, resource status, errors and map coordination. `app.tsx` only composes and adapts to React.
- JSON fetching and validated loaders are in `frontend/src/infrastructure/data/`.
- Shared transit, venue and walking-graph types and validation live in `shared/src/`. Frontend-only location, trip and Explore state is in `frontend/src/domain/`.
- Personal waypoints: the data model and a versioned browser store exist, with collections capped at 500 records. Keys look like `nusgo:<collection>:v<version>`, for example `nusgo:favorite-stops:v1`. Reads keep valid records and report rejected ones, and malformed or unsupported-version data stays available for recovery. localStorage cannot make cross-tab writes atomic. There is no add, manage or journey UI yet.
