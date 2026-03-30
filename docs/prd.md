# PRD — Real-Time ASCII OSM Viewer

**Version:** 0.1
**Status:** Draft
**Platform:** Web
**Frontend:** SvelteKit
**Map/Data Engine:** Vector tiles + MapLibre-compatible pipeline
**Text/Typographic Engine:** Pretext for measured typographic mode; monospace renderer for performance-first mode

## 1. Product summary

Build a browser-based, real-time OpenStreetMap viewer that renders the current map viewport as ASCII art. Users can pan and zoom the map, toggle entity types on and off, and switch between a fast monospace renderer and a richer typographic renderer.

The viewer should not behave like an image-to-ASCII filter. It should interpret map entities semantically:

- polygons become area/coverage fields
- lines become directional strokes
- points become symbolic stamps

This preserves map meaning while producing a distinctive ASCII style.

## 2. Problem statement

Most ASCII map ideas fall into one of two weak approaches:

1. **Pixel post-processing**
   - looks novel
   - loses semantic control
   - cannot cleanly toggle roads, buildings, water, etc.

2. **Naive feature sampling**
   - preserves semantics
   - is easy to build
   - does not preserve area shape or line direction well enough

We need a viewer that combines both strengths:

- semantic layer control
- shape-aware ASCII rendering
- interactive performance in the browser

## 3. Vision

Create a map experience that feels like a living terminal map: readable, interactive, stylized, and performant.

The product should feel:

- expressive, not gimmicky
- fast during interaction
- cleanly controllable by entity type
- visually interesting in both monospace and typographic modes

## 4. Goals

### Primary goals

- Render the visible map viewport as ASCII in real time.
- Support pan and zoom with responsive updates.
- Allow users to toggle major map entities independently.
- Preserve area shapes for buildings/water/parks.
- Preserve line direction for roads/rail/waterways.
- Reach **at least 30 fps during interaction** on target desktop hardware.

### Secondary goals

- Offer a higher-fidelity typographic mode using Pretext.
- Make the rendering pipeline modular so new entity types can be added later.
- Keep the system fully client-side for the initial release.

## 5. Non-goals

Not in scope for the first release:

- turn-by-turn navigation
- route planning
- OSM editing
- full search/geocoding
- 3D buildings
- full label placement engine
- mobile-first optimization
- server-side ASCII rendering
- perfect cartographic accuracy at all zoom levels

## 6. Target users

### Primary users

- developers and designers interested in creative map visualization
- OSM / geo hobbyists
- terminal / retro UI enthusiasts
- demo builders and creative coders

### User motivations

- explore places in a novel visual style
- turn map layers on/off to see urban structure
- use the viewer as an experiment, portfolio piece, or art tool

## 7. Core user stories

- As a user, I can pan and zoom the map and see the ASCII output update smoothly.
- As a user, I can toggle buildings, roads, water, parks, rail, and POIs on or off.
- As a user, I can distinguish filled areas from linear features.
- As a user, I can switch between a fast monospace mode and a richer typographic mode.
- As a user, I can understand the map without needing the original rendered basemap visible.
- As a user, I can use the viewer on a modern desktop browser without installing anything.

## 8. Product principles

1. **Semantic, not photographic**
   The renderer should understand what a feature is.

2. **Performance first**
   Fast interaction matters more than maximum fidelity.

3. **Area for polygons, direction for lines**
   Buildings and water should feel mass-based; roads should feel directional.

4. **ASCII by default**
   The default palette should use printable ASCII characters only.

5. **Typography is additive**
   Pretext improves the visual output; it is not the geometry engine.

## 9. Scope

## MVP scope

- map viewport rendered as ASCII
- pan/zoom interaction
- entity toggles:
  - roads
  - buildings
  - water
  - parks/landuse
  - rail
  - POIs

- monospace render mode
- hybrid semantic renderer:
  - polygon coverage for area features
  - direction-aware line rendering for roads/rail/waterways
  - symbol stamping for points

- dynamic quality scaling during movement vs idle
- desktop browser support

## Post-MVP / v1.1

- typographic mode powered by Pretext
- configurable glyph palettes
- screenshot/export
- label experiments
- custom themes
- performance HUD/debug overlay

## 10. UX overview

## Main layout

- full-screen ASCII map canvas
- compact control panel or sidebar
- optional hidden map engine layer beneath the ASCII output
- optional FPS / quality indicator in debug mode

## Controls

