> **2026-08-08 gameplay authority update**
>
> Preserve completed GPU World migration. Do not restore CPU Tower physics to implement HP or
> multi-Tower. Legacy hexa merge is an algorithmic reference only, not Tower/Enemy conservation authority.

# 11. Legacy Reuse and Cutover

## 1. 기본 원칙

기존 play 코드는 API 호환 대상이 아니라 검증 자료다. 파일을 그대로 살리는
것보다 다음 질문으로 판단한다.

1. 새 도메인 권한과 책임이 맞는가?
2. 성능·동일성 테스트가 있는가?
3. GameSystem port 뒤에 격리 가능한가?
4. placeholder 데이터나 live 전역 상태를 강제하지 않는가?
5. 삭제 후 다시 만들기 어려운 기술 자산인가?

## 2. 우선 보존

| 영역 | 현재 경로 | 보존 방식 |
| --- | --- | --- |
| fixed scheduler 개념 | `main.js`, `time_handler.js`, `system_handler.js` | 1/60 fixed, accumulator, interpolation 계약 유지 |
| 렌더 기반 | `module/display/` | 기존 레이어와 batch API를 adapter로 사용 |
| 전역 UI 기반 | `module/ui/` | primitive/layout/cursor/lang/tooltip 유지 |
| 오브젝트 풀 패턴 | `module/object/_object_pool.js` | incarnation/reset/cap 계약을 추가해 재사용 |
| 충돌 파이프라인 | `module/physics/` | 새 Collider adapter 뒤에 유지 |
| WASM contact | `module/physics/wasm/` | WAT/bytes/parity/fallback 유지 |
| Flow Field | `module/object/enemy/ai/navigation/`, `wasm/` | AISystem 내부 service로 이동·포장 |
| SimulationRuntime | `module/simulation/simulation_runtime.js` | engine snapshot port로 유지 |
| profiler | release/debug profiler | 새 GameSystem phase 계측 추가 |
| 설정/진행 저장 | `module/save/`의 setting/progress | 별도 transaction 의미를 유지하며 존치 |

## 3. adapter 후 재사용

### ObjectSystem

살릴 부분:

- enemy pool factory
- ID와 swap-and-pop 경험
- fixed interpolation helper
- PhysicsSystem 호출 순서
- hexa merge contact/표현 로직

교체할 부분:

- 전역 singleton world 권한
- enemy/player/wall/projectile로 분할된 live 배열 소유
- GameScene이 배열을 등록하는 `setPlayers/setWalls/setProjectiles`
- AI와 gameplay rule의 직접 결합
- 외부에 live enemy 배열 반환

전환 adapter:

```text
LegacyObjectPort
→ 기존 ObjectSystem을 한 번만 tick
→ 새 GameSystem에 read-only 결과/event 제공
```

최종 단계에서는 `WorldRegistry`가 직접 collision adapter를 호출한다.

### AI

살릴 부분:

- decision group
- EnemySpatialIndex
- LOS cache/index
- Flow Field LRU/indexed heap
- WASM/JS backend 선택

교체할 부분:

- `player`를 기본 goal로 주입하는 context
- placeholder enemy policy와 직접 상태 mutation
- Path/Lane/Core가 없는 목표 모델

### SimulationCommandQueue

FIFO와 scene transition clear 개념은 재사용할 수 있다. 새 command는
`GameCommandRouter`에서 명령별 schema, phase, revision, idempotency를 검증한다.
generic queue의 `{ type }` 검사만으로 gameplay command를 신뢰하지 않는다.

## 4. 교체

