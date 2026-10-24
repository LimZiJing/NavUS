# Shuttle timing policy

Status: accepted

This is the provider-neutral timing policy for internal shuttle Journeys. It
defines the inputs that the pure planner may consume; it does not define a
provider API, credentials, deployment, or UI implementation.

## Responsibilities

- This document defines the provider-neutral timing policy and contract consumed by pathfinding.
- NUS-specific request and response normalization is recorded in [the NUS shuttle API contract](research/nus-shuttle-api-contract.md).
- Pathfinding applies the contract to every candidate Journey and transfer.
- Live-data boundary checks and release evidence are recorded in [the evidence log](qa/evidence-log.md).

## Units and terminology

- Durations are integer seconds.
- Distances are integer metres.
- A **ride estimate** is the time between boarding and alighting, excluding
  waiting.
- A **waiting estimate** is the time from reaching a boarding stop until the
  expected shuttle arrival.
- A shuttle leg's duration is `waitingSeconds + rideSeconds`.
- Every shuttle boarding, including a transfer, is a new waiting calculation.

## Static ride estimates

Static ride estimates are planning estimates derived from the canonical route
geometry in `frontend/public/data/shuttle-routes.geojson` and the ordered stops in
`frontend/public/data/shuttle-network.json`.

The current approved method uses:

- baseline speed: 15 mph;
- speed range: 10–20 mph;
- intermediate-stop dwell: 20 seconds; and
- dwell range: 10–30 seconds.

Each record must identify its source, method version, and geometry verification
date. An estimated record must contain positive integer `rideSeconds`,
`rideSecondsLowerBound`, and `rideSecondsUpperBound`, with the lower bound no
greater than the estimate and the estimate no greater than the upper bound.

The baseline estimate is used for Journey ranking. The bounds describe
uncertainty and provenance; they are not separate Journey candidates.

Records marked unavailable cannot create shuttle edges. Static ride timing may
remain available when live arrivals fail, but ride timing alone is not enough
to create a normal application shuttle Journey: the waiting estimate is also
required.

## Live arrival data

The provider boundary must normalize live data before it reaches the planner.
The normalized snapshot contains:

- `observedAt`: when the provider data was observed;
- `expiresAt`: when the server-side cache entry expires;
- `stopObservations`: the observation and expiry timestamps for each requested
  stop, preserved when cached stop responses are combined;
- non-negative `nextArrivalSeconds`; and
- a sorted, duplicate-free list of non-negative upcoming arrival seconds.

A headway estimate is valid only when there are at least two upcoming arrivals
with positive gaps. Its `min`, `median`, and `max` values must be finite,
positive, ordered values satisfying:

```text
0 < min <= median <= max
```

The provider contract may apply stricter operational limits when it has enough
evidence. Provider-specific fields and response shapes must not enter the pure
planner.

## Freshness and response age

Freshness is measured from each stop's `observedAt`, not only from the time
NUSGo fetched the response.

- The recommended live-arrival policy is a 30-second freshness window. A
  snapshot observed within 30 seconds is fresh and may be used for normal
  live ranking.
- A snapshot older than 30 seconds is stale for normal ranking. It may be kept
  for diagnostics or retry handling, but it must not silently become a normal
  live estimate.
- A snapshot older than 120 seconds is expired and unavailable.

The recommended server cache duration is also 30 seconds, so the browser
refresh interval and the server's upstream refresh interval stay aligned. The
120-second limit is a maximum stale-data boundary, not permission to claim that
a stale arrival is live.

One Express process owns the scheduled snapshot for all canonical stops. It
refreshes immediately on startup and then refreshes every 30 seconds by
default. `NUS_SHUTTLE_REFRESH_INTERVAL_MS` can override that interval with a
positive integer number of milliseconds. Each generation is published only
after every stop request has settled. A failed stop keeps its previous value;
if it has no previous value, that stop is unavailable. If every stop fails,
the previous generation remains published. The HTTP endpoint is read-only and
returns the latest complete generation, or `503` while the first generation is
still unavailable. Vite only forwards browser requests to Express during
development; it does not own the poller or snapshot.

The browser adapter reads the server snapshot and caches it until the next
refresh boundary. Stops and Journey planning share that reader, apply only
newer snapshot generations, and use each stop's observation time for display
freshness. Rapid changes to the visible stop set are debounced so map movement
does not create a request for every intermediate set.

## Waiting calculation

For the first boarding, use the first live arrival that remains after adjusting
for the snapshot age:

```text
effective wait = arrival seconds - snapshot age seconds
```

For a transfer, also include the time already spent before reaching the next
boarding stop:

```text
effective wait = arrival seconds
               - snapshot age seconds
               - elapsed journey seconds
```

The first non-negative future arrival is selected. If the response does not
contain an arrival far enough into the future, half the observed median
headway may be used only when the snapshot is fresh and the headway is valid.

There is no separate arbitrary transfer discount or free transfer. A transfer
is another shuttle boarding and must receive its own waiting estimate.

## Service windows

Service windows are separate from frequency and headway estimates. A route is
not considered operating merely because arrival data contains a headway.

The planner checks the route's weekday, weekend, public-holiday, and dated
special-day windows in Singapore local time at the expected boarding time. A
route outside its service window cannot create a shuttle edge.

## Missing data and fallback policy

The normal application policy is named
`unavailable-without-verified-headway`:

- a valid snapshot with no arrival for a route removes only the affected
  shuttle edge;
- other complete shuttle paths remain eligible;
- a valid walking-only Journey remains eligible; and
- if no complete Journey remains, NUSGo reports that no recommended Journey is
  currently available and identifies the missing timing data.

Provider fetch, HTTP, authentication, and response-validation failures are
different from a valid no-bus response. They fail journey planning and must
not silently switch to walking.

`zeroShuttleWaitingTime` is an explicit offline or test policy only. It must be
selected deliberately and communicated as such. It must not be an unlabelled
normal live-data assumption, and it must not make a transfer appear free in a
normal recommendation.

## Ranking and provenance

All candidate Journeys must be evaluated with complete applicable timing
inputs before ranking. The planner must not choose a static winner first and
fetch live timing only for that winner.

The Journey remains estimated. Its timing provenance should distinguish static
ride estimates, live-arrival waits, headway-derived waits, and the explicit
offline/test fallback.

## Static data generation

To regenerate the local static timing data:

```text
npm run shuttle:timing:generate:geometry
```

The explicit geometry flag is required because geometry timing is an estimate,
not an observed timetable. Set `NUSGO_TIMING_GENERATED_AT` when a reproducible
generation date is needed.

`npm run dev` and `npm run build` run this generation step automatically.
