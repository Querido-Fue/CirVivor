# 04. Input and Player Control

## 1. 목표

- Tower, 상점 카드, 문장 슬롯, pause UI가 같은 의미 기반 입력 체계를 사용한다.
- UI 뒤의 Tower가 같은 클릭을 동시에 처리하지 않는다.
- 가변 프레임 입력을 fixed tick command로 안정적으로 변환한다.
- 키 리바인딩이 SkillSlot 의미와 저장 데이터를 바꾸지 않는다.
- 어떤 요소도 DOM/Keyboard/Mouse singleton을 직접 polling하지 않는다.

## 2. 명칭

공개 계약명은 `IPlayerControllable`을 사용한다.

`PlayerControllerable`이라는 기존 명칭이 외부 요구로 필요하면 다음처럼 alias만
제공하고 구현 계약은 하나로 유지한다.

```text
PlayerControllerable = IPlayerControllable
```

## 3. 원시 입력과 Action 분리

```text
Keyboard/Mouse/Gamepad
→ RawInputSnapshot
→ InputBindingMap
→ PlayerAction[]
→ PlayerControlRouter
→ IPlayerControllable
→ UICommand 또는 GameCommand
```

권장 action:

```text
SYSTEM_PAUSE
SYSTEM_BACK
MOVE_VECTOR
AIM_POINT
USE_SKILL_LMB
USE_SKILL_SHIFT
USE_SKILL_SPACE
USE_SKILL_Q
USE_SKILL_E
UI_NAVIGATE
UI_CONFIRM
UI_CANCEL
UI_POINTER_MOVE
UI_POINTER_PRIMARY
UI_SCROLL
OPEN_STATUS
```

`KeyW`, `MouseLeft` 같은 물리 입력은 action payload 밖으로 누출하지 않는다.

## 4. IPlayerControllable

```javascript
/**
 * @typedef {object} IPlayerControllable
 * @property {string} controlTargetId
 * @property {() => string} getControlContext
 * @property {() => number} getInputPriority
 * @property {() => boolean} isControlEnabled
 * @property {(action: PlayerAction, context: ControlContext) => InputDisposition}
 *     handlePlayerAction
 */
```

반환값:

```text
PASS      이 대상은 처리하지 않았으며 아래 대상으로 전달 가능
HANDLED   처리했지만 병렬 전달을 허용
CONSUMED  처리했고 같은 action의 추가 전달 금지
```

대부분의 클릭·확정 action은 `CONSUMED`, 디버그 관찰 target은 `HANDLED`,
관심 없는 action은 `PASS`다.

## 5. Context stack

낮은 우선순위에서 높은 우선순위:

```text
GAMEPLAY
STATUS_OVERLAY
SHOP
MODAL
PAUSE_MENU
SYSTEM
```

활성 stack의 최상단 context부터 순회한다. 같은 context 안에서는
`inputPriority DESC`, 등록 sequence ASC로 결정해 결과를 재현할 수 있게 한다.

예:

```text
SHOP 활성
→ 상점 카드가 UI_POINTER_PRIMARY 소비
→ Tower의 USE_SKILL_LMB 생성 금지

PAUSE_MENU 활성
→ SYSTEM_PAUSE 또는 UI_CANCEL만 메뉴가 소비
→ MOVE_VECTOR는 gameplay buffer에 기록하지 않음
```

## 6. Tower controller

Tower는 HP가 없지만 다음 control state는 가진다.

```text
ACTIVE
STUNNED
TRANSITIONING
UI_BLOCKED
PAUSED
```

Tower controllable의 책임:

- 이동 action을 정규화한 `MoveIntent`로 변환
- aim point를 `AimIntent`로 변환
- SkillSlot action을 `UseSkillCommand`로 변환
- 현재 control state에 따라 명시적 거절 결과 반환

Tower entity를 직접 이동시키거나 WordSystem을 직접 호출하지 않는다.

