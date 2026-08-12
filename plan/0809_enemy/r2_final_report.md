# R2 Enemy Ecosystem Final Report

## 결론

R2 Enemy Ecosystem은 2026-08-12 완료되었다. 권위 progress는 정확히 `r2 완료.`다.

최종 누적 acceptance:

- 기준 커밋: `478fd5c` (`478fd5c96ca15f92a3a1c84867b165b76184b2ab`)
- 작업 branch: `main`
- 작업 루트: `C:\CirVivor`
- 프로젝트 루트: `C:\CirVivor\project`
- 구현 커밋: `bc5e83650bee9b7eafdaa98c8078128fb0a6e234` (`r2t9 complete`)
- 최종 acceptance hardening 커밋 제목: `r2t9 acceptance hardening`
- 최종 runner: `node game/test/support/run_r2_final_acceptance.mjs`
- 결과: exit `0`

이 보고서는 아직 만들어지지 않은 자기 commit hash를 기입하지 않는다. 실제 최종 commit hash는
commit 완료 후 Git 기록이 권위다.

## 구현 범위

R2는 per-Enemy JavaScript AI 객체를 늘리지 않고 하나의 mixed GPU World와 versioned independent
state domain을 확장했다.

| 영역 | 구현 |
| --- | --- |
| 공통 Enemy | immutable EnemyDefinition/profile/capability, spawn-time stat resolve, hostile Team/interaction identity |
| 공통 전투 | continuous Enemy→Tower contact, weight, Tower Maximum Damage Window, exact Core impact/cleanup, RunFailed seal |
| C/T | common/fast-light Core route 기준 적 |
| A | exact Tower seek, non-homing charge, contact recoil, recover, Core fallback |
| M | GPU tick-start Core-first/Tower-second selected projectile |
| P | independent Effect A/B pool, Boost stack/regen/attack channels, bounded pulse director |
| H/HX | independent Formation ABI, exact lineage, atomic pair merge, n1→n6/HX, Effect rekey |
| O | fixed eight-slot Tower orbit, shared facing, 3/8 directional defense, latched Core fallback |
| J/C′ | producer-neutral first-positive-hit seam, dedicated `jorang`, atomic 1→2, 60-tick 1→1 return |
| R | inbound/strictly-closing same-identity projectile capture/release and metadata CAS |
| Z | optional routeGraph/RouteRuntime exact lease, expansion, atomic close/blocker, reroute/wait |
| Showcase | injection-only dual-route/open-ring map과 세 단계 wave; default corridor는 그대로 유지 |
| 표현 | analytic/legacy J/R/Z shapes; legacy 16-cell page-0 atlas UV ABI + overflow pages |
| 종료/교체 | versioned cancellation, published transform/release completion, all-open route reset, stale-port revoke |

현재 Body ABI는 v8이다. 기존 primary plane, 40-byte `CombatState`, 80-byte
`EnemyBehaviorState`를 유지하면서 J/C′의 48-byte `AtomicTransformState`, R/projectile의 48-byte
`ProjectileCaptureState`, 각 16-byte candidate plane, 그리고 independent Route Runtime ABI v1을
분리했다. 전체 compute/storage profile maximum은 9다.

## 잠긴 carry-forward 계약

- BLOCKING Z는 physical `bodyLayer=ROUTE_BLOCKER`와 무관하게 hostile Team과 explicit Enemy interaction
  identity로 P Effect 대상 Enemy noun을 유지한다.
- Z EXPAND는 visually growing이지만 physically nonblocking이다. expansion 완료 경계에서만 availability
  `CLOSED`와 physical blocker가 함께 활성화된다.
- mid-spawn route closure는 original formation route를 고정하고 미발행 전원을 하나의 backlog로 유지한다.
  reopen은 같은 route에 한 batch로 publish한다. 미래 reroute 정책은 remaining formation 전체를
  atomically 이동해야 한다.
- R no-Tower release는 stored forward와 null target handle을 유지하고 Core를 추론하지 않는다.
- R의 immutable logical projectile/origin provenance는 미래 Subject/Sentence 연결 준비다. 현재
  end-to-end Sentence/Fireball 실행 증거가 아니다.
- J helper seam의 현재 실제 ingress는 projectile뿐이다. Explosion/Effect/direct/melee는 미래 호출 seam이며
  실행된 기능으로 보고하지 않는다.
- exact lease/incarnation cleanup, O/Z capacity 8, storage maximum 9를 유지한다.

## 최종 자동 검증

| Gate | 결과 |
| --- | --- |
| changed production JS/MJS `node --check` | `38/38 PASS` |
| focused Node | 22-file inventory, `192/192 PASS` |
| full Node | `1402/1402 PASS`, fail 0 |
| actual WebGPU | default + exact nine selected stages, 모두 PASS |
| WASM | flow-field reproducibility PASS; collision-contact reproducibility PASS |
| flow stress | seed `0x71c0ffee`, 1,000 cases, 3,824,454 cells, 3 ABI canaries, PASS |
| mixed churn v2 | one device/session, 3/3 cycles, PASS |
| render golden | 10 surfaces, 3 cases, PASS; baseline update 없음 |
| title GPU | UI `webgpu-kawase + cpu` smoke PASS; production `webgpu-gaussian + gpu` smoke PASS |
| diff hygiene | accepted-base→HEAD, index, worktree, untracked PASS |
| authority link closure | 65 Markdown documents, 110 unique targets, missing 0 |

Final acceptance output binds the accepted base and current HEAD commit/tree, rejects revision drift during
the run, and keeps committed syntax/diff evidence nonempty even on a clean checkout.

