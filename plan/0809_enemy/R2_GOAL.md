# R2_GOAL.md

## 최종 목표

다음 적 생태계와 공통 시스템을 구현한다.

```text
공통
- interface/capability 기반 EnemyDefinition
- GPU Tower Maximum Damage Window
- Weight 기반 물리 충돌과 넉백 저항
- 모든 Enemy의 Tower 접촉 공격
- 모든 Enemy의 Core impact 피해·소멸·Gold forfeiture
- authored wave timeline / formation schema
- map/wave stat modifier
- Core depletion / RunFailed

적
- C: 기본 Core-route
- T: 빠르고 가벼운 Core-route
- A: Tower 돌진·접촉·반동·재돌진, Tower 부재 시 Core
- M: Core 우선 원거리 사격, Tower 차선
- P: 독립 Effect instance를 주기적으로 부여하는 Boost 지원
- H/HX: 벌집 formation, group merge, 6-member HX transform
- O: Tower 공전, 3면 방향성 방어, 현재 single-Tower `LATCH_CORE_FALLBACK`; 미래 roster-change
  exact-living-Tower 재획득(최저 entityId → incarnation), 8-slot whole-batch 초과 거절/데이터 stagger 재시도
- J: producer-neutral `FIRST_VALID_POSITIVE_DAMAGE_HIT` one-shot seam, 현재 projectile 실제 ingress,
  dedicated `jorang` shape, atomic C′ 2개 분열, EffectDefinition-owned stable-instance modulo 비중복 분배,
  60-tick T-1→T 각 branch J 복귀, uint32 bounty·Effect·HP·pose·exact-root lineage 보존
- R: inbound/strictly-closing Player projectile same-identity 포획, immutable logical origin provenance 보존,
  capture/release capacity whole-batch zero-mutation normal rejection, active metadata CAS, no-Tower
  stored-forward + null target handle Hostile 재방출(Core target 추가 금지)
- Z: optional routeGraph/immutable Flow·SDF 위 exact lease, visual/nonblocking 60-tick radius-3 확장 후
  availability CLOSED + ROUTE_BLOCKER 동시 공개, hostile Enemy Effect noun 보존, original-route formation
  remaining-entry backlog, active forward reroute/clearance wait, Tower 물리 차단, projectile 통과
```

2026-08-12 final routing note: Turns 1–9 production/contracts/tests/showcase와 최종 누적 acceptance가
완료되었다. Body ABI는 independent `AtomicTransformState`/`ProjectileCaptureState`를 포함한 v8이고,
RouteRuntime/availability는 독립 ABI v1이다. Default corridor map/wave는 변경하지 않으며 showcase는
explicit injection으로만 활성화한다. J의 미래 explosion/Effect/direct/melee는 producer-neutral seam 호출
가능 계약일 뿐 현재 실행 producer로 선언하지 않는다. Ring의 no-Tower release는 null target handle과
stored forward를 유지하며 Core를 추론하지 않는다. 보존된 logical origin provenance는 미래
Subject/Sentence 연결 준비일 뿐 end-to-end Sentence 실행 증거가 아니다.

최종 runner는 changed-production syntax `38/38`, full Node `1401/1401`, default actual WebGPU와 exact nine
stages, 두 WASM 재현성 검사, flow stress, audited render golden, 두 title GPU smoke, diff hygiene, 그리고
single-device/session O/J/R/Z/H/P/projectile churn 3/3 cycles를 모두 PASS했다. 열 개 hardware receipt는
모두 NW.js `0.108.0`, effective storage maximum 9, `uncapturedErrorCount=0`,
`deviceLostReason=destroyed`를 직접 보고했다. Full/Arrow/Maximum/Rhom receipt는 NVIDIA Lovelace와 adapter
limit 10을, Ring/Cork는 adapter/requested/device `10/9/9`를 추가로 직접 보고했다. Manual showcase는 비대화형 누적
runner에서 사람이 실행하지 않았으므로 `automatedResult:false`이며 수동 visual PASS로 대체하지 않는다.
Progress authority는 정확히 `r2 완료.`다.

## 권위 파일

항상 먼저 읽는다.

```text
AGENT_GUIDE.md
guide/agent_pitfalls_guide.md
./00_shared_contracts.md
./r2_enemy_ecosystem_progress.md
```

그 다음 진행 파일의 정확한 한 줄에 따라 하나의 턴 파일만 읽는다.

## 진행 파일 규칙

경로:
./r2_enemy_ecosystem_progress.md

이 파일은 한줄로 간략하게 작성한다. 예: r2t2 수행 중.

## 자동 진행 프로토콜

1. 현재 진행 파일과 현재 git diff를 읽는다.
2. 해당 턴을 시작하기 직전에 진행 파일을 `r2tN 수행 중.`으로 덮어쓴다.
3. 해당 턴 파일의 범위를 끝까지 구현한다.
4. 일반 턴에서는 공통 계약에 정의된 최소 위생 검사만 수행한다.
5. Turn 4와 Turn 9에서만 전체 검증 게이트를 수행한다.
6. 성공하면 진행 파일을 정확히 `r2tN 수행 완료.` 한 줄로 덮어쓴다.
7. 이후 깃에 r2tN 로그로 커밋을 진행한다.
8. 사용자 확인을 기다리지 않고 이 라우터를 다시 읽어 다음 턴으로 진행한다.
9. hard blocker이면 진행 파일을 `r2tN BLOCKED: ...` 한 줄로 바꾸고 Goal을 pause한다.
10. Turn 9의 모든 acceptance가 통과하면 `r2 완료.`로 바꾸고 최종 보고를 남긴다.

## 검증 체크포인트

```text
Turn 1~3
- 행동 테스트를 작성하지만 실행하지 않음
- changed production JS/MJS node --check
- git diff --check

Turn 4
- Turn 1~4 누적 전체 검증
- focused suites
- npm test
- actual NW.js/WebGPU
- 두 WASM 검사
- render golden
- 가능한 manual smoke
- git diff --check

Turn 5~8
- 행동 테스트를 작성하지만 실행하지 않음
- changed production JS/MJS node --check
- git diff --check

Turn 9
- R2 전체 최종 검증
- focused/full Node
- changed production JS/MJS `node --check`
- actual NW.js/WebGPU default route + exact nine stages:
  `enemy-arrow-charge`, `maximum-damage-window`, `enemy-rhom-priority`, `enemy-pentagon-effect`,
  `enemy-hexa-formation`, `enemy-octagon-directional-defense`, `enemy-jorang-split-lineage`,
  `enemy-ring-projectile-capture`, `enemy-cork-route-closure`
- 두 WASM 검사
- flow-field stress, render golden, title GPU smoke
- O/J/R/Z/H/P 3회 stress/churn
- 가능한 manual smoke; 미실행은 exact reason + `automatedResult:false`
- git diff --check
```

## 완료 조건

다음이 모두 충족된 뒤에만 `r2 완료.`를 기록한다.

```text
- 모든 Turn 1~9 production scope 구현
- Turn 4 checkpoint 통과
- Turn 9 final acceptance 통과
- storage-buffer maximum <= 9
- uncaptured WebGPU error = 0
- 기존 R1/Pre-R2 계약 유지
- 새 render golden regression 없음
- guide 최신화
- progress file 정확히 한 줄
```
