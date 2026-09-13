# 게임 입체 렌더

일반 `GameScene`의 GPU 플레이 경로가 기본 사용합니다. 기존 맵, 웨이브, 전투, HUD와 화면 전환을 유지하면서 프로토타입의 세라믹 타일·기하 유닛·직교 카메라를 적용합니다.

## 소유권

- `CeramicEnemyBackend`: 기존 backend의 draw만 확장합니다. safe-wave 재생성과 scene destroy 시 렌더 자원을 해제합니다.
- `CeramicWorldRenderer`: Display가 이미 시작한 `WebGpuFrameComposer`에 월드 패스와 합성 패스를 기록합니다. prototype의 `ownsFrame: true`만 독립 frame을 시작·제출합니다.
- `WorldCamera2D.depthView`: GPU 투영, 바닥 조준 역변환, 기존 줌·Tower/Core 추종이 공유하는 카메라입니다.
- `data/theme/ceramic_world_visual_data.js`: 카메라 각도, 타일 간격·두께, 타일·유닛·Core·입구의 색상입니다.
- `ceramic_world_geometry.js`: 실제 `TileMap`으로부터 시작 시 생성하는 타일, 모든 입구, Core 메시입니다.

유닛은 원래 GPU 버퍼에서 생존·보간·반지름·방향을 읽습니다. canonical SDF를 높이 방향으로 확장하므로 Ring 구멍과 Formation 점유 형태를 유지합니다. 방향 방어·예고 색·Boost/Pulse도 같은 GPU 상태를 사용합니다. 기존 transient VFX ring을 읽기 전용으로 렌더하며 물리 ABI와 fixed compute는 변경하지 않습니다.

4× MSAA와 `depth24plus`를 사용합니다. terrain → contact shadow → body → VFX → composite의 최대 5 draw이며, body당 6 vertex와 최대 48 SDF ray steps를 사용합니다. 전체 위치를 CPU로 읽지 않습니다. 기존 평면 타일/Core 렌더는 depth 모드에서 생략하며 벤치마크는 기존 평면 경로를 유지합니다.

## 검증

저장소 루트에서 `npm test`와 `npm run test:ceramic:nw`를 실행합니다. NW 검사는 원래 HTML/App/Display와 타이틀의 게임 시작 경로를 격리된 임시 앱·프로필·저장 경로에서 실행합니다. 실제 이동/조준/발사/휠 입력, 창 크기 변경, GPU 월드 재생성, 벤치마크 전환과 재진입을 확인하고 PNG·JSON을 남깁니다. 프로토타입 비교는 `npm run prototype:lab`입니다.

조준은 바닥 평면을 기준으로 합니다. 그림자는 접지 표현이며 shadow map·SSAO·bloom은 사용하지 않습니다. 대량 동시 생존 부하의 정식 A/B 성능 비교는 별도입니다.