현재 이동 연결 규칙:

```text
MOVE_VECTOR
→ TowerPlayerController가 MoveIntent 기록
→ fixed tick에서 TheTower가 control acceleration 생성
→ IPhysicsBody2D.addAcceleration
→ PhysicsBody2D.integrate
```

- 키를 놓은 0 벡터는 velocity를 0으로 덮어쓰지 않는다.
- 입력이 사라지면 새 control acceleration만 중단하고 물리 바디의 선형 마찰로
  감속·정지한다.
- 스킬 반동과 충돌 반응은 입력 action을 위조하지 않고
  `IPhysicsBody2D.applyImpulse()`를 사용한다.
- Controller는 물리 위치, 속도, 마찰 계수를 직접 변경하지 않는다.

## 7. 가변 프레임에서 fixed tick으로

연속 상태:

- 이동 벡터와 aim point는 최신 snapshot을 보관한다.
- fixed tick 시작 시 한 번 복사한다.
- 한 fixed tick 동안 같은 snapshot을 사용한다.
- 이동 snapshot은 가속도 생성에만 사용하며 현재 속도는 물리 바디가 소유한다.

edge 상태:

- 스킬, pause, confirm은 sequence를 가진 FIFO다.
- 생성 프레임과 목표 fixed tick을 기록한다.
- 같은 action의 브라우저 key repeat는 binding 정책에서 제거한다.

고정 처리 순서:

```text
SYSTEM_PAUSE
→ MOVE_VECTOR snapshot
→ AIM_POINT snapshot
→ LMB
→ SHIFT
→ SPACE
→ Q
→ E
```

## 8. UI controllable

게임 UI 요소가 직접 인터페이스를 구현하거나 presenter가 여러 요소를 대표할 수
있다. 개별 버튼 수천 개를 router에 등록하기보다 panel 단위 hit testing 후
내부 요소로 전달하는 방식을 우선한다.

필수 사례:

- Shop 카드 구매
- reroll/upgrade
- 문장 타일 drag/drop
- 저장 실패 재시도
- pause 메뉴
- Continue 선택

UI command는 `expectedStateRevision`을 포함해 오래된 화면에서 발생한 구매를
거절할 수 있어야 한다.

## 9. Focus와 pointer capture

- drag 시작 target이 pointer capture token을 획득한다.
- release/cancel/scene destroy에서 반드시 반환한다.
- modal이 열리면 기존 hover와 press edge를 초기화한다.
- 창 비활성화는 현재 InputSystem의 reset 정책과 연결한다.
- resize는 pointer 좌표를 다시 투영하지만 command나 월드를 초기화하지 않는다.

## 10. 접근성

- SkillSlot과 실제 키 binding을 분리한다.
- hold repeat는 cooldown event에 맞춰 한 번씩만 command를 만든다.
- 모든 skill slot hold 허용 여부를 설정할 수 있다.
- UI 탐색은 pointer 없이도 동일 command를 생성할 수 있게 한다.
- 색상만으로 focus/disabled/save-error를 구분하지 않는다.

## 11. 테스트 계약

- SHOP 클릭이 Tower LMB 스킬을 발생시키지 않는다.
- 같은 frame의 5개 skill edge가 고정 순서로 처리된다.
- fixed catch-up 2회에도 edge command가 중복 실행되지 않는다.
- pause 중 movement snapshot이 복귀 첫 tick에 남지 않는다.
- drag 중 modal/resize/destroy가 발생해도 capture가 누수되지 않는다.
- stale shop revision command가 Gold를 바꾸지 않는다.
- Tower가 `IDamageable`을 구현하지 않아도 모든 control action이 동작한다.
- 키 입력 유지 시 속도가 가속되고, 키 해제 시 마찰을 거쳐 정지한다.
- 반동 impulse와 control acceleration이 같은 fixed 물리 상태에 결정적으로 합성된다.
