# 00. Authority, Decisions, and Scope

## 1. 문서 권한

이 문서는 인게임 재설계에서 충돌을 해소하는 기준이다. 기존
`guide/game structure/`는 제품 비전, 단어 콘텐츠, 맵 아이디어의 참고 자료로
계속 사용하되 아래 확정 결정과 충돌하는 항목은 이 문서가 우선한다.

## 2. 확정 결정

### A-001 — Tower는 체력이 없다

상태: `LOCKED`

- Tower에는 `Health`, `HP`, `Damageable`, `Downed`, `Dead`, `Rebooting`
  컴포넌트나 상태를 두지 않는다.
- Tower는 피해 대상이 아니며 회복 대상도 아니다.
- Tower를 향한 적 행동이 필요하면 밀침, 위치 방해, 짧은 행동 제어처럼
  체력과 무관한 상호작용으로 명시한다.
- 기본 패배 조건은 Core Integrity 소진이다.
- Tower의 `Power`, 이동, 조준, 쿨다운, 일시 상태는 유지할 수 있다.
- `Tower Health 회복`, `Tower Down`, `towerReboot` 관련 콘텐츠와 Config는
  신규 구현에서 제거한다.

### A-002 — 기존 play 구현은 호환 대상이 아니다

상태: `LOCKED`

- 현재 `GameScene`, Player, Wall, Projectile, benchmark command는 실제 게임
  규칙보다 placeholder와 성능 실험 성격이 강하다.
- 새 구조가 안정화되기 전까지만 characterization fixture로 사용한다.
- 기존 공개 메서드와 데이터 형태를 유지하기 위해 새 도메인 모델을 왜곡하지 않는다.
- 삭제는 새 수직 슬라이스와 회귀 테스트가 통과한 뒤 수행한다.

### A-003 — 기술 커널은 증거를 기준으로 보존한다

상태: `LOCKED`

우선 보존 후보:

- 1/60초 fixed-step과 렌더 보간 원칙
- Canvas 2D/WebGL 레이어와 batch renderer
- 오브젝트 풀의 재사용·상한·계측 패턴
- 충돌 broad phase/SoA/narrow phase/solve 파이프라인
- WASM hexa contact backend와 JS fallback
- WASM Flow Field backend와 byte-exact JS oracle
- SimulationRuntime snapshot 개념
- release simulation profiler와 benchmark 도구

보존 조건:

1. 새 인터페이스 뒤에 격리할 수 있다.
2. 기존 parity/성능 테스트를 유지할 수 있다.
3. 새 Core/Path/Word 규칙의 권한을 침범하지 않는다.
4. 풀 객체의 오래된 참조나 숨은 전역 상태를 새 월드로 누출하지 않는다.

### A-004 — 웨이브 완료마다 재개 체크포인트를 저장한다

상태: `LOCKED`

- 웨이브가 `Completed`가 된 사실만으로 저장하지 않는다.
- Gold 자동 회수, 웨이브 보상, 통계 확정, 다음 웨이브 포인터 계산,
  ShopSession 생성이 하나의 전이로 끝난 뒤 스냅숏을 만든다.
- 스냅숏이 `ingame.dat`에 안전하게 커밋되어야 상점 상호작용을 연다.
- 저장 실패 시 메모리 상태를 유지하고 명시적인 재시도/종료 선택을 제공한다.
- 전투 중 강제 종료는 마지막으로 커밋된 웨이브 경계에서 재개한다.

### A-005 — 상속보다 인터페이스 조합을 사용한다

상태: `LOCKED`

- `GameScene extends BaseScene`만 씬 상속으로 유지한다.
- `GameScene`은 `GameSystem`을 소유한다.
- 5개 하위 시스템은 `GameSystem`을 상속하지 않고
  `IGameSubsystem` 및 기능별 port를 구현한다.
- 엔티티는 거대한 공통 base class보다 capability component를 조합한다.
- JavaScript에서는 JSDoc 계약, 등록 시 검증, headless contract test를 함께 사용한다.

## 3. 기존 설계에서 폐기되는 결정

다음 개념은 더 이상 구현 대상으로 사용하지 않는다.

```text
Tower HealthMax / HealthCurrent
TowerDownPolicy
ITowerDownPolicy
Tower Reboot
rebootHealthRatio
towerHealPolicy
features.towerReboot
DisabledByTowerState 중 HP/Down 사유
```

기존 문서에서 위 항목이 남아 있더라도 신규 코드·Config·저장 스키마에는
추가하지 않는다. 제품 문서 정합성 정리는 구현 0단계의 필수 작업으로 추적한다.

## 4. 이번 재설계의 범위

포함:

- 실제 `GameScene`과 scene-scoped `GameSystem`
- Core, 런, 맵, 웨이브, 상점, 일시정지 상태 머신
- 오브젝트, 충돌, AI, 로그, 단어, 게임 UI 시스템
- PlayerControllable 기반 입력 라우팅
- Command/Event/View 경계
- 웨이브 경계 `ingame.dat` 저장과 이어하기
- placeholder에서 신규 구조로의 단계적 전환
- headless simulation, 저장 장애, WASM parity 검증

제외:

- 웨이브 도중 모든 적·투사체를 직렬화하는 mid-wave save
- 네트워크 동기화와 lockstep multiplayer
- 저장 파일 암호화나 치트 방지
- 기존 placeholder `ingame.dat`의 의미 없는 필드를 실제 런으로 추정 변환
- 미확정 최종 콘텐츠 수치와 전체 단어 catalog 제작

## 5. 보안·안전 경계

- 콘텐츠 데이터는 executor ID만 참조하고 문자열 `eval`이나 임의 경로 import를 하지 않는다.
- UI와 저장 payload는 엔진 객체, 함수, DOM, Canvas, WebGL 참조를 포함하지 않는다.
- 외부에 노출하는 상태는 복제된 snapshot 또는 읽기 전용 view다.
- Command payload는 type 존재만 보지 않고 명령별 schema와 현재 phase를 검증한다.
- 저장 checksum은 손상 탐지용이며 보안 서명으로 취급하지 않는다.
- 이벤트 저널, subject 수, 생성 수, 충돌 후보, 저장 대기열은 모두 상한을 가진다.

## 6. 완료 판단

이 계획의 구조 단계는 다음이 모두 가능할 때 완료다.

- Tower Health 없이 플레이·UI·저장·통계가 동작한다.
- Core 파괴가 한 번만 패배 전이를 발생시킨다.
- 웨이브 완료 후 프로세스를 종료하고 동일 Shop/Run 상태로 재개한다.
- 저장 중 각 파일 연산 단계에서 강제 실패해도 primary 또는 backup에서 복구한다.
- 새 GameSystem이 기존 ObjectSystem과 중복 tick하지 않는다.
- WASM 충돌·Flow Field 결과와 fallback 계약이 기존 테스트를 통과한다.

