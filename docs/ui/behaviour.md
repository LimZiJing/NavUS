# UI behaviour

How the app behaves today, by area. For a one-page summary see [project status](../project-status.md). Design tokens are in [scales](scales.md) and the control checklist is in [Interface controls](controls.md).

## Layout

The app has three workflow tabs (Explore, Stops, Plan) over one shared map. Stops is the default tab. Settings is a fourth surface opened from the map gear.

**Desktop (769px and wider)**
- One persistent left column holds the tabs. The map reserves the column's measured width as its left inset.
- Inactive tabs stay mounted but inert, so their state survives tab switches and breakpoint changes.
- Stops only loads live arrivals and service windows while it is the active tab.

**Mobile (768px and narrower)**
- A bottom tab bar sits under feature sheets, which have three detents: collapsed (a 44px handle), partial (50% of the visual viewport above the tab bar) and full (covers the whole viewport).
- Each tab keeps its own detent when you switch away and back.
- Handle taps toggle partial and full, and a tap on the collapsed handle opens partial. Up and Down Arrow move one detent at a time. A swipe down from partial collapses.
- A collapsed sheet shows a one-line summary of its tab, such as the Nearby stop count or the journey duration. The summary is part of the handle's accessible name.
- Focusing a venue or endpoint search field opens the sheet at full height. Choosing a result returns it to partial. Dismissing search restores the earlier detent unless you changed it by hand.
- The map's bottom inset follows the active sheet's detent, and the planned journey refits when the Plan detent changes or Plan becomes active again.
- Sheets scroll natively, respect safe-area and visual-viewport sizes, honour reduced motion and are non-modal. Base UI Drawer handles swipes and snap points, while the app owns detent state.

## Explore

- **Find venue:** search by venue code or room name. Results are ranked, and buildings are listed ahead of rooms. Choosing a venue flies to it and shows a selected marker, with no duplicate popup.
- **Venue details:** the venue code is the heading, followed by the room name, floor and building. Floors are integers: negative for basements, zero for ground, positive above. One formatter produces the label. The panel also has a Navigate action, a NUSMods link and up to three NUS bus stops within 250 m. Coordinates stay internal and are never shown.
- **Navigate:** sets the destination. If there is an active location fix, it also replaces the origin with a frozen Current location. Without one, the origin is kept and no permission is requested. On mobile it opens the partial Plan sheet.
- **Bus routes:** chips appear in the order A1, A2, D1, D2, R1, R2, K, P. Their scrollbar is hidden, with edge fades and chevrons showing overflow, and selecting a route keeps its chip visible. A single ordered stop timeline follows. The return control clears the map route but remembers the chosen one.
- **Stops from Explore:** choosing a stop from a route row, marker or venue's nearby list opens its Stops details with no popup. Back returns to Explore and restores keyboard focus to the control you used.

## Stops

- **Nearby** lists every stop around the visible map centre, nearest first. It asks for device location on entry. Stops within 250 m of the centre open their timing rows once the map settles, and the rest close. Manual toggles last until the centre next changes. Distance badges use your device fix when there is one.
- **Favourites** is a browser-saved list. The stars on cards and on the focused-stop sheet edit the same list.
- **Cards:** tapping a title bar opens or closes its timings (animated, and reduced motion is respected). Tapping the star changes the favourite. Expansion state survives tab changes.
- **Focused stop:** selecting a stop (on mobile via the Stops tab) opens a detail sheet and places a neutral pin above it, with no popup. The pin stays after Back, shows only in Stops, and returns without moving the camera.
- **Popups:** entering Stops closes any open popup. Other tab changes close bus-stop popups. Switching between Find venue and Bus routes inside Explore leaves them open.
- **Route rows** show up to three downstream favourited stop nicknames per internal route, forward-only by stop ID and excluding transfers and the selected stop. Public-bus rows show LTA DataMall timings and separate the live, no-estimate, out-of-operation and provider-error states. Public buses are display-only and never used in journey routing.

### Arrival freshness