- zoom via mouse wheel / trackpad
- drag to pan
- entity toggles
- render mode toggle:
  - Fast Monospace
  - Typographic

- quality toggle:
  - Auto
  - Performance
  - Quality

## Visual behavior

- while dragging/zooming: lower-resolution grid, faster updates
- after movement stops: refine to higher-resolution output
- toggled-off entities disappear from the ASCII output quickly and cleanly

## 11. Functional requirements

## FR1. Map rendering

The system shall render the current viewport as ASCII art derived from vector map features.

## FR2. Entity-aware rendering

The system shall treat entities by geometry type:

- **Polygons**: buildings, water, parks, landuse → rendered by cell coverage / fill density
- **Lines**: roads, rail, waterways → rendered by coverage plus direction
- **Points**: POIs, stations, landmarks → rendered as symbolic stamps

## FR3. Entity toggles

Users shall be able to independently enable/disable at least:

- roads
- buildings
- water
- parks/landuse
- rail
- POIs

## FR4. ASCII character mapping

The system shall map entities to configurable palettes.

Example default mapping:

- buildings: `. : * #`
- water: `. ~ =`
- parks/landuse: `. " ,`
- roads: `- | / \ +`
- rail: `= :`
- POIs: `* o x`

## FR5. Priority handling

The renderer shall resolve overlapping entities by priority.

Default priority order:

1. POIs / markers
2. roads / rail / waterways
3. buildings
4. water
5. parks / landuse background

## FR6. Camera interaction

The ASCII output shall update in response to:

- pan
- zoom
- resize
- style/entity toggle changes

## FR7. Dual rendering modes

The system shall support:

- **Monospace mode** for performance-first rendering
- **Typographic mode** for richer proportional rendering using Pretext

## FR8. Quality scaling

The system shall support at least two quality levels:

- **interaction mode**: lower grid density, faster update
- **settled mode**: higher grid density after a short idle delay

## FR9. Client-only renderer

The map renderer shall run in the browser. The SvelteKit app shell may SSR, but the map engine itself should initialize client-side.

## FR10. Debug mode

A debug mode should expose:

- fps
- current grid size
- current render mode
- current entity count / cache state

## 12. Non-functional requirements

## NFR1. Performance

- Target **30 fps minimum during active pan/zoom** on target desktop hardware.
- Target **60 fps internally where possible**, with graceful degradation to 30 fps.
- Settled re-render to high quality should complete quickly after motion stops.

## NFR2. Responsiveness

- Input should feel immediate.
- Toggle changes should visibly apply without noticeable lag.
- The UI must remain interactive while rendering.

## NFR3. Visual quality

- Buildings and water must read as areas, not isolated point samples.
- Roads must preserve obvious directionality in most cases.
- ASCII output must remain legible at common desktop viewport sizes.

## NFR4. Stability

- No catastrophic frame drops during normal panning.
- No unbounded memory growth while moving across the map.

## NFR5. Accessibility / usability

- Controls must be keyboard accessible.
- Default contrast should be high enough for comfortable viewing.

## 13. Technical approach

## Architecture summary

**Main thread**

- SvelteKit UI
- MapLibre map instance
- camera state
- layer controls
- feature/tile visibility management

**Worker**

- rasterization pipeline
- per-entity masks
- ASCII cell reduction
- frame generation
- optional OffscreenCanvas drawing

**Renderer**

- fast mode: canvas-based monospace atlas
- typographic mode: Pretext-driven measured text layout or premeasured glyph atlas

## Render pipeline

1. Load vector tiles through a MapLibre-compatible map source.
2. Determine visible features/layers for the current viewport.
3. Convert visible entities into semantic masks:
   - building mask
   - water mask
   - park mask
   - road mask
   - rail mask
   - poi mask

4. Rasterize masks into a coarse screen grid.
5. Compute per-cell stats:
   - coverage
   - dominant entity
   - direction bits for lines
   - priority

6. Select a glyph per cell.
7. Draw the final frame.

## Geometry strategy

### Polygons

Use area coverage.
Each cell should represent how much of the cell is occupied by the polygon.

### Lines

Use line coverage plus direction.
Major outputs:

- horizontal
- vertical
- diagonal
- junction/intersection

### Points

Use stamp-based placement into nearby cells.

## Pretext strategy

Pretext will be used for the **typographic mode**, where glyph widths matter and variable-width output is desirable.