| 영역 | 현재 경로 | 이유 |
| --- | --- | --- |
| play GameScene 본체 | `scene/game/_game_scene.js` | benchmark/play 혼합, 비어 있는 fixedUpdate, resize reset |
| benchmark 버튼/HUD | `scene/game/render`, builder 일부 | 실제 게임 UI/command와 무관 |
| 월드 command apply | `scene/game/commands/*` | scene과 ObjectSystem의 이중 권한 |
| Player placeholder | `object/player/_player.js` | HP뿐 아니라 실제 controller/component 모델 부재 |
| Wall/Projectile placeholder | `object/wall`, `object/proj` | Word metadata, handle, pool/cap 계약 부재 |
| IngameHandler | `save/_ingame_handler.js` | 원자성/schema/recovery 부재 |
| placeholder ingame defaults | handler 내부 | 실제 RunState와 무관 |
| AI default target | ObjectSystem context | Core/Path 규칙과 불일치 |

파일은 새 수직 슬라이스가 통과하기 전 삭제하지 않는다.

## 5. Benchmark 격리

benchmark 기능은 버리지 않고 실제 play 구조에서 분리한다.

권장:

```text
SceneSystem
├─ GameScene
└─ BenchmarkScene
   ├─ collision stress world
   ├─ flow-field stress world
   └─ profiler HUD/buttons
```

BenchmarkScene은 같은 Collision/AI kernel을 주입받지만 GameState, Shop, Word,
checkpoint를 초기화하지 않는다. 이로써 benchmark 편의 분기가 production
GameSystem의 상태 머신을 오염시키지 않는다.

## 6. WASM 보존 게이트

전환 전후 모두 실행:

```text
npm run check:wasm:flow-field
npm run test:wasm:flow-field:stress
npm run benchmark:wasm:flow-field
npm run check:wasm:collision-contact
npm run benchmark:wasm:collision-contact
```

기존 전체 test:

```text
npm test
```

채택 기준:

- WAT artifact deterministic
- JS oracle와 exact parity
- backend 실패 fallback
- 새 adapter가 candidate/result 순서를 바꾸지 않음
- 기존 성능 채택 gate 이상

## 7. 단계적 cutover

### Stage A — 병행 구조, 단일 권한

- GameSystem 골격과 state/command/event만 생성
- 기존 ObjectSystem은 `LegacyObjectPort` 한 곳을 통해서만 접근
- play 결과는 아직 placeholder renderer로 관찰 가능

### Stage B — 새 월드 권한

- WorldRegistry가 Tower/Core/한 종류 적/투사체를 소유
- 기존 CollisionHandler adapter 사용
- SystemHandler의 기존 gameplay ObjectSystem tick을 끔
- 같은 프레임에 두 월드가 tick되지 않는 테스트 추가

### Stage C — 수직 슬라이스

- 한 맵, 한 웨이브, Core, Tower 이동/조준
- 최소 문장 한 개
- WaveCompleted → Shop → `ingame.dat` → Continue

### Stage D — 완전 전환

- Path/Lane/AI/Word/Log/UI 전체 연결
- 기존 GameScene command builder와 placeholder entity 제거
- benchmark를 별도 Scene으로 이동
- 가이드의 실제 파일 경로 갱신

## 8. 삭제 체크리스트

삭제 전:

- `rg`로 import/export 소비자 확인
- 관련 파일 전체 읽기
- 새 경로의 unit/headless/scene test 존재
- pool active count와 listener leak 0
- save migration/legacy detection test
- `git diff --check`

삭제 후:

- importmap dead alias 확인
- documentation path 확인
- title/loading이 공유하던 pool/physics dependency 회귀 확인
- benchmark 진입 확인

## 9. 알려진 현재 결함의 처리

### resize world reset

새 GameScene에서 즉시 금지하고 회귀 테스트를 먼저 만든다.

### split world ownership

GameScene의 player/wall/projectile와 ObjectSystem enemy 소유를 WorldRegistry로
통합한다.

### raw live references

성능 내부에서는 유지할 수 있지만 port 밖에는 snapshot/query만 제공한다.

### 직접 projectile damage

CollisionHandler의 결과를 HitIntent로 전환하고 CombatResolver가 확정한다.

### placeholder save 자동 생성

새 런 진입만으로 `ingame.dat`을 만들지 않고 첫 의미 있는 checkpoint에서 쓴다.
