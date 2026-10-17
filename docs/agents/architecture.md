# Application Architecture

Use these ownership seams to keep domain behavior, user workflows, presentation, and side effects easy to change and test. They describe the target layout for the sequenced architecture migration.

## Ownership

- `frontend/src/app` owns application composition, framework-free contracts, and application-level controllers such as the navigation session, cross-feature navigation, and responsive overlay layout.
- shared/src owns transport contracts, Path and Journey HTTP types, and reusable Node-free transit, venue, walking-graph, service-hours, and transit-index modules used by both applications.
- `backend/src/server.ts` owns process startup and shutdown, while `backend/src/config.ts` and `backend/src/canonical-data.ts` own backend settings and canonical data loading.
- backend/src/http owns Express middleware, route registration, and external request validation. Health, live-data, and Journey handlers live in http/routes/. POST /api/journeys validates endpoint references, applies a bounded deadline and per-client rate limit, and maps planner outcomes to the HTTP contract.
- backend/src/pathfinding owns canonical endpoint resolution, the Pathfinding pipeline, and the server-side Valhalla adapter. Its service receives validated canonical data and live-data operations; HTTP routes do not construct planner inputs themselves.
- backend/src/live-data/runtime.ts composes live-data adapters, owns snapshot lifecycle, and exposes backend live-data operations without Express response construction.
- `backend/src/live-data/bus-arrivals/snapshot.ts` owns provider-independent arrival snapshot generations and freshness.
- `backend/src/live-data/providers/nus` and `backend/src/live-data/providers/lta` own provider authentication, mappings, requests, payload parsing, and provider caches. Provider credentials stay in backend configuration.
- `backend/src/live-data/upstream` owns reusable concurrency, retry, and timeout controls used by provider modules.
- `frontend/src/domain` owns frontend-only location and trip models, lookup indexes, and domain transformations.
- `frontend/src/features` owns the Explore, Stops, and Plan workflows, including their state, intent commands, content components, and feature-specific styles.
- `frontend/src/ui` owns reusable React primitives, layouts, shared presentation styles, and cross-feature desktop/mobile presentation seams.
- `frontend/src/infrastructure` owns browser-side network clients, static-data loading, MapLibre, map lifecycle, markers, layers, popups, and other browser side effects. Provider authentication and polling belong to the backend.
- frontend/src/infrastructure/pathfinding/client.ts owns the browser request to Express. It sends endpoint references and an optional development clock, then validates the complete response contract, including every candidate, Path, leg, and geometry. It does not resolve canonical data or call Valhalla.

`frontend/public/data` remains the canonical checked-in data source. Frontend infrastructure and the backend load external data as `unknown`, use the shared validators, and return only validated domain data.

## Contracts and dependency direction

Application contracts must be small, framework-free interfaces in `frontend/src/app/contracts`. Define a contract there when it describes an effect the application needs, such as map presentation or data loading. Pathfinding's walking-provider contract stays beside the engine because it is part of the engine's replaceable provider boundary. Concrete MapLibre and network implementations belong in `frontend/src/infrastructure` or in that focused Pathfinding boundary; the app composition root wires adapters and feature entry points together with runtime imports. The frontend and backend may both depend on `shared/src`; shared modules must remain free of Node, browser, and provider dependencies.

The intended direction is:

frontend/src/app (composition)
  -> frontend/src/features and frontend/src/ui
  -> frontend/src/infrastructure
       -> frontend/src/domain
       -> shared/src

frontend/src/app/navigation-session
  -> frontend/src/infrastructure/pathfinding/client
  -> shared/src/routing/path

backend/src/http/routes/journeys
  -> backend/src/pathfinding/service
       -> backend/src/pathfinding pipeline, search, and walking
       -> backend/src/live-data/runtime
       -> backend/src/canonical-data
       -> shared/src

- Domain modules must not import React, MapLibre, browser DOM APIs, network clients, or other infrastructure.
- The app composition root may runtime-import feature entry points, UI entry points, and infrastructure adapters to wire the application.
- Frontend features and MapLibre presentation may import Path and Journey contract types from shared/src/routing; they must not import backend runtime modules.
- The frontend pathfinding client owns HTTP, JSON parsing, and cancellation forwarding. It does not resolve canonical endpoint coordinates.
- The backend HTTP route validates untrusted input and translates planner outcomes into HTTP responses. It does not build planner dependencies.
- The backend planner resolves canonical venue, building/group, and stop references from loaded data. It receives the live-data runtime and a Valhalla adapter through its composition seam.
- Shared modules remain free of Node, browser, Express, and provider dependencies.
- Cross-feature coordination is performed by app composition through passed state and callbacks rather than direct feature-to-feature or feature-to-app-contract imports.

