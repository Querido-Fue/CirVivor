# R2 Turn 4 Checkpoint Report

> Historical checkpoint snapshot: the statements below are frozen to 2026-08-10 Turn 4. Current production
> status is in `guide/ingame_plan/status.md`; Turns 5–6 were authored later and Body ABI is now v7. Do not read
> this report's "Turn 5 has not started" sentence as current routing status.

Status: `r2t4 수행 완료.`

Checkpoint date: 2026-08-10. Turn 1–4 cumulative validation is complete. Turn 5 has not started.

## Implementation evidence

- Arrow gameplay uses dedicated 16-byte exact Tower-target configuration; tracked pose is presentation-only.
- Formation authoring uses independent `memberCount + rows/columns`; legacy `size` is rejected.
- Effect/P and Formation/H/HX remain outside `ENEMY_BEHAVIOR_STATE`.
- Formation ABI v1 layouts are body/candidate `80/48`, prepare `48 + 144N`, transform `64 + 192N` bytes.
- Peak Formation storage profiles are prepare-select/transform-aux/render `9/8/8`.
- Natural n1 H, transform-private n2..5 group, and transform-private n6 HX use one-body atomic transforms.
- Current/max centi-HP uses `sum + trunc(sum/10)`; H/HX fixed n-table and exact lineage/rekey contracts are authored.
- Terminal/replacement seams include Formation cancellation/reset and stale-port revocation.
- Production corridor wave remains 32 spawns at five-tick intervals; `enemy-hexa-formation` is dedicated support.

## Gate results

| Gate | Command/stage | Status | Evidence/result |
| --- | --- | --- | --- |
| Changed JS/MJS syntax | `node --check` over changed JS/MJS | PASS | 42/42 files |
| Full Node | `npm test` | PASS | 1245/1245 tests, 0 failures |
| WebGPU default | `npm run test:webgpu:capability` | PASS | default NW.js/WebGPU capability route |
| Dedicated hardware 1 | `maximum-damage-window` | PASS | exact bounded damage-window scenario |
| Dedicated hardware 2 | `enemy-arrow-charge` | PASS | dedicated gameplay target is independent from tracked pose |
| Dedicated hardware 3 | `enemy-rhom-priority` | PASS | Core-first/Tower-second selected-target priority |
| Dedicated hardware 4 | `enemy-pentagon-effect` | PASS | retryable `CAPACITY_REJECTED` is zero-partial and consumes no cadence |
| Dedicated hardware 5 | `enemy-hexa-formation` | PASS | H→HX five-merge chain, exact lineage/effect rekey, atomic rejection, ABA/replacement, route/SDF/render |
| WASM flow | `npm run check:wasm:flow-field` | PASS | reproducibility check |
| WASM collision | `npm run check:wasm:collision-contact` | PASS | reproducibility check |
| WASM flow stress | `npm run test:wasm:flow-field:stress` | PASS | seed `0x71c0ffee`; 1,000 cases; 3,824,454 cells; ABI canary 3 layouts |
| Render golden update | `npm run update:render:golden` | PASS | audited historical vignette baseline synchronization only |
| Render golden check | `npm run test:render:golden` | PASS | 10 surfaces; 3 cases; final SHA `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf` |
| Repeated H stress/churn | Turn 9 scope | NOT RUN | no separate Turn4 script; the bounded `enemy-hexa-formation` hardware scenario passed |
| Manual smoke | optional/environment-dependent | NOT RUN | not substituted with automated hardware evidence |
| Diff hygiene | `git diff --check` | PASS | no whitespace errors |

## Hardware highlights

- The explicit default and five dedicated stages all passed on actual NW.js/WebGPU.
- `enemy-hexa-formation` reached n6/HX after five atomic merges with mask 63, generation 4, exact six-handle
  lineage, centi-HP `774/774`, 16 prepared/actual Effect rekeys, zero-partial capacity rejection, replacement/
  ABA reset, route/reverse/SDF/overflow coverage, and bounded render/storage evidence.
- The five dedicated scenarios completed without an uncaptured WebGPU error. Explicit teardown reports only the
  expected destroyed-device reason where applicable.

## Render-golden provenance

The initial check reproduced only the stale `overlay.effect` baseline. Independent history/diff audits traced
the exact affected panel bounds to commit `57f60a3`, which intentionally changed the vignette from excluded to
included in the backdrop after the previous golden was recorded. The current output was stable across preserved
runs and contains no new Turn4 visual behavior. The official update command refreshed the manifest plus
`canonical.overlay.effect.rgba`, `canonical.final.rgba`, and `canonical.final.png`; the subsequent golden check
passed with the SHA recorded above.

## Acceptance conclusion

All required Turn4 checkpoint gates passed. Repeated R2 stress/churn remains assigned to Turn9 by
`R2_GOAL.md`; the optional manual smoke was not run and is not reported as PASS. Progress may be exactly
`r2t4 수행 완료.`. Turn 5 has not started.
