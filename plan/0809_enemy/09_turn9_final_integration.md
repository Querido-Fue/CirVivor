# R2 Turn 9 — Full Enemy Ecosystem Integration and Final Acceptance

이 턴은 R2 최종 전체 검증 게이트다. 2026-08-12 최종 누적 runner와 모든 자동 acceptance가
통과했으며, 아래 결과로 R2를 완료한다.

## 시작

```text
r2 완료.
```

## 목표

C/T/A/H/HX/P/M/O/J/R/Z와 공통 시스템을 injection-only showcase waves/maps에 통합하고,
아래 전체 게이트가 실제로 통과한 뒤에만 R2를 완료한다.

## 1. Showcase content

Authored `r2_enemy_showcase_map_data.js`/`r2_enemy_showcase_wave_data.js`는 default corridor와 분리된
injection-only content다. Open-ring O 공간과 dual-route Z geometry를 사용하며 세 단계로 다음을 보인다.

```text
C/T baseline pressure
A charge/recoil
M Core-priority ranged fire
P Boost stacks
H group merge and HX
O directional orbit defense
J split/regrowth
R projectile capture
Z route closure on multi-path map
formation row spawning
```

```text
stage 1  C/T/A/M/P + authored rows
stage 2  H → HX, O, J, R
stage 3  Z route availability + route-bound formation
```

첫 wave에 모든 mechanic을 동시에 넣지 않는다. Showcase의 동시 O는 4로 고정하여 8-slot capacity
안에 둔다. Default production corridor map/wave에는 O/J/R/Z를 삽입하지 않고 기존 콘텐츠를 유지한다.

Showcase acceptance에 들어가기 전에 완료된 carry-forward contracts:

```text
J trigger              FIRST_VALID_POSITIVE_DAMAGE_HIT after each producer's own hit-policy validation
J presentation         dedicated analytic/legacy jorang shape; basic_gen_01 compatibility alias optional
J Effect transfer      EffectDefinition-owned deterministic non-duplicating distribution
O target baseline      keep LATCH_CORE_FALLBACK for current single Tower
O future targeting     document dynamic reacquisition for Tower reappearance/multi-Tower gameplay
O capacity             authored simultaneous count 4; fixed capacity 8
O overflow             reject whole fixed-tick spawn batch, zero mutation, recovery=false;
                       authored stagger/retry after a slot becomes available
```

Projectile remains the currently connected J producer and calls the common seam only after its own
`CLOSEST_ONLY`/team/target/self-hit-budget/final-positive-damage validation. The helper ABI itself accepts source
body, damaged target, final positive damage, producer kind, already-validated producer policy, and expected phase;
it does not depend on projectile identity or contact budget. Explosion, Effect, direct, and melee producers can
call that one-shot seam independently after their own validation, but are not claimed as implemented/executed.
J renders the dedicated `jorang` analytic/legacy shape; `basic_gen_01` remains compatibility identity only.
Penta Boost's `EffectDefinition` owns deterministic non-duplicating
`stable-instance-id-modulo-destination-count`, assigning each exact instance once to
`instanceId % destinationCount`; the reserved legacy destination word does not select a child.

Ring R carry-forward contracts are also complete in authored production/fixtures:

```text
capture direction      inside inclusive funnel AND strictly closing relative velocity
capacity exhaustion    whole-batch zero mutation, recovery=false, later retry/data-owned backoff
corruption             ABI/identity/fingerprint/bilateral mismatch remains recovery
no-Tower release       stored forward + null target handle; Core is never silently added as a target
provenance             logical projectile/origin relationship preserved for future Subject/Sentence runtime
sentence status        no end-to-end Sentence/Fireball execution claim
```

The host/shader/actual-stage gate must distinguish inside-inbound, boundary-inbound, outside, and
inside-outbound. A transient capture-prepared shield prevents generic damage between preflight and seal,
including normal capacity rejection, without publishing bilateral or metadata mutation.

Cork Z/Route carry-forward contracts are:

```text
gameplay noun          BLOCKING Z remains hostile Enemy by interaction metadata + hostile Team
physical role          bodyLayer/ROUTE_BLOCKER is not Effect target noun authority
expand boundary        visible growth remains nonblocking; CLOSED availability + physical blocker activate together
formation closure      original group route remains pinned; unspawned members backlog; no partial row 0
reopen                 remaining group/rows materialize atomically on that original route
future reroute change  moving remaining formation to another path must be one atomic policy change
resource closure       exact lease/incarnation cleanup, roster cap 8, all runtime profiles max storage 9
```

