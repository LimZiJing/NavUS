# NUSGo manual smoke checklist

This is the canonical browser smoke checklist for a release or deployment milestone. It is not a requirement to repeat the full checklist for every implementation task.

Run it against a local production build (`npm run build` followed by `npm run preview`) or the deployed development site. Use a supported desktop browser and record the browser, URL, date, and viewport sizes with the result.

## How to scope browser verification

- For pure domain, data, test, or infrastructure changes with no user-visible behavior change, automated checks are sufficient.
- For UI or map changes, run the smallest targeted subset covering the changed behavior when a local browser is available.
- Run the full checklist before a release or when a change materially affects responsive layout, keyboard behavior, map presentation, navigation state, or external map resources.
- If browser testing is unavailable, record the affected areas as unverified and explain the environment blocker. Do not claim browser QA.

## Desktop — 1440 × 900

- [ ] The map, trip endpoint controls, and Explore panel are visible without overlap.
- [ ] Venue search, venue detail, Back, Close, Escape, and map-click behavior work.
- [ ] Selecting a venue flies to it and shows one selected venue marker without a duplicate popup.
- [ ] For a selected basement, ground-floor, and first-floor venue, venue details show “Basement 1”, “Ground floor”, and “Floor 1” respectively.
- [ ] bus route browsing, route selection, route clearing, stop popups, and camera fitting work.
- [ ] Trip endpoints can be set, swapped, and cleared for venues and bus stops.
- [ ] In Plan, the Origin location action requests browser location only after activation, fills the closest mapped venue, keeps the existing origin until success, and shows a retryable message when location is denied or unavailable.
- [ ] In Plan, the endpoint rows, swap and location actions, validation message, Clear all control, and Get route action use compact, consistent alignment without clipping. The Journey summary and leg details remain readable.
- [ ] Repeat the Plan layout check in both light and dark themes.
- [ ] In Plan, set origin to PGP and destination to UTown Auditorium 2. The Journey calculation returns a valid Recommended journey, and the map, page, and endpoint controls remain responsive while it is calculated. If the result is budgeted, the panel explains that a faster route may exist instead of calling it fastest.
- [ ] Venue and transit loading failures remain independently understandable and usable where supported.
- [ ] Native MapLibre controls and attribution remain visible and usable.

## Mobile — 390 × 844

- [ ] Stops opens at the partial detent with a sheet occupying 50% of the visual viewport above the bottom navigation. Explore and Plan also start partial; desktop presentation is unchanged above 768px.
- [ ] Explore, Stops, and Plan tabs remain visible while the sheet is partial or collapsed. Full reaches the top and bottom of the viewport and covers the tab bar; collapsed leaves the 44px handle above it.
- [ ] Switching tabs reaches each sheet's remembered detent immediately, without briefly opening full, and preserves the map camera and trip endpoints.
- [ ] The handle works by tap, Enter, and Space (partial and full toggle; collapsed opens partial), and Up and Down Arrow move one detent, including full to partial. Swiping the handle or blank sheet whitespace tracks the touch smoothly and settles at a snap point; cancelling a swipe does not cause a second tap action.
- [ ] Scrollable sheet content scrolls natively, text and controls remain usable, uncovered map areas remain interactive, and sheet surfaces block taps beneath them.
- [ ] Explore venue search/details and bus route browsing, map-based stop selection, Plan endpoints and Journey, Back, Close, Escape, and map-click behavior continue to work.
- [ ] In Plan, endpoint controls stay compact at the phone width with controls at least 36px high, validation on the left, and the action group on the right. Check both light and dark themes.
- [ ] Sheets are non-modal, scroll independently, respect safe-area and software-keyboard insets, and expose accessible names, expanded states, visible focus, and touch-sized controls.
- [ ] Back, Escape, sheet collapse, and tab changes leave focus on a usable control without trapping it in an inactive sheet.
- [ ] The single mobile location button sits inside the top-left safe area when the map is exposed and is hidden while Plan is full. Pointer and keyboard activation focus the active or first device fix; when no active fix is available, the map falls back to Kent Ridge MRT at zoom 15 before requesting or retrying location. Location updates alone do not move the camera.

## Responsive boundary — 768 / 769px

- [ ] Resizing across the breakpoint without reloading switches between mobile and desktop layouts correctly.
- [ ] No overlay covers another control, traps focus, or makes the map unavailable.

## Settings, Stops and Plan additions

- [ ] Settings opens from the map gear. Appearance, Favourites and About expand independently, Back restores the previous tab, and each theme (System, Light, Dark, NUS, Matcha, Sakura) applies immediately.
- [ ] In Stops, Nearby opens timing rows only for stops within 250 m of the map centre, and the centre marker is the glowing dot.
- [ ] In Stops, with live data unavailable, one list-wide "No live data" notice shows and scheduled internal rows remain.
- [ ] In Plan, a collapsed journey card expands on tap, and tapping an expanded card recentres the map on the route.

## Keyboard and accessibility

- [ ] Focus is visible and follows a sensible order through the affected workflow.
- [ ] Back, Escape, Close, and outside-map dismissal return focus to a usable control.
- [ ] Interactive controls have meaningful accessible names and state changes are communicated semantically.

## Map and external resources

- [ ] The basemap, glyphs, route lines, stop labels, markers, and popups render as expected for the changed area.
- [ ] Tile or style failures produce a user-safe status without hiding unrelated application controls.
- [ ] Any external-resource limitation is recorded separately from application behavior.

## Evidence

Record each pass in the [evidence log](evidence-log.md) with the browser, URL, date, viewport and result.
