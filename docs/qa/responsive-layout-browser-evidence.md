# Responsive layout browser evidence

Run these checks in Windows Chrome and Edge after starting the local Vite app. Leave each box unchecked until the browser check is actually performed.

## Desktop: 1440 × 900

- [ ] The trip endpoint controls remain a compact card above the persistent Explore panel.
- [ ] The Explore panel remains visible and usable while the map remains available for pan and zoom.
- [ ] Venue search, venue detail, bus route selection, Back, Close, Escape, and map-click behavior work.
- [ ] Selecting a venue flies the map to the venue and keeps its selected marker visible without a duplicate popup.
- [ ] Route selection updates the map camera/content and the selected route details.
- [ ] A venue-load failure still leaves bus route browsing available.
- [ ] Keyboard focus is visible, sequential, and returns to the initiating control after Back, Escape, and Close.

## Mobile: 390 × 844 (mobile layout through 768px)

- [ ] The map fills the viewport beneath the separate trip card and Explore bottom sheet.
- [ ] Trip endpoints start as a collapsed Plan trip card with origin → destination or missing prompts.
- [ ] Plan trip expands and collapses only through its explicit control; its accessible name keeps full endpoint names.
- [ ] Expanding Plan trip minimizes the Explore sheet to an actionable labelled header.
- [ ] Activating the Explore header restores the sheet, collapses Plan trip, and leaves focus on safe current content.
- [ ] A map-triggered Explore change reveals the sheet without losing Explore state.
- [ ] The Explore panel is a persistent, non-modal bottom sheet capped at about half the viewport and sized to its content.
- [ ] The bottom sheet respects the safe-area inset, scrolls internally, and has no drag affordance or gesture requirement.
- [ ] There is enough map space between the top card and bottom sheet for pan and zoom interaction.
- [ ] Map navigation controls and attribution remain usable without overlapping either surface; the full legend is hidden.
- [ ] Venue search receives focus when opened; venue-detail heading receives focus after selection; route select receives focus when Bus routes opens, or the Back fallback receives focus until routes become available.
- [ ] Back, Escape, and Close restore focus to the control that initiated the current view, with no focus left on removed content.
- [ ] Trip endpoint search, selection, swap, clear, and validation remain usable.
- [ ] The collapsed mobile Map controls chip appears below Plan trip and opens a labelled popover.
- [ ] Zoom in and Zoom out each move the map by one animated step while keeping the popover open with action focus; Reset view closes the popover and restores chip focus.
- [ ] Reset view targets the visible venue detail before other targets.
- [ ] Reset view targets the visible selected bus route before trip endpoints.
- [ ] Reset view fits two mapped trip endpoints, centers one mapped endpoint at venue level, and falls back to the campus view when no target is available.
- [ ] Escape and outside-map interaction dismiss the Map controls popover.
- [ ] Keyboard dismissal restores focus to the Map controls chip.
- [ ] Expanding Plan trip hides Map controls and moves focus to a visible trip control when the chip or an action has focus.

## Breakpoint resize across 768px / 769px

- [ ] Resize the browser across 768px and 769px in both directions without reloading.
- [ ] At 768px the layout remains the mobile full-viewport map with top card and bottom sheet; at 769px it uses the desktop persistent overlay layout.
- [ ] Route camera fitting uses mobile overlay padding at 768px and desktop side padding at 769px.
- [ ] No overlay covers the other control, traps focus, or leaves the map unavailable for interaction.

## Desktop native map controls

- [ ] The custom mobile Map controls chip and popover are absent above 768px.
- [ ] Native MapLibre navigation controls remain present, usable, and non-overlapping on desktop.

## Edge headless/device-emulation evidence (2026-09-20)

The following facts were verified in Edge headless/device emulation at 320 × 568, 390 × 844, 504 × 1137, 768 × 900, 568 × 320 (short landscape), 769 × 900, and 1440 × 900. The manual checks above remain intentionally unchecked.

- The shell produced no outer horizontal overflow or secondary viewport scrollbar after the containing-block sizing fix.
- Mobile map gaps remained usable, including a minimum 84px gap in short landscape; navigation controls and attribution stayed within the viewport.
- The mobile legend was hidden; the collapsed Plan trip layout and content-sized Explore sheet rendered.
- Expanding Plan trip minimized the Explore sheet; restoring it from its labelled header returned the sheet and focus.
- The 768/769 breakpoint sizing and focus transition behavior passed.
- The Explore venue input measured 44px in the mobile layout.

Chrome, a real software keyboard, and the full manual pointer/keyboard smoke remain unverified. External basemap and glyph loading was inconsistent in headless runs, so this evidence does not claim complete map-data QA.

## Edge headless Pixel 7/CDP evidence (2026-09-20)

The following additional facts were verified at 390 × 844, with the responsive matrix also checked at 320 × 568, 568 × 320, 768 × 900, 769 × 900, and 1440 × 900. The broad checklist above remains intentionally unchecked.

- Attribution stayed visible about 12px above the Explore sheet top (596px), expanded route sheet (422px), and minimized trip sheet (751.6px). Measured mobile bottom insets tracked 260px, 434px, and 105px respectively; desktop reset the inset to 0px.
- A1 framing kept all 12 markers within the available map gap; a rapid A1 → D1 selection ended on D1.
- Pan coordinates persisted exactly through Plan trip expansion/restoration while attribution moved with the measured inset.
- Zoom in/out kept the popover open with focus on the activated action; Reset closed it and restored chip focus.
- The first Escape closed only Map controls; a second Escape returned the Explore sheet to its root.
- Venue detail selection completed and attribution continued tracking the measured inset.
- Map tiles loaded. OpenFreeMap glyph requests returned 404, the sprite was missing, and filter warnings remained; this is not complete map-data QA.

Real Chrome, a real software keyboard, physical safe-area hardware, and the full manual pointer/keyboard smoke remain unverified. No screenshots are retained with this report.

## Release QA follow-up — 2026-09-21

The [canonical release record](evidence-log.md) contains the detailed 1280 × 720 production-preview evidence. Earlier Edge headless/device-emulation evidence remains useful for the recorded mobile and breakpoint facts, but the full manual release checklist, real Chrome/Edge, physical software keyboard, safe-area hardware, and failure injection remain open.
