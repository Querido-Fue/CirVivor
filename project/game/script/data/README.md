# Data Directory

`data/`에는 실행 코드와 독립적으로 읽을 수 있는 선언형 게임 데이터만 둡니다.

## 포함 범위

- 설정 항목 정의와 기본값
- 진행도·인게임 저장 기본값
- 맵·적 type처럼 실행 계약과 독립적인 콘텐츠 catalog
- 적 능력치·충돌 크기·AI profile 같은 게임 밸런스
- Tower 이동·물리 수치와 Core Integrity 같은 인게임 entity 밸런스
- 테마별 색상 토큰과 선택 옵션
- 언어별 번역 pack
- 이미지·오디오·외부 링크 같은 리소스 메타데이터

레이아웃, 타이포그래피, 렌더링, 애니메이션, 입력 매핑, 프로토콜, 풀/버퍼 크기, 알고리즘 상수, SVG 템플릿과 실행 함수는 실제 동작을 소유한 `module/` 또는 `util/` 코드에 둡니다.

## 접근 방식

중앙 registry나 문자열 기반 조회 함수를 사용하지 않습니다. 소비자는 필요한 파일에서 export를 직접 named import합니다.

```js
import { GAME_MAP_DATA } from 'data/scene/game/game_map_data.js';
import { SETTING_DEFINITIONS } from 'data/settings/setting_definitions.js';
```

`data/` 파일은 DOM/Canvas, mutable system, scene, runtime owner를 import하지 않습니다. 데이터 조합을
위한 `data/` 간 import와 부작용 없는 `module/ingame/contract/` normalizer·stable vocabulary import는
허용합니다. Lookup, migration, fallback, GPU packing과 런타임 적용은 실행 코드가 담당합니다.

적의 부작용 없는 숫자 path descriptor와 aspect/height 배율은
`object/enemy/enemy_shape_geometry_data.js`가 소유합니다. SVG path 문자열과 GPU
analytic mask는 이 선언 데이터를 각각 변환하며 별도 좌표 사본을 두지 않습니다.

O의 profile/data authority는 `basic_octa_enemy_data.js`와 profile catalog에 있습니다. Tower 반지름 × 12,
각속도, 60Hz 계약, 8슬롯 분산 순서, 무게, 고정 피해 감소량, 3/8 장갑 면 인덱스는 데이터가 소유합니다.
GPU Q32/fixed-point 인코딩, 접근·포획 상태 전이, 서쪽 기준 슬롯 위상 매핑, 슬롯 lifecycle, facing,
contact 분류와 rendering은 module이 소유합니다. 이 정의를 wave에 authoring하려면 exact Tower 주위의
반지름 6 슬롯 8개가 모두 walkable/SDF-clear여야 합니다. 현재 corridor wave는 이 조건을 충족하지
않으므로 O를 포함하지 않으며, 그 map enablement는 Turn 9 acceptance 전까지 금지됩니다.

Wave spawn group은 호환 fallback인 단일 `enemyDefinitionId`를 항상 유지하고,
여러 archetype을 같은 phase/group에서 순환할 때 선택적으로 `enemyDefinitionIds`
배열을 함께 선언합니다. `WaveDirector`는 spawn index로 배열을 순환하므로 기존
phase/group 기반 command ID와 fixed-tick schedule은 바뀌지 않습니다.

## 폴더 안내

- `settings/`: 설정 정의와 기본값
- `save/`: 진행도·인게임 저장 초기값
- `object/enemy/`: 적 catalog와 게임플레이·AI 밸런스
- `object/tower/`: Tower 크기·이동·물리 밸런스. Tower HP 데이터는 두지 않음
- `object/core/`: Core 크기와 Integrity 기본값
- `scene/game/`: 맵 catalog, 방향 경로, 복수 적 진입 route와 실제 플레이 초기 데이터
- `scene/title/`: 타이틀 버전 메타데이터와 외부 링크
- `theme/`: 라이트/다크 테마 토큰과 선택 옵션
- `localization/`: 언어별 번역 pack
- `sound/`: 오디오 리소스 메타데이터

타이틀 메뉴의 action, layout slot, reveal 순서는 화면 동작과 함께 바뀌는 구현
계약이므로 `module/scene/title/menu/_title_menu_definitions.js`가 소유합니다.
사용되지 않던 Magic Bento와 `TitleImage` 구현은 제거되었으며 타이틀 데이터
영역으로 다시 두지 않습니다.

## 해상도 독립 단위

- 게임플레이 길이·속도·가속도는 렌더 픽셀이 아니라 타일 월드 단위를 사용한다.
- 신규 인게임에서 `1 실제 타일 = 1 월드 단위`이고 Tower 지름은 1타일이다.
- 길이 필드는 `_TILES`, 속도는 `_TILES_PER_SECOND`, 가속도는
  `_TILES_PER_SECOND_SQUARED`처럼 단위를 이름에 드러낸다.
- viewport 크기나 2560×1440 같은 표시 해상도를 balance data에 넣지 않는다.
  최종 표시 크기는 projection이 런타임에 계산한다.
