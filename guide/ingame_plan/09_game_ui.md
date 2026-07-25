# 09. Game UI System

## 1. 기존 UISystem과의 관계

기존 전역 `UISystem`은 다음 기반 서비스를 계속 제공한다.

- UI primitive와 pool
- LayoutHandler
- cursor
- language
- tooltip
- typography/component style token

새 `GameUISystem`은 GameSystem이 소유하는 scene-scoped presentation이다.

```text
GameUISystem
→ global UISystem에 scope 등록
→ GameView snapshot 구독
→ semantic UI command 발행
→ destroy 시 scope 전체 해제
```

둘을 같은 singleton으로 합치지 않는다.

## 2. 구조

```text
GameUISystem
├─ GameViewModelBuilder
├─ HUDPresenter
├─ SkillBarPresenter
├─ WavePresenter
├─ LaneRiskPresenter
├─ ShopPresenter
├─ SentenceBoardPresenter
├─ PausePresenter
├─ SaveStatusPresenter
└─ ResultPresenter
```

## 3. 읽기 모델

UI는 다음 snapshot만 읽는다.

```text
GameView
├─ revision
├─ phase
├─ coreView
├─ waveView
├─ economyView
├─ skillSlotsView
├─ laneRiskView
├─ shopView
├─ checkpointView
└─ notifications
```

snapshot에는 live entity, Map, Set, 함수가 없어야 한다. 대규모 entity 표시는
별도 render view를 사용하고 UI view에 배열 전체를 복제하지 않는다.

## 4. HUD 우선순위

항상 표시:

1. Core Integrity
2. 웨이브 상태와 잔여 위협
3. 5개 SkillSlot 상태와 cooldown
4. Gold
5. 위험 Lane

조건부:

- 보스 상태
- 목표/특수 규칙
- entity cap suppression
- 저장 중/실패

Tower HP bar, Tower Down, Reboot timer는 만들지 않는다.

## 5. SkillSlot view

```text
EMPTY
INVALID_SENTENCE
READY
NO_SUBJECT
ON_COOLDOWN
BLOCKED_BY_CONTROL_STATE
BLOCKED_BY_PHASE
BLOCKED_BY_GLOBAL_RULE
```

`BLOCKED_BY_CONTROL_STATE`는 stun/transition/UI focus 같은 사유만 나타내며 HP나
Down 상태를 의미하지 않는다.

## 6. 상점

웨이브 완료 후 순서:

```text
정산 표시
→ 저장 중 indicator
→ CheckpointCommitted
→ 상점 controls 활성화
```

저장 실패:

```text
SAVE_ERROR panel
├─ 다시 저장
├─ 진단 정보 보기
└─ 타이틀로 이동
```

타이틀 이동은 메모리 상태를 성공 저장한 것처럼 표시하지 않는다. 사용자가 저장
없이 나가면 마지막 성공 checkpoint에서 재개된다는 사실을 명확히 알린다.

구매 중:

- 해당 command가 commit될 때까지 관련 control 잠금
- Gold는 optimistic 표시하지 않음
- 실패 시 기존 view 유지와 error code 표시
- transaction ID를 UI가 생성하지 않고 command builder가 생성

## 7. 문장 편집

- 상점 phase에서 전체 편집 가능
- 전투 중 status overlay는 읽기 전용
- tentative edit와 committed sentence를 시각적으로 구분
- compiler error code를 현지화
- estimator가 만든 수치만 preview
- drag/drop은 pointer capture 계약 준수

## 8. 입력

GameUISystem 또는 panel presenter가 `IPlayerControllable`을 구현한다.

우선순위:

```text
SAVE_ERROR / MODAL
→ PAUSE
→ SHOP / SENTENCE_EDITOR
→ STATUS_OVERLAY
→ GAMEPLAY
```

상위 panel에서 소비한 pointer/confirm action은 Tower로 전달하지 않는다.

## 9. 시간축

- HUD binding과 UI animation은 frame/unscaled time을 사용한다.
- cooldown 표시값은 fixed simulation snapshot을 읽는다.
- pause/shop에서도 UI animation과 입력은 계속된다.
- checkpoint 저장 duration은 wall-clock 진단값일 수 있지만 gameplay timer가 아니다.

## 10. 렌더 레이어

- world object/effect는 기존 WebGL 레이어
- damage text는 `texteffect`
- gameplay HUD는 `ui`
- modal/shop/pause는 overlay surface
- 저장 실패와 fatal resume 오류는 overlay 위 `top` 사용 가능
- tooltip/cursor는 global UISystem의 기존 최상위 계약 유지

## 11. resize

- viewport와 layout metrics만 다시 계산한다.
- WorldRegistry, GameState, WaveDirector, ShopSession을 reset하지 않는다.
- drag/pointer capture는 새 좌표로 갱신하거나 명시적으로 cancel한다.
- 의미 기반 typography/spacing token을 사용한다.
- 위치·크기·간격·선 두께·모서리 반경·effect 범위에 고정 픽셀을 사용하지
  않는다. `WW/WH/OW/OH`, anchor와 부모 비율로 계산한다.
- 캔버스 backing store와 DPR 값은 저수준 adapter 밖으로 UI 설계 수치로
  전달하지 않는다.

## 12. Continue 화면

표시:

```text
campaign/map
완료한 wave
다음 wave
Core Integrity
Gold
저장 시각
checkpoint version
```

손상:

- primary 손상 후 backup 복구 여부 표시
- 둘 다 실패하면 새 런으로 자동 덮어쓰지 않음
- 진단 export/손상 파일 보존/새 런 시작 선택 제공

## 13. 테스트 계약

- HUD에 Tower HP 관련 요소가 없다.
- GameView를 변경해도 GameState가 바뀌지 않는다.
- 상점은 CheckpointCommitted 이전에 클릭할 수 없다.
- 구매 저장 실패 시 Gold/offer 화면이 마지막 committed revision과 일치한다.
- resize 뒤 웨이브·상점 상태가 보존된다.
- 2560×1440과 다른 해상도에서 HUD와 panel의 상대 크기·anchor가 유지된다.
- locale 변경이 command ID나 ability 결과를 바꾸지 않는다.
- overlay 클릭이 gameplay skill을 발생시키지 않는다.
