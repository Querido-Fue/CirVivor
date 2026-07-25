# 14. Open Decisions

이 문서의 항목은 기본 구조 구현을 막지 않도록 policy/data 경계로 격리한다.
확정되면 관련 세부 문서와 콘텐츠 Config를 함께 갱신한다.

## O-001 — 웨이브/맵 사이 Core 수리

상태: `OPEN`

후보:

- 수리 없음
- 웨이브마다 고정 수치
- 맵 전환마다 고정/비율
- Shop 서비스로 구매

임시 기본안: 자동 수리 없음. `ICoreRepairPolicy`로 격리한다.

## O-002 — Tower와 적 접촉 제어

상태: `OPEN`

후보:

- 위치 분리만
- 약한 knockback
- 짧은 stun
- 특수 적만 제어

임시 기본안: 위치 분리만. 어느 후보도 Tower HP를 추가하지 않는다.

## O-003 — Core 도달 적 행동

상태: `OPEN`

후보:

- 충돌 damage 후 제거
- attack point에서 주기 공격
- 적 archetype별 behavior

임시 기본안: 적 정의의 `CoreAttackBehavior`로 분리하고 일반 적은
`ATTACK_IN_PLACE`를 사용한다.

## O-004 — 마지막 웨이브 뒤 상점

상태: `OPEN`

후보:

- 상점 없이 맵/런 결과
- 마지막 정산 확인용 상점
- 다음 맵 준비 상점

임시 기본안: 다음 맵이 있으면 상점, 최종 런 웨이브면 결과 전이. checkpoint는
두 경우 모두 생성한다.

## O-005 — 전투 구조물의 웨이브 간 유지

상태: `OPEN`

구조물이 유지되면 checkpoint에 abstract placement와 내구도 저장이 필요하다.

임시 기본안: 모든 전투 entity와 구조물은 웨이브 settlement에서 제거한다.
Word/문장/경제 상태만 유지한다.

## O-006 — checkpoint 완료 archive

상태: `OPEN`

후보:

- 즉시 삭제
- 최근 완료 1개 보존
- debug build만 보존

임시 기본안: production은 account reward 저장 성공 뒤 clear, debug는 최근 1개
archive.

## O-007 — checkpoint 최대 크기

상태: `BASELINE`

임시 기본안: 4 MiB. 실제 최대 campaign/word/통계 데이터 측정 후 조정한다.

## O-008 — 저장 실패 후 타이틀 이동

상태: `BASELINE`

임시 기본안:

- retry 제공
- 저장 없이 나가기를 명시적으로 확인
- 마지막 성공 checkpoint에서 재개된다는 경고
- 손상/실패 진단 파일 보존

자동 성공 처리나 자동 새 런 덮어쓰기는 후보가 아니다.

## O-009 — 맵 수와 맵당 웨이브 수

상태: `OPEN`

배열 길이와 콘텐츠 ID로 결정한다. 코드와 checkpoint schema가 5맵/3웨이브를
가정하지 않는다.

## O-010 — Shop transaction 디스크 지연 UX

상태: `BASELINE`

내구성을 위해 성공 표시는 commit 뒤에 한다. 실제 저장 지연이 눈에 띄면:

- 작은 snapshot 최적화
- 직렬화 cache
- 저장 중 짧은 control lock

을 사용한다. durability를 낮추는 debounce는 구매 command에 사용하지 않는다.

## O-011 — Core Integrity 수치와 난이도 보정

상태: `OPEN`

구조는 `current/max`를 유지하되 초기 수치, 난이도별 배율, 상한은 콘텐츠
밸런스에서 정한다.

## O-012 — Flow Field dispatch threshold 재측정

상태: `BASELINE`

기존 1,024셀 기준을 보존하고 새 Path/Collider adapter 적용 후 같은 NW.js에서
재측정한다. 결과가 기존과 다르면 benchmark 근거와 함께 갱신한다.

