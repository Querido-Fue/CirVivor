# Enemy AI And Pathfinding Guide

## 1. 목적

이 문서는 적 AI/pathfinding 구조와 최적화 방향을 정리합니다.

- 런타임 진입점은 `project/game/script/module/object/enemy/ai/_enemy_ai.js`입니다.
- 계산 코어는 `project/game/script/module/object/enemy/ai/_enemy_ai_core.js`입니다.
- 적 공간 조회는 `project/game/script/module/object/enemy/ai/enemy_spatial_index.js`입니다.
- flow field의 실행 backend는 `project/game/script/module/object/enemy/ai/wasm/_enemy_ai_flow_field_backend.js`입니다.
- 정책/품질 프로파일 상수는 `project/game/script/data/object/enemy/enemy_ai_constants.js`입니다.

## 2. 현재 구조

### 2.1 decision group

`ObjectSystem.fixedUpdate()`는 매 fixed tick마다 60개 `aiDecisionGroupCursor` 중 하나를 전진시키고, 적 ID를 기준으로 현재 그룹에 속한 적만 decision 재계산 대상으로 표시합니다. 현재 decision interval은 1초입니다.

- 모든 적이 매 tick마다 비싼 decision을 다시 계산하지 않습니다.
- 모든 적의 `enemy.fixedUpdate(delta, aiContext)`는 매 tick 호출됩니다.

### 2.2 공용 캐시와 적별 steering

공유되는 것:

- fixed tick 시작 좌표 기반 `EnemySpatialIndex`
- clearance별 bounded LRU `navGridCache`
- grid key와 목표 셀 기준 bounded LRU `flowFieldCache`
- decision tick 단위 shared flow/policy-target cache
- `EnemySpatialIndex`가 보유한 재사용 density count buffer

적마다 다른 것:

- 현재 위치와 셀
- 직선 시야 여부
- 최종 `dirX`, `dirY`
- 최종 `acc`
- `_enemyAIState`

즉, 현재 구조는 “공용 pathfinding 필드 + 적별 로컬 steering”입니다.

### 2.3 EnemySpatialIndex와 파트너 탐색

`fixedUpdateObjectSystemEnemies()`는 적별 AI를 실행하기 전에 현재 적 좌표로 `EnemySpatialIndex`를 한 번 구성합니다.

- 공간 셀 크기는 현재 품질 프로필의 `DENSITY_CELL_SIZE`와 같습니다.
- `hexa`/`hexa_hive` 파트너 탐색은 전체 적 배열 대신 search radius가 걸치는 셀만 조회합니다.
- 큰 `hexa_hive`는 모든 회전을 포함하는 보수적 footprint 범위가 걸치는 모든 셀에 등록되며, generation stamp로 중복 후보를 제거합니다.
- 조회 후보는 기존 search radius, 최대 merge member 수, player advance, 점수식을 exact 단계에서 다시 검사합니다.
- 동일 점수는 더 작은 enemy ID, ID가 없으면 tick 시작 배열 순서로 결정합니다.
- 모든 적이 한 셀에 몰리면 반환 후보 수가 다시 O(N)이 되므로 밀집 최악 조건의 O(N²) 가능성 자체는 남습니다.

공간 인덱스는 **tick 시작 스냅샷**입니다. 이전의 역순 적 업데이트에서 먼저 이동한 적과 아직 이동하지 않은 적을 섞어 관찰하지 않습니다. 파트너가 선택된 뒤에도 `targetEnemyId`로 활성 상태를 O(1) 확인하면서, 목표 좌표는 같은 인덱스 엔트리의 tick 시작 `x/y`를 사용합니다. 따라서 배열 순서나 해당 tick의 선행 이동 여부가 파트너 steering 목표를 바꾸지 않습니다.

`hexa_hive`의 파트너 재탐색은 TTL 만료, heavy decision, 파트너 무효, wall version 변경에서 수행합니다. 파트너가 없을 때의 3-ring 접근 목표도 heavy decision 또는 wall version 변경에서만 다시 고르지만, steering·가속·회전 적용은 계속 매 fixed tick 실행합니다.

### 2.4 직선 추적 우선

AI는 먼저 플레이어까지 직선 경로가 막혀 있는지 검사합니다.

- 막혀 있지 않으면 flow field를 쓰지 않고 직접 추적합니다.
- 막혀 있으면 flow field를 조회하거나 생성합니다.
- direct-path 결과는 적별 숫자 필드에서 시작점·목표점·패딩의 정확 좌표가 모두 같을 때만 재사용합니다. 움직이는 적마다 다른 float 문자열을 만드는 tick 공유 캐시는 사용하지 않습니다.
- LOS 벽 경계는 `walls` 배열 identity와 `wallsVersion`별 packed Float64 buffer로 한 번 구성하며, 적별 판정은 패딩을 scalar로 적용합니다.
- TTL 만료나 정책 갱신으로 실제 flow 목표 셀이 바뀌면 기존 적별 flow 참조를 즉시 갱신합니다.

네비게이션 grid는 `wallsVersion + viewport + cell size + clearance bucket` 키의 bounded LRU로 보관합니다. flow field도 `grid key + goal cell` 키의 bounded LRU이며, cache hit 때 recency를 갱신합니다. flow field 생성의 open set은 선형 최소값 탐색이 아니라 재사용 indexed binary heap을 사용합니다.

flow field cache miss는 단일 backend 경계를 통과합니다.

