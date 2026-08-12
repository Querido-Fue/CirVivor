# Display, Viewports, and Units

## Display regions

| API | Meaning |
| --- | --- |
| `getWW()` × `getWH()` | Full render target and new gameplay viewport |
| `getUIWW()` × `getWH()` | Centered 16:9 UI reference area |
| `getWW()` × `getObjectWH()` | Legacy/benchmark object area |
| `getScaleRatio()` | Backing-store to CSS coordinate ratio |

Use `getUIOffsetX()` for centered UI and `getObjectOffsetY()` only for legacy/benchmark object coordinates.

Fixed/gameplay code reads mirrored `getSimulation*()` values from `simulation_runtime.js`; it does not import `display_system.js`.

## Startup resize handoff

NW.js의 fullscreen/zoom 전환은 비동기로 완료될 수 있고, `SystemHandler.init()`은 WebGPU capability probe를 포함한 비동기 초기화를 기다립니다. 이 구간에는 아직 전역 `Game`이 없으므로 window `resize` 이벤트가 시스템으로 전달되지 않을 수 있습니다.

`main.js`는 모든 시스템 초기화와 `window.Game` 등록을 마친 직후 `Game.start()`보다 먼저 `Game.resize()`를 한 번 호출합니다. 이 최종 handoff가 현재 window metrics를 Display → simulation viewport → Object/UI/Overlay/Scene 순서로 수렴시키므로, 초기 전체화면 경로에서 이 호출을 제거하거나 WebGPU probe 완료 시점에만 의존하지 않습니다.

## New gameplay world

```text
1 authored tile = 1 world unit
fitScale = min(viewportWidth / worldWidth, viewportHeight / worldHeight)
renderScale = fitScale * cameraZoom
```

- Physics, AI, paths, colliders, and save data remain in world units.
- Resize updates viewport/projection revision only; it does not recreate or rescale entities.
- `WorldCamera2D` uses zoom `0.7` by default. Entering or leaving above-default zoom blends the view center between the map center and the Tower over the same `0.4s easeOutExpo` interval as zoom; after the blend reaches one it centers the Tower's interpolated render position exactly.
- Camera offsets are not clamped at map edges, so out-of-world background may be visible.
- Static tile viewport geometry is cached by projection revision. Dynamic objects are projected at draw time.
- Pointer conversion uses the same `IWorldViewProjection2D.viewportToWorld()` contract.

Render scale and DPR are adapter details. They are never gameplay or UI design units.
