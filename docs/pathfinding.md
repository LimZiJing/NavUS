# Pathfinding

How NUSGo plans a journey today. The accepted design is in [ADR 0002](adr/0002-nus-route-recommendation-architecture.md) and [ADR 0003](adr/0003-three-stop-single-shuttle-recommendation.md). The timing policy is in [shuttle timing](shuttle-timing.md). For a one-page summary see [project status](project-status.md).

## Who does what

- `backend/src/pathfinding/` holds the engine. `find-paths.ts` coordinates endpoint resolution, walking connection selection, bounded search, the bus-wait policy and geometry completion.
- `walking/` owns the directed stop-graph provider and the Valhalla client. `search/` owns indexing, enumeration, ranking and the search budget.
- `POST /api/journeys` accepts endpoint references or a frozen Current location coordinate, and resolves canonical data on the server. The frontend sends endpoint identities only, and gets back complete scored Paths with geometry.
- The app session owns request identity and cancellation. Plan owns the display policy. MapLibre renders the Paths.

## What it compares

- Direct walking, one-bus and one-transfer candidates.
- A venue endpoint contributes up to five reachable walking connectors, picked by estimated duration.
- A chosen origin stop stays fixed for boarding. A chosen destination stop is an exact zero-walk endpoint, and may also use up to five final walks from other stops.
- A transfer walks to a different route. A Path cannot revisit a stop or planning state.
- Walking legs need complete Valhalla geometry.

## Scoring and what is shown

- Walking time is divided by 0.8. The first bus wait and ride are unchanged. Each later bus leg is divided by 0.9.
- Search returns up to three distinct bus Paths plus the best walking-only Path.
- Plan shows up to three bus Paths and one walking Path. Walking goes first only when its adjusted duration is strictly under 80% of the fastest bus Path. Otherwise it follows the bus options.
- The map draws every candidate and emphasises the selected one.

### Pruning

The shared policy in `shared/src/routing/candidate-policy.ts` drops candidates not worth showing, before the top three are chosen. Plan applies the same policy again before display.
- A bus Path more than 2× slower (adjusted) than the walking Path is dropped.
- A two-boarding Path is dropped unless it saves at least 180 seconds (adjusted) over the best walking or single-boarding Path.

### Maximum wait

A bus Path is discarded when its wait at any boarding, including a transfer, is five hours or more (`MAX_BUS_WAIT_SECONDS`). The five-hour figure is the product owner's approximate value and is unconfirmed. Walking-only Paths are never discarded by this rule. `find-paths.test.ts` covers the boundary (17,999 s kept, 18,000 s discarded) with live arrivals.

## Speed and limits

- Walking lookups reuse exact edges from the validated graph for the 33 canonical stops. Valhalla is only asked for endpoint matrix cells those edges don't cover. When both are needed, the origin-row and destination-column queries run in parallel.
- Search is limited to 350 ms and 10,000 expanded paths, checks for cancellation and yields between batches. Timing records, walking adjacency and per-route stop projections are indexed or cached.
- A Path with incomplete walking geometry is dropped alone, so the next ranked option can fill its place.
- If geometry completion runs out of its 350 ms budget, the complete best-so-far candidates are returned and marked `bounded`. If there are none, the response is `planning_timeout`.
- An `exact` result means the supported candidate set was exhausted. It does not prove a global optimum beyond the chosen connectors or one transfer.
- A valid no-bus response removes the bus options. Provider failures surface as planning errors.

## Timing inputs

- Build-generated ride estimates use the canonical route geometry, are validated against the route and stop model, and load through `loadShuttleTimingData`.
- Live stop arrivals come from a cached server-side NUS adapter when it's configured. Static ride estimates are the fallback.
- Service-hour windows are checked in Singapore local time, so after-hours routes are never treated as zero-wait.

## Development clock

Development previews have a simulated-time control for a frozen Singapore date and time. Pathfinding skips live arrivals in that mode, uses a five-minute wait at every boarding, and checks service windows at each boarding instant. The choice resets on reload. Production builds and live Stops timing are unaffected. The fixed five-minute wait stays below the maximum-wait limit.

## Operating notes

- Usable walking results need a configured self-hosted Valhalla endpoint.
- Regenerate the checked-in walking stop graph when the canonical stop model, walking profile or routing data changes. See [local services](local-services.md).
- Live data needs server-side NUS credentials.
