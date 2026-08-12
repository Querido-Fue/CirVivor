# Scene Lifecycle

## Routes

| Entry | Scene |
| --- | --- |
| initialization | `LoadingScene` |
| `completeLoading()` | `TitleScene` with presentation identity handoff |
| `gameStart({ mapId })` | play-only `GameScene` |
| `benchmarkStart()` | GPU-only interactive `BenchmarkScene` |

Game transitions clear queued frame-boundary simulation commands, destroy the old scene, create the new scene, then publish the new scene state.

An overlay-owned scene route starts only after its close animation completes and `OverlayManager` releases the session entry. Queue the route in a microtask from `onCloseComplete()` when the manager must finish synchronous cleanup first; never switch scenes from the button callback while the closing overlay still owns surfaces.

`GameScene` is a thin adapter to its session `GameSystem`. `BenchmarkScene` owns one `enemyWaveEnabled: false` child `GameScene`, a CPU auxiliary player/box/projectile fixture, benchmark controls, and the profiler session. Enemy authority remains exclusively in the child GPU endpoint.

## Lifecycle methods

- `fixedUpdate()`: deterministic scene/gameplay work.
- `update()`: input and presentation.
- `draw()`: render submission only.
- `resize()`: refresh projection/layout; never reset gameplay state.
- `applyRuntimeSettings()`: apply live settings.
- `applySimulationCommands()`: consume the frame-boundary command queue where applicable.
- `destroy()`: idempotently release all owned resources.

Destroy animations, listeners, input registrations, UI leases, overlay/session resources, pooled objects, deferred commands, and child components. `GameScene.destroy()` destroys its `GameSystem`; `BenchmarkScene.destroy()` destroys the child GPU session, clears the auxiliary CPU world, clears buttons, and disables the release profiler.

Benchmark restart and presentation-profile selection are full child-session transitions: destroy the current child, create a fresh wave-disabled child with the selected profile, reset spawn counters and the auxiliary fixture, then rebuild buttons. A normal benchmark resize preserves the child GPU enemy state and resets only the viewport-relative auxiliary fixture. CPU auxiliary boxes/projectiles do not collide with GPU enemies.

Every fresh GPU body simulation owns one initial clear of the shared `gpu-object` target, even when its body count is zero. Composer abort preserves that pending clear for retry; only a committed or directly submitted clear consumes it. This prevents the preceding title frame from surviving into an empty benchmark session.

Loading-to-title is a presentation handoff, not a world rebuild. Preserve component/controller identity across the handoff; Title owns movement and enemy-spawn timing after the logo phase.
