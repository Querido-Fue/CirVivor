# Windows Runtime and Benchmark

Use the current `computer-use` skill for all UI-control mechanics and confirmation policy. This file contains CirVivor-specific facts only.

## Launch and navigation

- Executable: `C:\CirVivor\project\lonely tower.exe`.
- A clean benchmark baseline uses a process restart, not F5/Ctrl+R.
- Open Settings → Display and Performance → Performance Benchmark.
- `BenchmarkScene` provides spawn, projectile, box, and release-profiler controls.
- DevTools may appear as a separate app/window. Re-discover the game and DevTools windows after restart or reopening DevTools.

## Measurement

- Measure with debug mode off after focus returns to the game and the scene stabilizes.
- Record active enemies, game rAF FPS, actual fixed tick/s, dropped debt/lost simulation time, and frame/fixed p95/p99.
- Chrome Frame Rendering Stats is compositor evidence, not a replacement for game rAF or fixed throughput.
- Test real-time glass/blur without disabling or dirty-throttling it to improve the result.
- Compare identical build, viewport, render scale, warmup, spawn sequence, and scene state.

## Cleanup

Restore debug mode, DevTools overlays, and the user's foreground app to their prior state. Do not leave an unintended running benchmark, pending Git action, or modified runtime setting.