The diagram describes allowed ownership and dependency direction; it does not require every module to import every lower layer.

Backend dependencies flow from HTTP routes and validation to the pathfinding composition seam and live-data runtime, then to provider adapters, snapshot logic, and reusable upstream controls. Provider modules do not import Express; provider-independent snapshot code does not import provider modules.
## State, callbacks, and seams

- Feature modules own workflow state such as search queries, selections, and commands. UI modules may own only transient presentation state that has no domain meaning.
- UI callbacks express user intent and are passed down from the owning feature or app controller. UI components do not perform network, MapLibre, or controller side effects directly. A UI component may observe nearby layout geometry to render itself; app controllers own measurements that coordinate layout across components or features.
- Keep the domain model, feature state, and commands shared across desktop and mobile. Use separate UI seams only when layout, focus management, scrolling, or interaction order changes materially. Keep feature-specific responsive rules beside the owning feature; keep reusable navigation, sheet, and layout rules in `frontend/src/ui/styles`.
- `NavigationPanelShell` keeps the desktop/mobile presentation seam. The app-owned `MobileSheet` module under `frontend/src/ui/mobile/` contains the Base UI Drawer integration; application navigation owns detents, and feature views receive state and callbacks without importing the library.
- Pure transformations and validators remain free of I/O, mutation, DOM work, and MapLibre effects.

The backend pathfinding module owns the walking effects alongside the planner: its walking modules own the Valhalla client and directed stop-graph connection provider. Provider-specific payload parsing stays inside valhalla-walking-client.ts, and the pipeline sees only the normalized WalkingRouteEngine contract.

## Migration map and order

Split `frontend/src/transit/render.ts` at its pure/effect boundary: reusable transit validation, geometry, and transport types belong in `shared/src`; frontend-only transformations remain in `frontend/src/domain`, and only MapLibre rendering and effect responsibilities belong in `frontend/src/infrastructure`.

| Current area | Target owner |
| --- | --- |
| Reusable transit and venue types and validation shared by the backend | `shared/src` |
| Frontend-only transit indexes and transformations, plus location and trip models | `frontend/src/domain` |
| Explore workflow state | `frontend/src/features/explore/state` |
| Feature-specific components and React state currently under `frontend/src/components` | `frontend/src/features` |
| Explore route browsing and venue workflows | `frontend/src/features/explore` |
| Nearby and favourite stop workflows and stop-specific UI | `frontend/src/features/stops` |
| Trip endpoints and Path presentation | `frontend/src/features/plan` |
| Path and Journey HTTP types | shared/src/routing |
| Search, ordered planning stages, and walking boundary | backend/src/pathfinding |
| Genuinely reusable primitives and layouts currently under `frontend/src/components` | `frontend/src/ui` |
| Shared navigation, desktop/mobile layout, mobile-sheet, route-chip, and reusable control styles | `frontend/src/ui/styles` |
| Only the remaining MapLibre rendering and effect responsibilities in `frontend/src/transit/render.ts`, plus `frontend/src/map`, data loaders, MapLibre lifecycle, markers, layers, and popups | `frontend/src/infrastructure` |
| `frontend/src/app/app.tsx` and composition in `frontend/src/main.tsx` | `frontend/src/app` |

Make architecture changes in small, behavior-preserving steps. Move imports atomically with each boundary change and keep one canonical source of truth.

## Refactor gates

- Make no behavior change: preserve route, stop, venue, endpoint, popup, keyboard, responsive, camera, and error behavior.
- Add no global state library or global mutable state.
- Add no schema-validation dependency; validate at existing infrastructure boundaries with project-owned logic.
- Add no compatibility re-exports for obsolete module paths. Update imports atomically instead of maintaining duplicate paths or sources of truth.
- Every adapter-created listener, layer, source, marker, popup, timer, and asynchronous operation must have an explicit cleanup or cancellation path.
