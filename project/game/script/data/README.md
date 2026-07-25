# Data Directory

`data/`에는 실행 코드와 독립적으로 읽을 수 있는 선언형 게임 데이터만 둡니다.

## 포함 범위

- 설정 항목 정의와 기본값
- 진행도·인게임 저장 기본값
- 맵·적 type처럼 실행 계약과 독립적인 콘텐츠 catalog
- 적 능력치·충돌 크기·AI profile 같은 게임 밸런스
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

`data/` 파일은 `module/`을 import하지 않습니다. 데이터 조합을 위한 `data/` 간 import는 허용하지만 lookup, coercion, migration, fallback과 런타임 적용은 코드 모듈이 담당합니다.

## 폴더 안내

- `settings/`: 설정 정의와 기본값
- `save/`: 진행도·인게임 저장 초기값
- `object/enemy/`: 적 catalog와 게임플레이·AI 밸런스
- `scene/game/`: 맵 catalog와 실제 플레이 초기 데이터
- `scene/title/`: 타이틀 버전 메타데이터와 외부 링크
- `theme/`: 라이트/다크 테마 토큰과 선택 옵션
- `localization/`: 언어별 번역 pack
- `sound/`: 오디오 리소스 메타데이터

타이틀 메뉴의 action, layout slot, reveal 순서는 화면 동작과 함께 바뀌는 구현
계약이므로 `module/scene/title/menu/_title_menu_definitions.js`가 소유합니다.
사용되지 않던 Magic Bento와 `TitleImage` 구현은 제거되었으며 타이틀 데이터
영역으로 다시 두지 않습니다.
