# Pathfinding

backend/src/pathfinding/service.ts is the server composition seam for producing complete Path values. It receives validated canonical data and the live-data runtime, resolves endpoint identities from server-owned venue, building, and transit data, then runs the planner and walking adapter.

The planner keeps its ordered stages in this folder:

1. pipeline/resolve-path-endpoints.ts resolves venue, building, and stop IDs from canonical data, or uses the frozen coordinates in a Current location endpoint.
2. pipeline/select-walking-connections.ts keeps direct walks, directed endpoint connectors, and stop-to-stop transfers. walking/walking-connections.ts combines two endpoint matrix requests with the validated directed stop graph.
3. search/ builds route and timing indexes, enumerates direct walk, one-bus, and one-transfer candidates, ranks them, and enforces cancellation and search budgets.
4. pipeline/apply-bus-waits.ts replaces preliminary zero-wait estimates with a separate time-dependent wait at every boarding, checks service windows, and removes only candidates whose timing is unavailable or invalid.
5. pipeline/complete-path-geometry.ts fetches and caches routed walking shapes, validates them, and skips incomplete candidates so the next ranked option can fill its category quota.

Search uses straight-line placeholders only to represent walking legs while ranking candidates. Those placeholders never leave the backend planner: only complete candidates with validated Valhalla geometry are returned. A search status of complete means the supported connector and transfer space was exhausted; bounded means a time, candidate-count, or geometry budget ended the search. Cancellation remains a distinct outcome.

There are two rankings. The core search score uses adjusted duration, then fewer bus boardings, shorter walking distance, fewer legs, and a lexical stop sequence. The frontend Plan display policy separately shows up to three bus-inclusive Paths and one walking-only Path; walking leads only when its adjusted duration is strictly below 80% of the fastest bus Path.

POST /api/journeys accepts stable endpoint references or a frozen Current location coordinate. Its request and response types live in shared/src/routing/path.ts. The browser receives complete scored candidates and geometry; it does not send canonical coordinates or call Valhalla. Request identity stays in the frontend navigation session, while the Express route owns the disconnect signal passed into the planner.

`VALHALLA_BASE_URL` accepts loopback and private-network IPs, localhost names, private `.local` or `.internal` names, and single-label service names such as Docker's `valhalla`. Public hostnames and link-local IPs are rejected. Journey requests also have a bounded deadline and per-client rate limit; the limiter retains only short-lived request counts.