- Stops and journey planning read one shared backend snapshot. Newer snapshots replace older ones together, and older responses are ignored. Rapid changes to the visible stop set are debounced, and countdowns run from per-stop observation times.
- A fresh arrival gets the LIVE badge. A recent one stays visible without LIVE during a refresh or retry, up to the 120-second maximum age. Expired, unavailable and no-arrival states never show placeholder timings.
- When the whole list has no live data, one "No live data" notice replaces the status-only public rows and per-card empty messages. Scheduled internal rows stay.
- If live arrivals are empty for another reason, service windows give a compact scheduled or ended state, with first-service countdowns inside a 30-minute grace period.
- The last snapshot stays visible while refreshing the same stop set. It clears when the visible stop set changes.

## Plan

- **Endpoints:** choose origin and destination from venues, buildings or bus stops. Swap and clear are available, and each endpoint has its own marker. The origin also has a location action that sets a frozen Current location. It keeps the old origin until a fix succeeds, and shows a retryable error if it fails.
- **Explicit planning:** changing an endpoint cancels and clears the current journey and map route. Nothing is calculated until you press `Get route`. The trip card pins `Get route` to its lower-right corner as an icon action, and `Clear all` lives in the compact trip-actions menu.
- **Refreshing the origin:** pressing `Get route` again re-captures Current location from the latest valid fix. Without one, the earlier origin is kept and the card says the location could not be updated.
- **Map:** the planned route, endpoint markers and duration labels only appear while Plan is active, and return without replanning.
- **Stop popups:** `Set destination` keeps the current origin, opens Plan and waits for `Get route`.
- **Layout:** controls are at least 36px high, with validation on the left and actions on the right, in both themes.

## Location

- A one-tap target button focuses the first available fix and shows a blue target marker. Any valid browser fix is accepted, whatever its reported accuracy. Fixes stay in browser memory and are never sent to NUSGo, except as the frozen coordinates of a Current location endpoint.
- Later device updates move only the blue marker. The journey, the green origin marker, endpoint labels and map reset use the captured coordinates.
- On mobile the button sits top-left in the safe area, above the sheets, and is hidden while Plan is expanded. While the first request is pending, the spinner shows and a further tap recentres without starting a second watch.
- With no active fix, the button centres on Kent Ridge MRT at zoom 15 before requesting or retrying location. A valid recentre pulses the marker once (a static ring under reduced motion). Location updates never move the camera by themselves.

## Settings and themes

- Settings opens from the map gear. On desktop it uses the navigation column. On mobile it fills the screen behind the tab pill. Back restores the earlier workflow state.
- Appearance, Favourites and About expand independently, with Appearance open first. Appearance offers System, Light and Dark, plus the NUS, Matcha and Sakura palettes. A choice applies at once for the current page, and a reload starts at System.
- Favourites shows the saved-stop controls. About has data-source links, the app build and feedback. On mobile a compact map-attribution row stays above the sections.
- Browser location permission is managed by the browser. Settings shows no permission status and has no clear-location action.
- Colours, radii, shadows and control heights come from semantic tokens, and tests check text and status contrast in each theme. Official bus route colours sit outside the theme contract.

## Components

- Shared `Button`, `IconButton`, `MenuItem`, `Chip` and `Pill` define variants, 36px and 44px sizes and states, in a soft tonal style. `NavigateButton`, `GhostBackButton`, `RouteChip` and `InfoPill` build on them. Feature screens have not migrated to them yet (see [Interface controls](controls.md)).
- A dev-only gallery at `/?gallery` shows every variant, size and state in each theme. `npm run lint` rejects new bare `button` CSS selectors, with an allowlist that shrinks as screens migrate.
- Enabled non-selected buttons and the NUSMods action darken by 15% on hover. Selected route chips and the current mobile tab keep their active look.
- Icons live in `frontend/src/ui/icons/` (backed by `lucide-react`) and brand SVGs in `frontend/src/ui/brand-assets/`. Buildings, rooms and stops use distinct decorative icons and type-qualified accessible labels everywhere they appear, based on the resolved entity type.
- Search fields share `frontend/src/ui/search-field.tsx`. Scroll areas share a `ScrollArea` primitive with a thin, arrowless scrollbar that adapts to the theme.
- Styles load from `frontend/src/ui/styles/shared/`, `frontend/src/ui/mobile/styles/` and `frontend/src/ui/desktop/styles/`. Feature styles live in `frontend/src/features/*/styles/`.