## 2. Production integration

Turn 9 decision is locked: the default corridor map/wave remains unchanged. R2 showcase content is supplied only
through explicit map/wave injection and does not silently alter the 32-spawn five-tick production schedule.
All showcase composition is data-owned; no random threat budget is introduced.

## 3. Visual feedback

Minimum readable telegraphs:

```text
A windup/charge line/recoil
M target/fire state
P pulse and stack count
H slot/link/merge progress
HX health bar
O armored facets/orbit
J lineage/transform countdown
R captured projectile
Z closed route
Tower damage window hit feedback
Core impact/defeat status
```

Resolution independent.
AnimationSystem calls require explicit category.

## 4. Cross-system invariants

Validate:

```text
P effects on H/O/J/R/Z
H merge with effects
O directional mitigation before Tower/Enemy windows as applicable
J split under effects
R capturing reflected/modified projectile
Z closure with formation groups
P Boost targets BLOCKING Z as hostile Enemy independent of physical bodyLayer
Z EXPAND remains physical-nonblocking until availability CLOSED + ROUTE_BLOCKER publish together
mid-spawn formation keeps one original-path remaining-entry backlog and publishes no partial row 0
Arrow/M/O remain live while their route movement is WAIT
R/J/H keep capture/lineage/formation state through reroute or WAIT without recovery
Core impact dispositions
bounty conservation/bonus telemetry
Tower death Enemy persistence
GPU recovery and old callbacks
```

No Gold payout, but bounty budgets/dispositions must be correct.

## 5. Performance/boundedness

Stress:

```text
large authored formations
H merge churn
P effect instances
J exponential branches within caps
R inbound capture/release plus whole-batch capacity rejection
Z reroute/lease/incarnation cleanup and formation backlog
mixed projectiles
```

Ensure:

```text
no per-Enemy JS object growth
bounded pools/histories
normal capacity rejection no recovery
no slot/reservation/event leak
storage max <=9
one GPU submit per fixed tick
```

Run the mixed O/J/R/Z/H/P churn gate three times. Normal R capture/release capacity exhaustion, O slot overflow,
J transform capacity rejection, and route all-closed formation backlog must remain zero-partial and
`recovery=false`; identity/ABI/fingerprint/bilateral corruption remains recovery.

## 6. Full tests

Run all accumulated focused tests and repair.

The authored orchestrator is `project/game/test/support/run_r2_final_acceptance.mjs`. On Windows it launches
the NW capability wrapper with the discovered platform Node executable rather than relying on a shell shim.
Its presence is an authored gate, not a PASS result.

2026-08-12 final cumulative execution evidence:

```text
final runner                 node game/test/support/run_r2_final_acceptance.mjs; exit 0
changed production syntax    38/38 PASS
full Node                    1401/1401 PASS; fail 0
actual WebGPU                default + exact nine selected stages PASS
all ten hardware receipts    NW.js 0.108.0; effective storage maximum 9;
                             uncapturedErrorCount=0; deviceLostReason=destroyed
Full/Arrow/Maximum/Rhom      NVIDIA Lovelace; adapter limit 10
Ring/Cork                    adapter/requested/device = 10/9/9
WASM/stress                  flow reproducibility PASS; collision reproducibility PASS;
                             seed 0x71c0ffee, 1,000 cases, 3,824,454 cells, 3 ABI canaries PASS
mixed churn v2               one device/session, 3/3 cycles, stable tuple/incarnation churn,
                             peak active 8, final churn/reserved/pending 0, all routes open,
                             recovery=false, storage maximum 9
render golden                PASS; 10 surfaces, 3 cases;
                             SHA 3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf
title GPU                    UI smoke PASS; production webgpu-gaussian + gpu smoke PASS;
                             T0-T5 worst p99 0.786432 ms
diff hygiene                 PASS
```

Raw aggregate stderr 포함 사항:

```text
Chromium command_buffer_proxy_impl teardown line  7건
분류                                             독립 NW process의
                                                 device.destroy → lost destroyed → result → App.quit
                                                 종료 경계 IPC noise
WebGPU fixture result                             각각 PASS, uncapturedErrorCount=0,
                                                 deviceLostReason=destroyed
acceptance 영향                                  없음; stderr clean 주장은 하지 않음
```