It will **not** be the primary geometry conversion engine.

Recommended release order:

1. ship fast monospace renderer first
2. add Pretext-based typographic renderer second

## 14. Performance strategy

To reach 30 fps, the product must avoid per-cell map queries on every frame.

### Required strategies

- cache visible features by tile/layer
- avoid querying the map once per ASCII cell
- render in a worker where supported
- use OffscreenCanvas where available
- downshift resolution during motion
- refine after idle
- keep glyph set small and precomputed
- minimize allocations in hot loops

### Dynamic quality behavior

During movement:

- use smaller grid
- skip expensive refinement
- prefer monospace/cached glyph output

After movement stops:

- re-render at larger grid
- optionally enable richer typographic mode

### Suggested grid targets

Initial suggested targets:

- interaction mode: ~96×54 to 128×72
- settled mode: ~160×90 to 220×124

These should remain configurable and device-dependent.

## 15. Acceptance criteria

The product will be considered successful for MVP if:

1. A user can open the app and interact with a live ASCII map in the browser.
2. Panning and zooming feel responsive on target desktop hardware.
3. Buildings, water, and roads are visually distinguishable.
4. Turning an entity type off removes it from the output.
5. Buildings and water read as filled areas, not just single sampled marks.
6. Roads mostly preserve directional appearance.
7. The app sustains at least 30 fps during interaction in performance mode.
8. The app upgrades visual quality when movement stops.

## 16. Success metrics

### Product metrics

- median fps during interaction
- p95 frame time during interaction
- time to first ASCII frame
- time from camera stop to refined frame
- toggle response latency

### Quality metrics

- % of sampled viewports where roads are directionally legible
- % of sampled viewports where buildings read as area masses
- subjective visual rating between monospace and typographic modes

## 17. Milestones

## Milestone 1 — Prototype

- SvelteKit shell
- MapLibre map integration
- client-only map component
- simple ASCII overlay
- entity toggles
- monospace renderer
- low-res interaction mode

**Exit criteria:** working demo with roads/buildings/water and manual toggles.

## Milestone 2 — Semantic renderer

- move from point-sampling to semantic masks
- polygon coverage pass
- directional line pass
- priority stack
- worker-based rasterization

**Exit criteria:** buildings/water look area-based; roads look directional.

## Milestone 3 — Performance hardening

- feature/tile cache
- OffscreenCanvas path
- adaptive grid sizing
- debug metrics
- 30 fps tuning

**Exit criteria:** stable 30 fps target achieved in performance mode.

## Milestone 4 — Typographic mode

- Pretext integration
- variable-width measured glyph rendering
- theme/palette tuning
- quality comparison mode

**Exit criteria:** typographic mode is visibly richer without breaking interactivity.

## 18. Risks and mitigations

## Risk: browser performance is worse than expected

**Mitigation:**
start with monospace mode, use worker/offscreen rendering, reduce resolution during motion.

## Risk: line rendering looks noisy

**Mitigation:**
add direction bitmasks, junction rules, and entity-specific line palettes.

## Risk: typographic mode is too expensive per frame

**Mitigation:**
make it optional, restrict it to settled mode, premeasure glyphs, avoid full relayout every frame.

## Risk: tile/query APIs become a bottleneck

**Mitigation:**
cache by visible tiles, reduce re-query frequency, consider deeper custom tile decoding only if needed.

## Risk: overlapping entities become unreadable

**Mitigation:**
use a clear priority system and allow per-entity toggles.

## 19. Open questions

- Should labels be deferred entirely until after v1?
- Should typographic mode run only when the map is idle?
- Do we want strict ASCII only, or optional extended glyph sets later?
- Should the initial release support desktop only?
- Should the first implementation rely on MapLibre feature queries, or move earlier toward custom tile decoding for tighter control?
- Do we want a “theme” system from day one?

## 20. Recommended implementation decision

For the first real build, I recommend this product cut:

- **SvelteKit**
- **MapLibre-compatible vector tile source**
- **Monospace canvas renderer first**
- **Hybrid semantic pipeline**
  - polygons as coverage fields
  - lines as direction + coverage
  - points as symbols

- **Worker + OffscreenCanvas**
- **30 fps performance mode**
- **Pretext added as a second-stage typographic mode**

That gives you the fastest path to a compelling demo without locking you into a weak rendering model.

If you want, I can turn this into a more formal engineering PRD with implementation tasks, API boundaries, and milestone tickets.
