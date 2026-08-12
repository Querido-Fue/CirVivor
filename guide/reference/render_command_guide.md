# Render Commands

## API and layer order

- `render()` submits Canvas 2D commands to `texteffect`, `ui`, `vignette`, `top`, or dynamic 2D surfaces.
- `renderGL()` submits WebGL commands to `background`, `object`, or `effect`.
- GPU enemy instances render directly through the injected WebGPU platform port to the `gpu-object` surface; they do not pass through `renderGL()`.
- Mixed-body GPU physics remains circle-based, while its 32-byte presentation style uses byte 24 as a render-only shape code. Circle is the zero/default for projectiles and generic bodies; production enemies select analytic square, triangle, arrow, penta, hexa, generator, rhombus, octagon, or ring masks in the existing single indirect draw. During route-flow `SEEK_TOWER`, O's shape follows ordinary movement and has no armor rim. After radius capture into `ORBIT_TOWER`, octagon rotation and the front-three-facet rim both consume the same GPU behavior-facing value; render must not infer armor direction from velocity or a copied CPU pose. R's ring mask uses data-owned outer/inner radii. A held projectile is excluded only when the Simulation captured bit exactly mirrors its bilateral `ProjectileCaptureState`; render must not infer held state from Team, velocity, alpha, or host-only roster data.

```text
background(WebGL) → gpu-object(WebGPU) → object(WebGL) → effect(WebGL)
→ texteffect(2D) → ui(2D) → vignette(2D)
→ dynamic overlay surfaces → top(2D)
```

Common 2D shapes are `rect`, `roundRect`, `circle`, `line`, `text`, `image`, and `arrow`. WebGL shapes/effects use the batch atlas and effect-pass registry.

## Batching and direct drawing

- Use `renderGLShapeInstances()` for many identical shape/style instances.
- Cache prepared vertices only for immutable canonical inputs and stable cache keys.
- `WebGLBatch.begin()` resets CPU queues; `flush()` rebinds all required GL state before draw.
- The WebGL shape atlas preserves its original 16-column, 1536×96 page-0 UV ABI. New shapes append to fixed-size overflow pages; texture identity changes flush the batch rather than resizing page 0.
- If code draws directly through a canvas/context, call the display surface's direct-draw/direct-clear marker so revision and empty-state metadata stay correct.

## Surface lifecycle

- Backdrop composition excludes empty surfaces and uses surface revision metadata.
- External resources created on a DisplaySystem-owned WebGL context must invalidate on `webglcontextlost`, recreate on restore, and remove listeners on destroy.
- WebGPU session resources compare `deviceGeneration` before submit. With live authoritative bodies, a changed generation pauses until the owner provides a fresh dense body snapshot.
- A WebGPU draw uses premultiplied alpha, clears its transparent target in the render pass, submits, then calls `markCanvasDrawn()`. The hot signal path emits clear then draw without allocating a diagnostic state snapshot, so every rendered frame gets a fresh surface revision.
- `gpu-object` has `includeInComposite: false`; do not introduce synchronous GPU-to-CPU readback to make glass sample it.
- Non-persistent 2D frame clear uses a fresh style cache. Do not recycle it by deleting or setting fields to `undefined`; reentrant clear/render depends on cache isolation.
- Preserve intentional pre-backdrop and final WebGL flush points. Moving them can change sampled pixels.

## Verification

Use `npm run test:render:golden` for the approved Windows/NW.js profile. Update goldens only after explicit visual-output approval; never overwrite them to bypass an environment mismatch.
