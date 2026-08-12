# Project Structure

## Entry points

| Path | Owner |
| --- | --- |
| `project/game/index.html` | HTML, import map, canvas layers |
| `project/game/style.css` | Global canvas and overlay CSS |
| `project/game/script/main.js` | `App`, fixed-step accumulation, rAF |
| `project/game/script/time_handler.js` | Fixed/variable delta and interpolation alpha |
| `project/game/script/module/system_handler.js` | System initialization and frame order |
| `project/game/script/data/` | Declarative settings, content, balance, themes, localization, resource metadata |
| `project/game/script/module/` | Runtime systems and feature code |
| `project/game/test/` | Node/NW.js contract, parity, integration, and golden tests |

## Runtime modules

| Path | Responsibility |
| --- | --- |
| `module/display/` | Canvas/WebGL surfaces, Display-owned WebGPU platform/device generation, and render submission |
| `module/input/` | Raw input, bindings, semantic action snapshots |
| `module/animation/` | Fixed/variable animations and retargetable handles |
| `module/ui/`, `module/overlay/` | UI primitives, layout, overlays, glass effects |
| `module/object/`, `module/physics/` | Legacy title objects plus benchmark auxiliary player/box/projectile simulation; no benchmark enemy authority |
| `module/simulation/` | Main-thread snapshots, frame-boundary command queue, profiler |
| `module/scene/` | Loading, title, play, and benchmark lifecycle |
| `module/ingame/` | Session `GameSystem` and the new gameplay slice |
| `module/save/`, `module/sound/` | Persistence and audio |


## Guide ownership

| Path | Responsibility |
| --- | --- |
| `guide/gameplay/` | Current sandbox product/runtime authority: Entity Words, teams, Tower HP/share, enemy behavior, Overtime, UI, save/tests |
| `guide/ingame_plan/` | Current implementation status, architecture, roadmap, acceptance |
| `guide/gpu_sim/` | Completed GPU migration and low-level GPU contracts; historical scope statements do not override gameplay authority |
| `guide/domain/` | Legacy/reference behavior only unless explicitly routed by current guides |

## Current play paths

- Play: `scene/game/_game_scene.js` → `ingame/game_system.js` → `ingame/object/game_object_system.js`.
- GPU enemy flow/collision: `ingame/navigation/route_flow_field_atlas.js` → `ingame/object/enemy/enemy_simulation_backend.js` → `ingame/physics/gpu/`; the dependency factory injects the Display-owned platform port.
- Benchmark: `scene/benchmark/_benchmark_scene.js` → wave-disabled child `scene/game/_game_scene.js` → public GPU endpoint. `scene/benchmark/**` owns its command protocol, next-fixed spawn adapter, controls, HUD, and auxiliary rendering/update helpers.
- Benchmark CPU auxiliaries: global `ObjectSystem` advances only the benchmark player/boxes/projectiles. They are visual/stress helpers and have no collision bridge to GPU enemies.
- Current gameplay data: `data/object/tower/`, `data/object/core/`, `data/scene/game/`.
- Title menu behavior stays in `module/scene/title/menu/`; title data contains metadata and links only.

Use import-map aliases from `index.html`. `game/` maps to `script/`, not `script/module/`.
