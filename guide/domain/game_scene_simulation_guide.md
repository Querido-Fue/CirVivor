# Game Scene and Simulation

## Ownership

| Layer | Responsibility |
| --- | --- |
| `SceneSystem` | Active scene and loading/title/play/benchmark transitions |
| `GameScene` | Thin lifecycle adapter for one session `GameSystem` |
| `GameSystem` | Current new-game session slice |
| `BenchmarkScene` | GPU-only interactive benchmark owner: one wave-disabled child `GameScene`, CPU auxiliary controls, HUD, profiler |
| `GpuSimulationEndpoint` | Session backend, stable registry, next-fixed lifecycle command boundary |
| Global `ObjectSystem` | Title objects plus the visible benchmark auxiliary player and boxes; never benchmark enemies/projectiles |

`BenchmarkScene` and its helpers live under `module/scene/benchmark/`. It keeps `mode === 'benchmark'` and `runtimeMode === 'gpu-only'`, creates a child `GameScene` with `enemyWaveEnabled: false`, and forwards each GPU lifecycle hook exactly once. Its dependency wrapper replaces the child's play-world clear port with a no-op because the parent owns the CPU auxiliary world. The visible blue player remains a CPU auxiliary object, while the child endpoint owns one hidden, inverse-mass-zero `benchmark-player-proxy` at the same world position and radius so GPU enemies collide with it. That coexistence does not create a second enemy authority: CPU enemy construction and drawing are forbidden in benchmark mode.

## Simulation snapshot

`simulation_runtime.js` mirrors viewport, semantic input, and selected settings for fixed/gameplay consumers. `SystemHandler` updates it after input initialization, at tick start, on resize, and after runtime setting changes.

- Consumers use `getSimulation*()` accessors and do not mutate returned snapshots.
- The runtime reuses internal buffers; public getters preserve their copy contract.
- This is a main-thread dependency boundary, not worker authority.

## Benchmark frame-boundary queue

```text
benchmark/UI event → command builder → enqueue
→ scene variable update completes → queue drain
→ SceneSystem.applySimulationCommands() → BenchmarkScene dispatcher
```

- Command types live in `scene/benchmark/commands/benchmark_scene_command_protocol.js`.
- Clear the queue before scene transitions.
- The queue validates only a type string; benchmark builders/apply handlers own payload validation.
- New gameplay commands must use the stronger ingame phase/revision/idempotency contract. `GameSystem.handleCommands()` currently returns no results and is not an implemented command router.
- `SPAWN_GPU_ENEMY_BATCH` is resolved only during command drain. The benchmark adapter computes `GameSystem.getFixedTick() + 1`, checks endpoint state/capacity, creates route-bound intents, and calls public `requestSpawn()`; the child session remains the only commit/tick owner.
- Child-session creation calls `gpu_benchmark_player_proxy_spawn_adapter.js` once before user enemy batches. It reserves the hidden proxy through `getNextGpuLifecycleFixedTick()` and public `requestSpawn()`; resize never duplicates it and profile restart creates exactly one proxy in the new session.
- Auxiliary replace/box/destroy commands mutate only the benchmark-owned CPU player/wall/box arrays. The protocol exposes no CPU enemy or CPU projectile spawn command.

## GPU enemy endpoint

- Stable imports come from `ingame/gpu_simulation_endpoint.js`; an active play session exposes the same object through canonical `getGpuSimulationEndpoint()` accessors. Enemy-named accessors remain compatibility aliases.
- `requestSpawn()` and `requestDespawn()` only queue work. `commitAtFixedBoundary()` is the mutation boundary, and the endpoint keeps backend and `WorldRegistry` visibility consistent.
- When attached to a game session, `GameObjectSystem` alone owns commit, fixed update, presentation update, draw, synchronization, and destroy. Callers must not duplicate those lifecycle calls.
- `getStatus()` is diagnostic aggregation only and does not perform full-body readback.
- The benchmark enemy, projectile, and player-proxy spawn adapters are callers, not endpoint owners. They may reserve commands but must never commit, tick, present, draw, synchronize, or destroy the child endpoint.

## Play and benchmark

- Play creates the selected `TileMap`, Core, Tower, semantic controls, and camera through the session `GameSystem`.
- Resize preserves the world and updates projection only.
- Benchmark creates a real child `GameScene` with `enemyWaveEnabled: false`; there is no automatic production wave or CPU enemy comparison mode.
- Each child session reserves one hidden `KINEMATIC_OBSTACLE` body at the blue player's canonical `(32, 18)` world position with radius `0.72`. Enemy masks include that bit, the static proxy only masks enemies, and the proxy remains in the small collision-grid bucket. Enemy batch requests fail closed unless the proxy request was accepted.
- `Spawn 100 GPU Enemies` enqueues one semantic batch. Frame-end drain reserves 100 route-bound `basic_circle_01` intents for the next fixed tick through the public endpoint, while the child `GameObjectSystem` alone commits and submits them.
- Restart and strict/reference/capped profile buttons destroy the old child and create a fresh GPU session. This also resets benchmark spawn identity/counters and the CPU auxiliary world; profile selection is not a live clock mutation.
- Benchmark resize forwards projection changes to the child without resetting GPU body state, then reprojects the CPU player's world-space `0.72` radius so its visible circle remains aligned with the unchanged proxy. Pause/resume forwards `synchronizePresentation()`.
- GPU projectiles share the child endpoint. CPU box/profiler controls remain for the old interactive surface; dynamic boxes are not uploaded to the immutable GPU terrain SDF and therefore do not interact with GPU enemies.
- The benchmark binary navigation SDF uses 8 subdivisions per source tile. A setup-only exact EDT plus signed half-SDF-cell bias makes authored rectangle faces the zero contour and limits the measured small-enemy corner contact error to about `0.026` world units without changing per-frame sample or dispatch counts. The world Jacobi pass also evaluates accumulated body delta before terrain, avoiding the previous half-cell visual inset without adding another dispatch.
- GPU failure stays visible in the HUD; there is no silent CPU fallback. HUD status must not call body readback.
- Benchmark rendering may combine the child GPU world with its CPU auxiliary overlay, but must never create or draw global CPU enemies.

## Play GPU-world recovery evidence

`GameScene` may replace only the restartable GPU World at a safe wave boundary; CPU run identity and the
global fixed tick remain owned by `GameSystem`. Immediately before an accepted replacement, the scene captures
the old endpoint/backend/lifecycle and independent director status. Only after replacement succeeds does the
injected `gpu_world_recovery_log.js` port synchronously persist that immutable snapshot as
`project/logs/reset_YYYY-MM-DD_HH-mm-ss-SSS.txt`. Collision-safe numeric suffixes handle same-millisecond
restarts. The record contains the prioritized cause plus the complete pre-replacement diagnostic, so the
replacement may not erase the first failure evidence. Logging failure is reported but never creates a second
gameplay recovery. `project/logs/` is runtime evidence and is intentionally ignored by Git.

See [`../ingame_plan/status.md`](../ingame_plan/status.md) before extending play.