- 셀 수가 1,024개 이상이면 WAT로 구현한 single-thread WASM 커널을 사용합니다. 작은 grid는 호출·복사 비용을 피하려고 기존 JS 기준 구현을 그대로 사용합니다.
- WASM 모듈 준비에 실패하거나 실행 중 trap/ABI 오류가 한 번이라도 발생하면, 해당 계산부터 JS로 복구하고 프로세스 수명 동안 재시도하지 않습니다. backend 상태에는 최초 실패의 `stage`, 오류 이름과 메시지를 남깁니다.
- WASM linear memory의 결과는 새 typed array로 복사한 뒤 캐시에 넣습니다. 이후 memory growth가 이미 반환한 field를 바꾸지 않습니다.
- 기존 `buildFlowField()` JS 함수는 삭제하거나 축약하지 않습니다. 동일성 oracle이자 capability가 없는 런타임의 정상 backend입니다.

### 2.5 flow field 동일성 계약

WASM 결과는 근사치가 아니라 `integration:Float32Array`, `dirX:Float32Array`, `dirY:Float32Array`, `goalIndex`의 완전 동일을 요구합니다. 부동소수점 배열도 허용 오차가 아닌 원시 바이트로 비교합니다.

- 폭·높이 1~3의 모든 조합에서 모든 blocked mask와 모든 goal을 조합한 5,506개를 전수 검사합니다.
- blocked goal, 도달 불가, corner cutting 금지, heap 동률/decrease-key, 단일 행·열, 4,096을 넘는 축(4,097×2/2×4,097), 49,601셀 대형 grid, 결정적 무작위 밀도를 별도 검사합니다.
- 잘못된 차원·길이·goal·크기 불일치와 memory growth 뒤 재호출도 별도 계약으로 검사합니다.
- `npm run test:wasm:flow-field:stress`는 고정 seed 1,000건·3,824,454셀을 추가 비교하고, 1×1/32×32/257×193에서 ABI padding·guard tail·입력 plane 불변성을 검사합니다.
- 배포 NW.js 0.108.0에서도 3×3 전수 4,608개와 49,601셀 대형 1개를 동일한 원시 바이트 기준으로 확인합니다.
- 같은 배포 런타임의 production backend에서 1,023셀은 JS, 1,024셀은 WASM으로 dispatch되는지 확인합니다. 두 clean process 측정에서 32×32 p50은 2.11배, 실게임 최소 viewport 대표 80×45 p50은 1.95배였고 각 warmup 결과와 각 측정 sample의 마지막 결과도 byte exact였습니다.
- WAT는 잠금된 `wabt@1.0.39`로 재빌드하며, 생성된 byte module이 저장소 artifact와 다르면 검사를 실패시킵니다.

## 3. 정책 ID

적 타입마다 pathfinding을 완전히 분리하지 않고, 같은 navigation 시스템 위에 정책 ID를 얹습니다.

| 정책 | 사용 대상 | 의미 |
| --- | --- | --- |
| `chase` | 사각형, 삼각형, 팔각형, 합체 육각형 | 기본 추적 |
| `charge_chase` | 화살표 | 추적 중 주기적 돌진 |
| `keep_range` | 마름모, 생산자 | 일정 거리 유지와 접선 순환 |
| `cluster_join` | 육각형 | 주변 육각형 밀도가 높은 셀로 합류 |
| `ally_density_seek` | 오각형 | 주변 적 밀도가 높은 셀 우선 |
| `formation_follow` | 예약 | 대형 유지용 |

## 4. 메인 스레드 실행 원칙

- `ObjectSystem.fixedUpdate()`가 AI decision group, 이동 적분, 충돌, 피격/사망, spawn/despawn 흐름을 직접 실행합니다.
- AI는 enemy 객체의 현재 상태를 읽고 최종 `acc`, `accSpeed`, `_enemyAIState`를 갱신합니다.
- 비용이 큰 flow field와 policy target 계산은 같은 fixed tick의 공유 Map cache를 우선 사용합니다. 이 decision 공유 Map은 fixed tick 시작마다 비웁니다. Direct path는 공유 문자열 Map 대신 버전별 wall bounds와 적별 exact 숫자 캐시를 사용합니다.
- 전체 적 density field는 공간 인덱스가 같은 tick에 이미 채운 `Uint16Array`를 공유합니다. 매 tick 새 배열을 만들지 않고 이전에 touched된 셀만 초기화합니다.
- WASM은 cache miss의 순수 flow field precompute만 담당합니다. 적 상태, fixed-step 순서, cache 권한과 최종 steering 적용은 계속 메인 스레드 JS가 소유합니다.
- 상태 권한이 메인 스레드에 있으므로 별도 authority 복제나 intent merge 경로를 두지 않습니다.

## 5. 다음 작업 기준

현재 권장 순서는 아래와 같습니다.

1. production flow-field backend의 WASM/JS 호출 수와 cache miss 비용 계측
2. `enemyAI` hot path 추가 최적화
3. 정책별 세부 튜닝값 정리
4. decision group과 공유 캐시 효율 검증

비싼 계산은 병렬화보다 캐시 적중률, 데이터 접근 패턴, 정책별 계산 빈도부터 줄이는 방향을 우선합니다.

충돌과의 실행 순서는 [`collision_pipeline_guide.md`](./collision_pipeline_guide.md), 전체 fixed step은 [`../core_architecture_guide.md`](../core_architecture_guide.md)를 확인합니다.
