# Legacy Collision Pipeline

This guide covers the JS/NW.js title and benchmark collision oracle. New play currently has Tower-vs-tile resolution only; do not assume the legacy object pipeline is already owned by the session `GameSystem`.

## Ownership and order

`ObjectSystem` owns one `PhysicsSystem`, which delegates to `CollisionHandler`.

```text
begin frame
→ player/item/projectile integration
→ enemy status, AI, movement
→ prepare canonical enemy bodies
→ collect hexa contact before solve
→ resolve enemy/player/wall positions
→ projectile sweep
→ finalize hexa presentation and merge
```

Changing contact-before-solve changes merge timing and presentation.

## Position solve

- Reuse body, grid, candidate, manifold, and query buffers.
- Keep object bodies and broad/relation SoA synchronized after current-position correction.
- Never move `prevPosition` during solver correction; it is render history.
- The first and optional third passes rebuild the grid; the second pass reuses conservative candidates.
- Candidate admission and processing budgets rotate deterministically. Truncation must prevent incomplete observations from putting enemies to sleep.
- Player/wall guaranteed pairs remain independent from normal enemy-pair budgets.
- `circleParts × circleParts` retains its solve broad-circle reject; other shape pairs go directly to exact checks after candidate admission.

## Shapes and projectiles

- Normal enemies and player bodies are circles; walls are rectangles.
- `hexa_hive` uses multiple circular parts from `filledLocalCenters`.
- Projectile collision is a swept query from previous to current position. Piercing projectiles keep an enemy-ID hit set; non-piercing projectiles stop at the first ordered hit.
- Collision emits geometry/contact results. Final damage, Gold, words, wave state, and UI belong elsewhere.

## WASM contact kernel

Prepared hexa contact may batch canonical body/part/pair planes into the WAT backend. JS owns body creation, candidate order, and result publication. Publish only after a complete successful batch; capability, initialization, ABI, or execution failure falls back to the JS boolean detector for the current call and process lifetime.

Keep deterministic artifact checks and JS parity when this path changes:

```text
npm run check:wasm:collision-contact
npm run benchmark:wasm:collision-contact
```

Measure candidate, narrow-phase, solve, debt, and fixed p95/p99; do not approve an optimization from FPS alone.