최종 committed candidate에서는 프로젝트 루트 `C:\CirVivor\project`에서 아래 literal npm 진입점도 각각
별도 실행해 exit `0`을 확인했다. stage 환경 변수는 각 명령 범위에만 설정하고 종료 후 제거했다.

```powershell
npm run test:webgpu:capability
$env:CIRVIVOR_WEBGPU_FIXTURE_STAGE='enemy-ring-projectile-capture'; npm run test:webgpu:capability
$env:CIRVIVOR_WEBGPU_FIXTURE_STAGE='enemy-cork-route-closure'; npm run test:webgpu:capability
```

명시적으로 실행된 actual WebGPU stage:

```text
full
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

열 개 hardware fixture receipt의 공통 직접 증거:

```text
runtime                          NW.js 0.108.0
status                           pass
effective storage maximum        9
fixture uncapturedErrorCount    0
fixture deviceLostReason        destroyed
```

Adapter/device 세부 정보가 직접 출력된 범위는 다음과 같이 분리한다.

```text
Full/Arrow/Maximum/Rhom          NVIDIA Lovelace; adapter limit 10
Ring/Cork                       adapter/requested/device storage 10/9/9
P/H/O/J                         vendor 또는 전체 10/9/9 tuple을 receipt가 직접 출력하지 않음;
                                stage PASS와 effective storage maximum 9만 기록
```

Aggregate stderr에는 독립 NW 프로세스 종료 경계에서 Chromium
`command_buffer_proxy_impl: GPU state invalid after WaitForGetOffsetInRange`가 나타날 수 있다. 그 줄 수는
process/run마다 달라지므로 고정 acceptance 수치가 아니다. 각 경계의
순서는 `device.destroy → lost: destroyed → result publication → App.quit`이고 wrapper는 process close를
기다렸다. 대응 fixture는 모두 PASS, `uncapturedErrorCount=0`, `deviceLostReason=destroyed`이며 cumulative
runner도 exit 0이다. 따라서 teardown IPC noise로 분류하며 acceptance blocker가 아니다. Aggregate stderr가
비었거나 clean했다고 주장하지 않는다.

## Cork cross-system actual evidence

`enemy-cork-route-closure` stage가 다음을 실제로 검증했다.

- physical layer `1024`/Enemy interaction layer `1`인 BLOCKING Z에 P Boost 적용, exact target true,
  Boost stack 1, recovery false.
- source tick 61은 availability LEASED와 physically nonblocking, tick 62는 CLOSED와 blocker 동시 활성화.
- formation은 두 remaining member를 original path `west-upper-core`에 backlog하고 partial row 0을
  publish하지 않았으며, reopen 때 같은 path로 1 batch publish.
- Arrow/M/O는 route-owned WAIT에서 program/state를 유지.
- R/J/H는 reroute하면서 capture/atomic/formation state를 유지하고 recovery false.
- ninth Z whole-batch reject는 zero mutation/recovery false, exact lease generation은 증가, stale ABA
  incarnation은 reopen하지 못함.
- terminal/replacement는 all-open, roster/readback 0, stale authority reject.
- storage maximum 9.

## Mixed churn / boundedness

Version 2 churn은 한 WebGPU device와 한 endpoint/session에서 O/J/R/Z/H/P/projectile 7종을 함께
spawn/cleanup했다.

- 3/3 cycles 완료.
- session/device tuple 안정.
- entity IDs 2–8 재사용, incarnation `1→2→3`.
- Cork lease generation `1→2→3`.
- peak active 8; bounded high-water true.
- 매 cycle cleanup 뒤 lifetime sentinel 1개만 유지.
- final churn active 0, reserved 0, 모든 domain pending/readback/queue 0.
- route all-open, route roster/lease 0.
- fixed/submitted tick delta는 cycle당 2; 총 submit 6.
- recovery false; storage maximum 9.

## 렌더와 성능

Render golden은 baseline을 갱신하지 않고 통과했다.

```text
profile  win32-x64-nw0.108.0-dpr1-7eb3079ce6d3
surfaces 10
cases    3
SHA-256  3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf
```

두 title smoke 모두 T0–T5를 통과했다. 명시적 UI alternate는 `webgpu-kawase + cpu`, production
default는 `webgpu-gaussian + gpu`다. 이 smoke receipt는 `budgetRequired:false`이므로 raw p99는 실행 진단일
뿐 1 ms acceptance 또는 최종 performance claim으로 사용하지 않는다.

## Manual evidence

```json
{
  "id": "manual-showcase-smoke",
  "automatedResult": false,
  "reason": "최종 누적 실행은 비대화형 자동 runner였고, 사람의 interactive showcase 플레이/시각 검증 및 pause/resume 세션을 실행하지 않았다."
}
```

따라서 manual visual PASS를 주장하지 않는다. Actual hardware fixture PASS는 이 항목을 대체하지 않는다.

## 남은 위험과 R3 seam

R2 밖이며 아직 구현되지 않은 항목:

- Enemy purchasable Subject/Payload Word와 end-to-end Sentence sandbox.
- multi-Tower Share/Split/Merge, Lost Share ledger, group control/camera summary.
- 일반 GPU subject selector와 high-count child allocator.
- Gold payout, Shop, Wave completion, Overtime/Siege Pressure.
- Archer/M 외 일반 hostile attack selection.
- long-duration soak와 사람의 showcase visual/pause-resume QA.

R3에서는 현재 보존된 capability metadata, exact provenance, producer-neutral J seam, 그리고 R의 logical
origin provenance를 사용하되, 이 R2 acceptance를 Sentence 실행 증거로 재해석하지 않는다.
