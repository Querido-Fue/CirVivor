# Always-Read Pitfalls

Read this file before every code change.

## Reuse before adding

- Search the owning system, sibling modules, public helpers, data definitions, render APIs, and tests before adding a function or file.
- Extend the current owner when the capability already exists. Do not create a parallel color, math, animation, input, collision, layout, rendering, or game-rule implementation inside a feature.
- Add a new file or function only when it has a distinct responsibility, a clear owner, a real caller, and a testable boundary. File length alone is not a reason to split.
- Preserve one authority. Do not duplicate defaults, catalogs, formulas, IDs, or state in fallback constants.

## Keep every visual resolution independent

- Do not author production positions, sizes, spacing, strokes, corner radii, blur, or effect ranges as fixed pixels.
- Gameplay uses tile/world units. UI uses `WW`, `WH`, `OW`, `OH`, anchors, and parent-relative metrics.
- Pixels are allowed only as results inside backing-store, raster-resource, or final viewport adapters.
- Resize, DPR, render scale, and camera zoom may update projection or layout only. They must not rescale or reset physics, AI, paths, colliders, or saved world coordinates.
- Use the same projection for drawing and pointer-to-world conversion. Cache static viewport geometry by projection revision.

## Respect ownership and time domains

- Read gameplay values from `project/game/script/data/`; keep layout, algorithms, protocols, pool sizes, and buffer limits with their implementation owner.
- Fixed update mutates gameplay. Variable update interpolates presentation. Draw code does not mutate simulation.
- Solver correction updates current physics/body data, not the previous render transform.
- UI and scene input emit semantic commands; they do not mutate live world arrays or state stores.
- Avoid double ownership or double ticks during scene/system transitions.

## Preserve identities and lifecycle

- Reuse pools through their acquire/release contract and fully reset reused state, IDs, generations, caches, listeners, and interpolation data.
- Retarget one active animation for continuous input. Do not replace it on every wheel, drag, hover, or press update.
- Scene destruction releases registrations, listeners, UI leases, animations, pooled objects, pending commands, and session-owned resources.
