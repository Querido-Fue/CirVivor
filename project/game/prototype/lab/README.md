# CirVivor 입체 그래픽 프로토타입

Tower Lab의 비스듬한 카메라, 밝은 입체 타일, 단순한 기하 유닛을 참고한 독립 실험 화면입니다. 기존 `GameSystem`, `TileMap`, GPU 이동·충돌·웨이브·Tower 입력·발사를 그대로 사용합니다.

## 실행

저장소 루트 `C:\CirVivor`에서 실행합니다. 프로젝트에 포함된 Windows NW.js 런타임과 WebGPU 지원 GPU가 필요합니다.

```powershell
npm run prototype:lab
```

게임 창을 닫으면 런처가 임시 앱과 프로필을 정리합니다. 일반 브라우저에서 HTML을 직접 열면 공용 NW.js 모듈을 사용할 수 없습니다. 기존 게임 메뉴나 저장 파일을 변경하지 않는 별도 NW 앱으로 실행합니다.

## 조작과 확인 항목

| 조작 | 동작 |
| --- | --- |
| WASD / 방향키 | 기존 월드 X/Y축으로 Tower 이동 |
| 마우스 왼쪽 누르기 | 바닥의 청록색 커서를 향해 조준·연속 발사 |
| P / 일시정지 | 전투 정지·재개. 정지 중에도 시점 조절 가능 |
| 회전·기울기·확대 슬라이더 | 같은 물리 상태를 다른 시점에서 비교 |
| 생성 수 선택 → 다시 시작 | 120 / 1,000 / 10,000 총 생성 웨이브 실행 |
| 측정 결과 저장 | 최근 프레임 통계와 실제 fixed tick·활성 바디·오류 JSON 저장 |

우선 카메라 각도에 따른 경로 가독성, 적 세 형태의 구분, 바닥과 유닛의 가림, 조준 커서와 탄환 방향을 확인합니다. Tower와 Core HP는 시각 실험이 쉽게 종료되지 않도록 이 프로토타입에서만 높였습니다.

## 구현 경계

- `main.js`: 별도 NW 진입점, 실제 게임 의존성 주입과 60Hz 스케줄러, 입력·측정 UI. `LabBackend`는 기존 backend의 `draw()`만 교체합니다.
- `lab_camera.js`: GPU 투영과 바닥 평면 역투영. 입력을 기존 카메라 좌표로 변환한 뒤 기존 게임 입력에 전달합니다.
- `lab_geometry.js`, `lab_shaders.js`, `lab_renderer.js`: 실제 게임의 `script/module/ingame/render/ceramic_*` 구현을 공유하는 얇은 진입점입니다. 깊이 버퍼, 방향광, 접지 그림자, 4× MSAA, 기존 GPU VFX를 제공합니다. 실험실에서만 renderer가 frame을 시작·제출합니다.
- `script/data/scene/game/lab_prototype_data.js`: 별도 맵과 세 형태의 웨이브. 실제 게임 맵 registry에는 등록하지 않습니다.
- production의 `collision_render.js`에서 공통 `resolve_body_render_vertex()`를 분리했습니다. 기존 평면 렌더와 프로토타입이 같은 생존 여부·보간·방향·반지름을 사용합니다. 기존 GPU ABI와 물리 패스는 유지됩니다.

프레임마다 전체 body 위치를 CPU로 복사하지 않습니다. QA의 이동 검증은 게임이 이미 제공하는 bounded camera-follow 요약만 사용합니다.

## 검증

```powershell
# 좌표 왕복, 실제 맵 geometry, 세 부하의 production wave compile
node --experimental-vm-modules --test test/lab_prototype.test.mjs

# 실제 NW/WebGPU 통합 검증 + PNG/JSON, 완료 후 자동 종료
npm run prototype:lab -- --qa

# 실제 타이틀→게임 시작, 입력·줌·리사이즈·월드 재생성·씬 전환 검증
npm run test:ceramic:nw

# 전체 계약 테스트
npm test

# 기존 렌더 승인 이미지와 비교. golden을 갱신하지 않음
node test/support/run_nw_render_pipeline_golden.mjs --check
```

자동 검증은 실제 fixed tick, 일시정지·재개, 카메라 변경, 이동, 조준 좌표, 실제 탄환 발사 commit, 리사이즈, 1,000 총 생성 웨이브 재시작을 확인합니다. PNG와 `qa.json`은 콘솔에 표시된 OS 임시 디렉터리에 남습니다. 입력 검증은 자동 이벤트/테스트 입력으로 수행하며 수동 플레이 검증과 구분합니다.

## 현재 범위와 측정 해석

- production `GameScene`에도 같은 그래픽을 기본 적용했습니다. 실험실은 카메라 비교와 부하 확인용으로 유지하며, 실제 게임의 HUD·Shop·문장 편집 UI는 실제 진입점에 있습니다.
- 공유 렌더는 canonical SDF 형태, Ring 구멍, Formation 점유 셀·체력 표시, Octagon 방어 방향, Arrow 예고 색, Boost/Pulse와 기존 transient VFX를 사용합니다. 실험실 기본 웨이브는 사각·삼각·화살표 세 종류로 유지합니다.
- Core와 입구는 정적인 메시이며 Core 색은 integrity를 반영합니다. 실제 그림자 맵, SSAO, bloom은 사용하지 않습니다.
- 조준은 바닥 평면 기준입니다. 유닛의 윗면을 직접 선택하는 3D picking은 구현하지 않았습니다.
- **총 생성 수는 동시 생존 수가 아닙니다.** 10,000 설정은 장시간 순차 생성이며 10,000 동시 바디 성능을 증명하지 않습니다.
- 첫 실행 시 공용 GPU 파이프라인 컴파일로 수초의 지연이 발생할 수 있습니다. `frameClampLossSeconds`에 이를 기록합니다. 최근 300프레임 p95는 초기 로딩 비용을 대표하지 않습니다.
- 해상도, GPU, 창의 가림/포커스, 초기 컴파일 여부가 수치에 영향을 줍니다. 정식 성능 평가는 동일 조건의 기존 렌더와 A/B 비교가 추가로 필요합니다.
- 일시적인 telemetry backpressure는 기존 규약대로 재시도합니다. 치명적인 GPU 오류는 화면과 진단에 표시하고 정지하며, production의 자동 device-loss 복구 UI는 이 실험에 포함하지 않습니다.