이 실행은 마지막 production/test 변경 뒤에 다시 수행한 누적 결과이며 `r2 완료.`와 최종 보고서
생성 조건을 충족한다.

Then:

```bash
npm test
npm run test:webgpu:capability
npm run check:wasm:flow-field
npm run check:wasm:collision-contact
npm run test:render:golden
git diff --check
```

The actual WebGPU run must execute the default route and explicitly select all nine dedicated stages, not merely
include them in a manifest:

```text
enemy-arrow-charge
maximum-damage-window
enemy-rhom-priority
enemy-pentagon-effect
enemy-hexa-formation
enemy-octagon-directional-defense
enemy-jorang-split-lineage
enemy-ring-projectile-capture
enemy-cork-route-closure
```

In particular, Turn 9 must execute both the default capability command and
`CIRVIVOR_WEBGPU_FIXTURE_STAGE=enemy-ring-projectile-capture npm run test:webgpu:capability`. The Ring stage must
return actual inside-inbound, boundary-inbound, outside, and inside-outbound evidence. The Cork stage must return
actual blocking-Z Effect-noun, atomic close boundary, pinned formation backlog, WAIT coexistence, exact cleanup,
and max-storage-9 evidence.

Also:

```text
changed production JS/MJS node --check
R2 showcase integration
10k or practical versioned GPU fixture
three O/J/R/Z/H/P churn/soak runs
save/settings/UI accepted regressions
flow-field stress
title GPU smoke
```

Render golden:
- no baseline update,
- known mismatch only may be classified as historical,
- new mismatch/timeout blocks.

Actual WebGPU:
- uncapturedErrorCount 0,
- requested storage max 9,
- orderly device lost destroyed.

## 7. Manual smoke

If environment supports:

```text
play showcase waves
verify every enemy visual behavior
verify Tower damage window
verify Core defeat
verify camera after Tower death
pause/resume
```

If unavailable, record exact reason and keep `automatedResult:false`. Automated hardware evidence must not be
substituted for manual visual PASS.

Final record:

```json
{
  "id": "manual-showcase-smoke",
  "automatedResult": false,
  "reason": "최종 누적 실행은 비대화형 자동 runner였고, 사람의 interactive showcase 플레이/시각 검증 및 pause/resume 세션을 실행하지 않았다."
}
```

따라서 수동 visual PASS를 주장하지 않는다. 실제 하드웨어 자동 fixture PASS는 이 항목을 대체하지 않는다.

## 8. Final guides

Update:

```text
AGENT_GUIDE.md
guide/ingame_plan/status.md
guide/gameplay/04_enemy_behavior_and_combat.md
guide/gameplay/06_gpu_runtime_requirements.md
guide/ingame_plan/03_system_contracts.md
guide/ingame_plan/05_object_and_collision.md
guide/ingame_plan/06_ai_path_and_wave.md
guide/ingame_plan/12_implementation_roadmap.md
guide/ingame_plan/13_testing_and_acceptance.md
```

위 명령이 검증 결과를 생성했으므로 이 문서와 권위 guide는 R2 COMPLETE 및 실제 구현 시스템만
기록한다.

Still unimplemented:

```text
Enemy Word
sentence sandbox
multi-Tower Share/Split/Merge
Gold payout/Shop/Overtime
```

## 9. Final report

After acceptance, write the report in the existing plan authority directory:

```text
plan/0809_enemy/r2_final_report.md
```

Do not create a duplicate under the non-authoritative requested path
`plan/r2_enemy_ecosystem/r2_final_report.md` unless the plan router itself is migrated first.

Include:
- exact commit/base/worktree,
- architecture,
- content table,
- test commands/results,
- WebGPU numbers,
- render classification,
- performance,
- remaining risks,
- R3 seams.

## 10. 완료

Only after all gates actually pass:

```text
plan/0809_enemy/r2_enemy_ecosystem_progress.md
→ r2t9 수행 완료.
```

Then router finalization:

```text
→ r2 완료.
```

2026-08-12 현재 최종 progress는 정확히 `r2 완료.`이며 최종 보고서는
`plan/0809_enemy/r2_final_report.md`에 있다.

Failure:

```text
r2t9 BLOCKED: <one-line reason>
```

and pause.
