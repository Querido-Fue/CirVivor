> **Legacy AI reference only.** New-play EnemyDefinition behavior and hostile targeting authority is
> `../gameplay/04_enemy_behavior_and_combat.md`. Do not infer the new sandbox rules from legacy AI.

# Legacy Enemy AI and Flow Fields

This guide covers the global `object/enemy/ai/` implementation used by title and benchmark. New play must adapt proven kernels behind the session `AISystem` and authored Core routes.

## Runtime structure

- `_enemy_ai.js`: runtime entry.
- `_enemy_ai_core.js`: decision and steering core.
- `enemy_spatial_index.js`: tick-start enemy index and density buffer.
- `_enemy_ai_navigation.js`: compatibility facade.
- `navigation/`: LOS geometry/cache and flow-field store.
- `wasm/_enemy_ai_flow_field_backend.js`: JS/WASM selection.
- `data/object/enemy/enemy_ai_data.js`: gameplay profiles; implementation limits stay in code.

All enemies integrate every fixed tick; expensive decisions are distributed by ID-based decision groups. Shared navigation fields combine with per-enemy steering state.

## Spatial and LOS rules

- Build the enemy index from tick-start positions before enemy updates.
- Preserve deterministic tie breaks: enemy ID, then tick-start order where required.
- Query exact rules after spatial filtering; dense single-cell worst cases can still approach O(N²).
- Prefer direct LOS steering. Use cached flow fields only when direct/path steering is blocked or insufficient.
- LOS caches key on wall identity/version and use conservative fallback to the exact linear scan for unsafe or unhelpful indexed queries.

## Flow-field backend

- Cache navigation grids by wall/view/cell/clearance identity and fields by grid plus goal.
- Use JS for grids below 1,024 cells and WASM at or above the threshold until remeasured.
- Cache misses are pure precompute boundaries. State, target selection, cache authority, and final steering remain JS-owned.
- Copy WASM results out of linear memory before caching.
- Any capability/compile/runtime/ABI failure permanently selects JS fallback for the process.
- JS and WASM output must be byte exact for integration and direction planes.

```text
npm run check:wasm:flow-field
npm run test:wasm:flow-field:stress
npm run benchmark:wasm:flow-field
```

New gameplay route state is `gateId`, `pathId`, and `waypointIndex`; a single Core-goal field must not shortcut authored crossing routes.

The new-play GPU adapter now calls the same public JS/WASM builder once per authored waypoint and packs the results into an immutable route-stage atlas. GPU bodies carry a validated field index, sample the nearest cell, use the extracted source steering/mix/speed-clamp rule, and move to the recorded next layer only at that stage's goal cell. Do not add a second flow generator or collapse repeated crossing waypoints into one layer.
