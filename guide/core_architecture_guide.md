# Core Architecture

## Initialization

`window.onload` initializes time/utilities, then `SystemHandler`, then starts `App` and rAF. `SystemHandler.init()` creates services in dependency order:

```text
Save → Sound → Display → Animation → Input → simulation snapshot
→ UI → Object/Physics → Scene/LoadingScene → Overlay → Debug → pool warmup
```

`SimulationRuntime`, `SimulationCommandQueue`, and `ReleaseSimulationProfiler` are module singletons, not entries in the system list.

`AnimationSystem` receives a live `getUiAnimationDurationScale` port from `SystemHandler` after Save creation.
Animation categories are independent of easing `type`; only `UI` uses `baseDelta / scale`, while
`GAME_MECHANIC`, `EFFECT`, fixed gameplay, and tooltip hover seconds retain their existing clocks.

## Frame ownership

`App.loop()` normalizes frame time, maintains the fixed accumulator, calculates the fixed-step count and interpolation alpha, then calls `SystemHandler.tick()`.

```text
sync simulation snapshot
→ fixed: time → fixed animation → object → scene → optional game manager
→ set interpolation alpha
→ clear render surfaces
→ variable: time → sound → animation → input → UI → overlay → object → scene
→ drain/apply simulation commands → debug
→ draw: input → object → scene → optional backdrop flush → UI → vignette
→ overlay → profiler/top → debug → sound → final WebGL flush
```

## Fixed-step rules

- Fixed delta is always `1/60`; never enlarge it to repay backlog.
- Physics, AI, collision, gameplay state, and gameplay timers run in fixed update.
- Variable update computes render interpolation and presentation only.
- Moving objects store the previous fixed transform before integration. Draw uses the interpolated transform.
- GPU enemy presentation supports strict interpolation, extracted reference-clock extrapolation, and capped accumulator extrapolation. The reference profile advances a separate render clock and sends only `predictionDelta` to WGSL; it never changes physics state.
- Position correction updates current position/body data but not the previous render position.
- Pausing clears accumulated time so resume does not trigger catch-up bursts. Each pause/resume epoch also calls the active scene's presentation synchronization hook exactly once so GPU reference clocks cannot predict across paused wall time.
- The scheduler may discard excess whole-step debt under load. Measure actual fixed tick/s, debt, and p95/p99; FPS alone is not a simulation result.

## Runtime boundaries

- Fixed/gameplay code reads viewport, semantic input, and settings through `simulation_runtime.js`, not display/input/save singletons.
- Physical `KeyboardEvent.code` stays inside `input/`; consumers use semantic action IDs.
- Scene/UI mutations cross the appropriate command boundary.

## WebGPU ownership

- `DisplaySystem` owns `WebGpuPlatformService`, the transparent `gpu-object` canvas, adapter/device, canvas configuration, and monotonically increasing device generation.
- Play code receives `webGpuPlatformPort` from `game_scene_dependency_factory.js`; `GameSystem` and ingame modules do not import Display globals.
- `GameObjectSystem` owns one session `EnemySimulationBackend`. It derives SDF and the immutable route-stage flow atlas once from the current `TileMap`, then delegates flow steering, fixed collision, presentation clock, indirect draw, and teardown.
- The backend is lazy: it does not allocate GPU pipelines/buffers until the first accepted body. When the injected WebGPU platform is ready, the production `WaveDirector` schedules the seven-entry square/triangle/basic-arrow/penta/hexa/gen/Archer cycle from fixed tick 1; all keep the shared GPU circle-body physics contract. Unsupported sessions leave the wave disabled until a CPU fallback exists.
- Existing JS/WASM route-stage direction planes remain navigation output authority. `route_flow_field_atlas.js` uploads those immutable planes as an `rg32float` array; it does not rebuild flow fields per body or per fixed tick.
- `WorldRegistry` owns incremental GPU body `(entityId, incarnation)` handles. `EnemyLifecycleCommandOwner` reserves handles invisibly, commits due despawn→spawn batches at the next fixed boundary, activates only backend-accepted spawns, and cancels rejected reservations. Spawn/despawn writes only new/tombstoned slots and never reuploads surviving GPU-authoritative positions.
- `GameSystem` proposes one monotonically increasing session fixed tick. The tick and the mixed GPU World advance only after lifecycle/fixed-command commit and the authoritative GPU submit succeed; telemetry backpressure retries the same proposed tick.
- Before the first authoritative submit, a zero-accept temporary unavailability preserves pending spawn commands and retries the same tick. Among states reported by `requiresRecovery()`, only telemetry `gpu-backpressure` is retryable. Platform `unsupported`/`destroyed` and a missing port map to `gpu-terminal-unavailable`; they become a hard gate only while a wave, pending command, or active body requires GPU work. A wave-disabled Tower/Core session does not stall on an unused terminal backend.
- A hard GPU World failure is a safe-wave-boundary restart, not a mid-wave body replay. `GameScene` keeps the same `GameSystem` and CPU run-domain state while `GameObjectSystem` atomically replaces endpoint/registry/backend/wave state after the platform is ready. One attempt per device generation is allowed until the replacement completes a tick.
- Production endpoint initialization is lazy: `init()` may return `false` while runtime state is the healthy
  `gpu-deferred` state. Recovery preflight therefore accepts only `gpu-deferred|gpu-ready` with
  `requiresRecovery() === false`; boolean `false` alone is not a failure, and terminal/recovery states never cut over.
- A GPU body may die between submit and asynchronous CPU death observation. A later exact control for that
  already-dead body is a normal no-op only after all structural/range/entity/incarnation/flow/move checks pass.
  Those mismatches remain hard protocol failures; normal death timing must not produce `event-readback` recovery.
- The first `WaveDirector` owns deterministic spawn scheduling only. Core arrival/contact/damage/death and wave completion are deliberately outside its authority.
- A generation change with live GPU-authoritative bodies requires the safe-wave GPU World restart. Preserve Core Integrity, Gold, words, TowerShare/Lost Share, map/wave state, and input/camera identities; never resume transient bodies from stale spawn buffers.
- Grid overflow is a failed physics tick: WGSL restores previous positions and route field indices, sticky telemetry reports the fault asynchronously, and the session requires an authoritative rebuild. Backpressure also freezes Tower integration and GPU presentation age while the enemy tick is not submitted.
- The WebGPU canvas is cleared by its session renderer and is currently excluded from glass backdrop composition to avoid cross-API readback/copy stalls.

## Import-map aliases

`animation/`, `data/`, `debug/`, `display/`, `game/`, `input/`, `ingame/`, `object/`, `overlay/`, `physics/`, `save/`, `scene/`, `simulation/`, `sound/`, `ui/`, `util/`.
