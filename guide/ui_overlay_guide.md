# UI and Overlay

## Layout

- Build production UI with `LayoutHandler` and `PositioningHandler`.
- `group()`/`bottomGroup()` require `endGroup()`; `spacer()` is group-only.
- `build()` returns `dynamicItems`, `staticItems`, and named components.
- Use `TYPOGRAPHY`, `BUTTON_STYLE`, `UI_SPACING`, and `UI_RADIUS` tokens. Do not inject raw font values through feature code.
- Keep screen-specific grids, hitboxes, motion coordinates, and control behavior with the screen owner; share only repeated semantic styles and layout rhythm.

## Resolution-independent units

- `WW`: percentage of the 16:9 UI width.
- `WH`: percentage of viewport height.
- `OW`/`OH`: percentage of parent width/height.
- `OX`/`OY`: parent-relative positions.
- Do not use fixed pixels for production layout or effects. See the always-read pitfalls and [`reference/display_viewport_guide.md`](reference/display_viewport_guide.md).

## Overlay lifecycle

Open overlays through `OverlayManager`, never by directly instantiating `BaseOverlay` as a session.

```text
manager open → session attach → focus transfer → resize/layout → open animation
→ update/draw → close lock → close animation → focus restore → surface release
```

Typical subclass hooks: `_onResize()`, `_getPanelDefinitions()`, `_calculateGeometry()`, `_generateLayout()`, `_drawOverlayDecorations()`, `applyRuntimeSettings()`, and `onCloseComplete()`.

- Use `getPanelLayoutParent()` and `createPanelPositioningHandler()` for panel-relative layout.
- `close()` locks input and owns focus restoration. Acquire `lockInteractions()` before asynchronous save/confirm work.
- Release layout elements before rebuilding. Reconcile controls when runtime relayout must preserve drag, selection, or animation identity.
- A live overlay must relayout for theme and language changes as well as UI-scale changes. Refresh subclass-owned theme assets before delegating to the base runtime-settings path so the rebuilt layout receives current colors and icons.

## Surfaces and glass

```text
dimSurface(2D) → effectSurface(WebGL) → uiSurface(2D)
→ optional floating effect/UI pair → top
```

- Glass requires session transparency, enabled backdrop sampling, and `disableTransparency === false`.
- Floating dropdown glass uses its floating effect/UI surfaces so it can sample the base panel and UI.
- When transparency is disabled, transition `glassMix`, stop backdrop composition, and release glass-only surfaces after the transition. Preserve effect surfaces still used by tilt, spotlight, ripple, or particles.
- A pooled dynamic canvas must reset both `display` and `visibility` on release and acquire. Full WebGPU cutover intentionally hides dynamic source canvases, and a later overlay may lease that same canvas.
- During an ACTIVE title WebGPU capture, `legacyDrawRequired=false` suppresses only legacy dim and glass `render`/`renderGL` sinks plus their backdrop pre-flushes. Semantic glass commands and Canvas2D UI/atlas drawing must continue. If semantic snapshotting fails, the legacy sink remains the local fail-closed path, while visibility recovery waits for a complete hidden legacy redraw and the final WebGL flush.
- Content blur may use a cropped ROI only for sessions that opt into presented-screen panel authority and record every visible out-of-panel element as well. The title menu therefore records all glass rectangles and the measured version/link block including its shadow halo; absent or invalid authority remains full-screen. When content blur is zero, bounds snapshotting and trusted-ROI geometry are both skipped instead of allocating authority data that cannot be consumed.
- Theme transition uses a fading solid-color veil on `top`; do not snapshot the full canvas. Bright previous backgrounds use a lower initial alpha so light-to-dark changes cannot produce a full-white first frame.

## Continuous animation

`AnimationSystem.animate()` returns a safe handle with `id`, `promise`, `retarget()`, `remove()`, and `isActive()`.

- Every production animation ingress provides the frozen `animationCategory` identity separately from easing
  `type`: `UI` for controls/overlays, `GAME_MECHANIC` for camera/gameplay presentation, and `EFFECT` for purely
  visual sequences. Retargeting may change easing but cannot change category, and pooled animations clear it.
- The hidden `uiAnimationDurationScale` setting defaults to `1.0` and is clamped to `0.1..4.0`. `SystemHandler`
  injects a live resolver; `AnimationSystem` divides only UI-category delta by the scale. Authored duration/delay,
  fixed-step selection, `GAME_MECHANIC`, and `EFFECT` time remain unchanged.
- Wheel, slider, hover, and press updates retarget the existing handle from the displayed value.
- Default `speedEasing = false` restarts the chosen easing while preserving value continuity.
- Use `speedEasing = true` only for an intentionally tuned Hermite velocity-continuous effect.
- Per-frame pointer following uses `getContinuousInputBlend()` instead of creating animations per event.

Settings previews update memory/runtime without file I/O. Persist raw committed values; presentation may animate a separate display value.

Settings sliders consume keyboard input only through semantic `MOVE_LEFT`/`MOVE_RIGHT` actions after the
slider owns hover/focus and no dropdown/drag lock is active. Each edge applies the schema `step` through the
same quantizer as pointer drag, retargets the displayed value, then emits one change and one commit; UI code
does not inspect physical Arrow key strings.

Tooltip delay is a real variable-frame timer, not an animation duration. Its single setting authority is
`default=0.30`, `min=0`, `max=2`, `step=0.01`, `precision=2`; the settings state, slider, save coercion, and runtime
fallback consume that schema. UI animation scale must never divide tooltip hover seconds or its separate fade arithmetic.
