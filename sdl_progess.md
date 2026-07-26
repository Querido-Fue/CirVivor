# SDL3 전환 진행 상황

> 마지막 갱신: 2026-07-27
> 기준 브랜치: `codex/c++`
> 목표: 기존 NW.js 게임을 기준 실행기로 보존하면서 C++20 Game Core와 SDL3 플랫폼·렌더 계층으로 단계적으로 전환한다.

## 현재 요약

- 상태: Phase 0~3 완료, Phase 4 simulation parity와 Phase 5 UI oracle 고정을 병행 중
- SDL 기준 버전: 공식 최신 안정 릴리스 `3.4.10`
- 기존 JS 테스트: 433/433 통과
- 기존 WAT/WASM 재현성: flow-field 및 collision-contact 통과
- 기존 Windows NW.js 렌더 골든: 10개 surface, 3개 case 통과
- 네이티브 빌드 도구: Visual Studio 2026 C++ workload/MSVC 19.51/Windows SDK/CMake/Ninja 및 사용자 범위 GCC 16.1.0 설치 완료
- 네이티브 검증: MSVC Debug·Release CTest 각 17/17, GCC headless 12/12, 실제 Windows 세 backend·복구와 dummy 자동 폴백/재복구 통과
- Desktop 정상 실행: SDL 의미 입력→짧은 입력 latch→60Hz `GameSystem`→94-command playable `FramePacket` 연결 및 Computer Use 실기 이동 확인
- 기존판 UI oracle: Computer Use로 로딩 이후 타이틀과 factory 8종·종료·외부 링크 경고·디버그 등 도달 가능한 오버레이를 직접 열어 시각·중첩·입력 상태 확인, 21개 결정적 시나리오 계약 고정
- 네이티브 text 기반: 고정 Brotli→FreeType WOFF2→HarfBuzz hb-ft 그래프, 원본 Pretendard/OFL hash 검증, 한국어·라틴 canonical shaping 통과
- Software 960×540 성능 게이트: Release 180-frame render p95 24.456ms, 33.33ms 예산 통과
- 기존 NW.js 실행 경로: 포팅 parity를 위한 read-only oracle로 유지

## 단계별 상태

| 단계 | 상태 | 완료 기준 |
| --- | --- | --- |
| Phase 0 — 기준선 동결 | 완료 | 통합 기준선, replay/state hash, 현재 구현 범위의 800-body stress, CI 고정 완료 |
| Phase 1 — C++/CMake/headless | 완료 | `game_core`, `game_headless`, `game_tests` 빌드 및 CTest 통과 |
| Phase 2 — SDL3 Desktop 셸 | 완료 | callback·창·이벤트·lifecycle·scheduler·storage·audio를 실제/dummy driver에서 검증 |
| Phase 3 — FramePacket/기본 렌더 백엔드 | 완료 | 세 backend 실제 command drawing·fallback·reset/pacing과 Software 960×540 Release p95 30fps 게이트 통과 |
| Phase 4 — Simulation parity | 진행 중 | Body SoA·타일 충돌·GameSystem replay, 두 WAT scalar, 첫 solve spatial grid/candidate와 generic narrowphase exact parity 및 Desktop playable session bridge 통과. position solve/projectile 진행 중 |
| Phase 5~8 — 효과·세션·UI·저장 | 진행 중(UI oracle) | playable vertical slice, 기존에 실제 존재하는 타이틀·전체 도달 가능 오버레이의 시각·입력·상태 전이 parity와 세 품질 경로 완료. 기존판에 없는 HUD·일시정지·게임오버는 별도 설계로 구분 |
| Phase 9 — Android | 준비 중 | 사용자 범위 SDK/NDK 설치, ARM64 빌드, Vulkan→GLES→Software 폴백, lifecycle 검증 |
| Phase 10 — iOS | 현재 범위 제외 | Mac 환경이 없어 사용자 요청에 따라 건너뛴다. 코드 경계는 훼손하지 않되 빌드·서명·실기 완료로 표시하지 않는다. |
| Phase 11~12 — 멀티코어·Cutover | 대기 | worker parity, native-only release candidate, NW.js 제품 경로 제거 |

## 확정한 기술 결정

1. SDL `3.4.12`는 아직 공식 릴리스가 아니므로 첫 고정 버전은 `3.4.10`으로 교정한다.
2. `core/`와 `game_core`에는 SDL 헤더·handle·파일 경로 타입을 노출하지 않는다.
3. 현재 JavaScript/NW.js 구현은 즉시 제거하지 않고 replay와 렌더 골든의 기준 실행기로 유지한다.
4. 현재 과부하 시 fixed debt를 버리는 scheduler 계약을 먼저 parity로 고정하고, wall-clock authoritative 60Hz 정책 변경은 별도 승인·측정 단계로 분리한다.
5. 레거시 전역 `ObjectSystem`을 그대로 C++에 복제하지 않고 세션 `GameSystem` 방향으로 이식한다.
6. 렌더 API와 품질 프로필을 분리한다. 최종 목표는 SDL_GPU, Android GLES 폴백, CPU Software 백엔드와 Full/Reduced/Software 효과 프로필이다.
7. iOS 실제 빌드·서명·device 검증은 macOS CI 또는 별도 Mac 환경에서 수행한다.
8. Desktop metadata와 향후 Android application ID는 Java 식별자에 사용할 수 없는 GitHub 조직명의 하이픈을 제거한 `io.github.queridofue.cirvivor`로 통일한다.
9. backend 후보마다 숨김 창을 새로 만든다. `neutral → SDL_GPU`, 별도 `SDL_WINDOW_OPENGL → GLES`, 다시 `neutral → Software` 순서로 자원을 독점하고, GLES는 ES3 창 실패 시 ES2 속성으로 창 자체를 재생성한다.
10. authoritative 지수 적분은 플랫폼 CRT `exp()`를 직접 사용하지 않고 V8 12.4/fdlibm 호환 `deterministicExp()`를 사용한다. Windows CRT와 V8의 1 ULP 차이가 tick hash를 깨뜨리기 때문이다.
11. renderer target reset은 backend의 target 재구성으로 처리하고, device reset/lost는 backend와 후보용 창을 완전히 재생성한다. 복구 실패 시 다음 backend로 내려간다.
12. backend가 present 동기화를 명시적으로 보장하지 않는 동안 main callback을 GPU/GLES 60Hz, Software 30Hz로 제한해 VSync 협상 실패 busy-loop를 막는다.

## 발견한 주요 위험

- 현재 플레이 `GameSystem`은 Tower 이동·카메라 중심의 최소 구현이며 전투·웨이브·HUD·체크포인트는 아직 미완성이다.
- 현재 저장은 Node `fs.promises`와 `process.cwd()/save`에 결합돼 있고 journal/checksum/원자 교체가 없다.
- DOM/Canvas/WebGL/Blob/Image/CSS font 의존성을 native asset·text·render command 계층으로 교체해야 한다.
- 현재 각 Canvas/WebGL surface와 overlay blur 구조를 SDL에서 그대로 복제하면 context·VRAM·pass 수가 급증한다.
- Android SDL_GPU는 Vulkan 기기 편차가 있어 GLES와 Software 폴백이 필수다.
- SDL_GPU의 sprite·text·effect·UI·overlay는 아직 solid geometry placeholder다. 실제 texture/glyph atlas, render graph, overlay composite와 Metal 기기 실행 검증이 필요하다.
- Android SDK/NDK는 아직 없고 iOS/macOS 빌드 환경도 준비되지 않았다. Android용 JDK 17, 사용자 범위 CMake 4.4.0/Ninja 1.13.2는 설치돼 있지만 현재 기본 Java 25가 Gradle 8.12와 맞지 않아 Gradle JVM을 17로 고정해야 한다. SDK 약관 승인은 사용자 동의가 필요하다.
- C++ 800-body 이동·타일 충돌, 현재 GameSystem 480-tick replay와 두 WAT scalar reference는 JS/WAT와 완전 일치한다. production legacy spatial grid/contact solve/projectile은 60-tick oracle만 동결됐고 C++ 이식이 Phase 4 종료 조건으로 남아 있다.
- 2026-07-27 Computer Use 실기 감사에서 발견한 정상 `game_desktop`의 synthetic-only 통합 공백은 playable session bridge와 짧은 입력 latch로 보완했다. 다만 현재 native 장면은 맵·Core·Tower만 표시하며 기존 타이틀 화면, HUD와 각종 오버레이, 적·전투·웨이브·실제 texture/font/effect는 아직 이식되지 않았다.
- 사용자 요구에 따라 타이틀 화면과 모든 오버레이는 유사 구현이 아니라 기존 JS 기준 실행기의 장면별 시각·텍스트·레이어·입력·상태 전이를 완전히 동일하게 재현해야 한다. 화면 인벤토리와 결정적 골든을 먼저 고정하지 않으면 완료로 표시하지 않는다.
- Pretendard 원본은 WOFF2이며 OFL 1.1의 Reserved Font Name을 포함한다. 변환 TTF를 같은 이름으로 재배포하지 않고 원본 WOFF2를 그대로 패키징해 고정 Brotli+FreeType+HarfBuzz로 읽어야 한다. `🏆`·`📖`는 Pretendard에 없어 Windows 시스템 emoji fallback 결과를 Android에서 재현할 수 없으므로 고정 벡터/bitmap asset으로 교체해야 한다.
- 현 `FramePacket v1`은 shaped glyph, gradient, clip, vector/projective geometry, render-pass barrier와 중첩 overlay capture anchor를 표현하지 못한다. 타이틀 UI를 placeholder 위에 직접 구현하지 않고 text/asset 기반과 `FramePacket v2`를 먼저 구축한다.
- text foundation은 memory face와 canonical shaping까지만 완료됐다. 실제 UI와 동일한 300/400/500/600/700 weight, glyph raster/atlas/cache, backend upload와 FramePacket glyph run은 아직 구현해야 한다.

## 검증 기록

### 2026-07-27 — 착수 감사

```text
npm test
결과: 423 tests / 423 pass / 0 fail

npm run check:wasm:flow-field
결과: 통과

npm run check:wasm:collision-contact
결과: 통과

npm run test:render:golden
결과: win32-x64-nw0.108.0-dpr1 profile, 10 surfaces, 3 cases 통과
```

- 저장소에는 착수 시점 기준 CMake, C/C++, SDL, Android, iOS 프로젝트가 없었다.
- Visual Studio Community 2026은 설치돼 있었지만 착수 시 C++ workload, Windows SDK, CMake, Ninja가 없었다.
- 최초 비관리자 workload 설치는 `5007`로 종료됐다. 이후 사용자가 UAC를 승인해 `Microsoft.VisualStudio.Workload.NativeDesktop`, MSVC 19.51, Windows SDK 10.0.26100, CMake 4.3.1, Ninja 1.13.2 설치를 완료했다.
- 사용자 범위에도 CMake 4.4.0, Ninja 1.13.2, WinLibs POSIX/UCRT GCC 16.1.0을 설치해 독립적인 보조 검증 경로를 확보했다.

### 2026-07-27 — JS replay/state-hash 기준선

```text
npm test
결과: 424 tests / 424 pass / 0 fail

npm run baseline:sdl
결과: 480 tick replay 일치
static world hash: fd31f3c2801962f7
initial state hash: 9deef2f12bd1257d
final state hash: 748a6b36a9213900
tile correction: 4회
```

- 실제 `GameSystem → GameObjectSystem → PhysicsBody2D → TileMapCollisionResolver` 경로를 기준 실행기로 사용한다.
- canonical hash는 정렬된 키와 IEEE-754 binary64 big-endian 인코딩을 사용한 FNV-1a 64-bit다.
- 현재 게임에 없는 RNG·투사체·일반 contact/event stream은 capability와 `null/0`으로 명시해 허위 기준선을 만들지 않았다.

### 2026-07-27 — C++ core 및 SDL3 Desktop 셸

```text
MSVC Debug CTest: 2/2 통과
MSVC Release CTest: 2/2 통과
game_headless --seed 42 --ticks 60
stateHash: 58e40b4174f11e95

game_desktop --smoke-test
실제 Windows video driver: exit 0, 1280x720, scale 1.000
dummy + software renderer: exit 0, 1280x720, scale 1.000
```

- SDL은 `release-3.4.10` tarball SHA-256과 archive 내부 commit을 CMake configure 시 모두 검증한다.
- `SDL_MAIN_USE_CALLBACKS` 기반으로 창·event·focus·background/foreground·resize·display scale·safe area·low-memory를 처리한다.
- SDL 헤더의 UTF-8 문자가 CP949 경고로 승격되는 문제는 MSVC 대상에 `/utf-8`을 명시해 해결했으며 `/W4 /WX`는 유지했다.

### 2026-07-27 — Phase 0 통합 기준선과 CI

```text
npm run validate:sdl:baseline:full
결과: 통과
  JavaScript: 425/425
  GameSystem replay: 480 ticks, final 748a6b36a9213900
  flow-field/collision-contact WAT: 통과
  NW.js render golden: 10 surfaces, 3 cases, final SHA-256 936ef079e7280008a1ce80eee924d927271755b978cdd61747bd2d7ef554db8e

movement/collision stress
800 production movement circles × 240 ticks
integrate/resolve: 192,000 / 192,000
tile probes: 796,220
position corrections: 7,055
final state hash: ed129825bfe92c12
```

- 현재 GameSystem에 적·투사체·동적 contact·blur가 없으므로 해당 항목을 성능 수치로 가장하지 않고 unavailable capability로 기록했다.
- stress 기준은 실제 `PhysicsBody2D`, `CircleCollider2D`, `TileMapCollisionResolver` 경로의 결정적 hash와 operation count다. wall-clock은 환경 편차 때문에 정보값으로만 출력한다.
- GitHub Actions는 Windows 2022에서 JS 기준선과 MSVC/SDL Debug 빌드·CTest·headless hash를 검증한다. NW.js 렌더 골든은 로컬 runtime과 GUI profile 의존성 때문에 승인된 Windows 환경의 full 명령에 남긴다.
- `native` 경계 CTest는 `core/`, `engine/`, backend 중립 render 계층으로 SDL include/type가 침범하는지 검사한다.

### 2026-07-27 — FramePacket v1 및 Android 준비도 감사

```text
FramePacket synthetic canonical fixture
wire size: 2,862 bytes
FNV-1a 64: be64e77fc11fc188
MSVC Debug CTest: 4/4 통과

Android host audit
JDK 17: 설치됨
Android SDK / platform-tools / NDK / emulator: 없음
```

- backend 중립 FramePacket은 8개 layer, physical/drawable/logical UI/world 좌표계, PMA, sprite·shape·line·text·effect·UI·overlay 명령과 canonical little-endian codec을 포함한다.
- synthetic frame은 MSVC와 GCC에서 같은 wire bytes를 만들며, 정식 CTest가 round-trip, 크기 제한, 잘린 payload, trailing bytes, destination 불변, fixed capacity 재사용, layer 역행 거부, viewport 역변환을 검사한다.
- Android는 SDL 3.4.10 AAR+Prefab, SDK 35, min API 21, NDK `28.2.13676358`, Gradle 8.12/AGP 8.7.3/JDK 17 조합을 후보로 고정했다. SDK license 승인과 package 설치 전까지 실제 ARM64 build는 차단 상태다.
- 현재 CMake의 Desktop FetchContent/static SDL과 Android AAR/Prefab 경로는 분리해야 하며, Android에서는 `main` shared library target이 필요하다.

### 2026-07-27 — SDL3 Desktop platform service 완료

```text
game_desktop --smoke-test
실제 Windows video/audio driver: exit 0
dummy video + software renderer + dummy audio: exit 0

storage smoke
write → read-cap reject → byte-identical read → remove → close: 통과

audio smoke
default playback open → pause → resume → close: 통과
```

- SDL user storage는 비동기 ready 상태를 main callback에서 non-blocking으로 폴링하고 기본 64MiB 읽기 상한, 주소 공간·할당 실패, flush 실패를 구분한다.
- audio 장치는 SDL audio subsystem 초기화 이후 열고 focus/background lifecycle에서 pause/resume하며 SDL 종료 전에 닫는다.
- callback event는 동시 호출될 수 있으므로 단순 `PlatformEvent`로 변환해 mutex queue에 넣고, SDL window/lifecycle 처리는 main iterate에서만 수행한다.
- frame CPU 계측은 blocking present 이전에 끝내 VSync 대기 시간을 simulation CPU 부하로 오인하지 않는다.
- C++ canonical state writer가 JS `cirvivor-canonical-v1-f64be`의 null·boolean·binary64·UTF-8 string·array·object token을 동일하게 hash한다. 실제 GameSystem state 구조 이식과 tick별 비교는 Phase 4 작업으로 남는다.

### 2026-07-27 — FramePacket 안전성·Software renderer·fallback router

```text
MSVC Debug CTest: 6/6 통과
MSVC Release CTest: 6/6 통과
GCC 16.1 SDL-off strict CTest: 4/4 통과

FramePacket canonical v1
wire size: 2,862 bytes
FNV-1a 64: be64e77fc11fc188

Software profile synthetic scene, 25 commands / 0 skipped
960×540 pixel hash: 77feca0db768b39d
640×360 pixel hash: e297e690c6d91e76
3440×1440 viewport → 960×540 hash: 34f95f4e5868d1fc
Release first-frame CPU raster: 약 25ms (로컬 정보값)

RendererRouter fake contract: 8/8 통과

FramePacket builder transaction contract: 6/6 통과 (MSVC Debug·Release, GCC)

SDL_GPU Windows 실기 skeleton
Direct3D12 / NVIDIA GeForce RTX 4080 SUPER / 최대 8x sample
clear-store-submit 2회 + background skip 1회 통과
```

- FramePacket은 내부 text storage alias, 동시 builder, 잘못된 overlay session/source mask, 비유한 float, 잘못된 PMA, 비정상 viewport·UTF-8, 과도한 decode memory를 거부한다.
- FramePacket build가 실패하거나 완료 전에 builder가 소멸하면 부분 명령을 모두 비워, 실패를 놓친 호출자가 불완전한 프레임을 렌더하지 못하게 한다. busy destination decode도 기존 build를 변경하지 않고 거부한다.
- logical UI는 16:9 content rect에 동일한 X/Y 배율을 사용하고 ultrawide letterbox 밖 safe inset을 제거한다.
- Software renderer는 `SDL_Surface` ARGB8888에 PMA로 같은 command stream을 실행하며 실제 texture/glyph 대신 결정적인 placeholder를 사용한다. dirty tile, glyph cache, 선택적 CPU blur는 Phase 7 범위다.
- backend 중립 router는 auto `SDL_GPU → 선택적 GLES → Software`, 강제 GLES `GLES → Software`, 강제 Software 단독 순서를 고정하고 factory/init 예외와 runtime 실패를 C callback 밖으로 전파하지 않는다.
- SDL_GPU backend는 bare `SDL_Window`을 독점 claim해 실제 Windows D3D12 swapchain clear/present와 background 제출 중단을 검증했다. 아직 shader pipeline과 command drawing이 없는 skeleton이므로 Phase 3 완료로 간주하지 않는다.
- 약 25ms는 현재 PC의 최초 Release 프레임 참고치로 33.33ms 단일 프레임 기준은 충족하지만, p95와 모바일 장기 성능 합격을 의미하지 않는다.

### 2026-07-27 — 세 backend 창 소유권·Desktop router 통합

```text
MSVC Debug CTest: 7/7 통과
MSVC Release CTest: 7/7 통과
GCC 16.1 SDL-off strict CTest: 4/4 통과

실제 Windows 강제 backend smoke
sdl-gpu: exit 0 / Direct3D12 / NVIDIA GeForce RTX 4080 SUPER
gles: exit 0 / OpenGL ES 3 / NVIDIA GeForce RTX 4080 SUPER
software: exit 0 / CPU raster + Direct3D11 streaming presenter

dummy video/audio
auto: SDL_GPU 실패 → ES3 창 실패 → ES2 창 실패 → Software, exit 0
software 강제: exit 0
```

- `SdlWindow`에서 임시 `SDL_Renderer`를 제거하고 backend 중립 창만 소유하게 했다. Router candidate가 바뀔 때 이전 backend를 먼저 종료한 뒤 profile에 맞는 숨김 창을 재생성하고, 선택 성공 뒤에만 창을 표시한다.
- Android에서 `SDL_WINDOW_OPENGL` 생성 시 붙는 EGL surface가 Vulkan surface와 충돌할 수 있으므로 한 창을 GPU/GLES가 공유하지 않는다. GLES ES3→ES2도 같은 창에서 context만 바꾸지 않는다.
- Software backend는 960×540 또는 640×360 CPU surface를 ARGB8888 streaming texture로 pitch에 맞춰 업로드하고, PMA blend·letterbox·VSync·background skip을 담당한다.
- GLES backend는 PMA와 네 좌표계를 적용해 synthetic 명령 25개 중 22개를 geometry/placeholder로 제출하고 overlay 제어 3개를 no-op으로 처리했다. 별도 ES3·ES2 창 모두 실제 Windows에서 검증했다.
- Application은 매 표시 프레임 동일 synthetic `FramePacket`을 생성해 선택된 backend에 전달하고 resize·safe area·projection revision·background/foreground·low-memory를 Router로 전달한다.

### 2026-07-27 — 실제 GPU command drawing과 800-body C++ parity

```text
SDL_GPU 실제 Windows 제출
D3D12: 25 commands / 972 vertices / 2 draws, exit 0
Vulkan: 실제 visible swapchain 제출, exit 0
generated DXIL·SPIR-V·MSL 6개: SDL 3.4.10 고정 원본 SHA-256 일치

GLES 실제 Windows ES3·ES2
synthetic: 25 submitted / 22 rendered / 19 placeholders / 0 skipped
원·타원·rounded rect·회전 선/도형 전용 geometry 검증 통과

C++ movement/collision parity
800 BodySoA × 240 fixed ticks
initial hash: 83adf889c06a6f90
records digest: 0f701c9ea7aef6a2
final hash: ed129825bfe92c12
tile probes: 796,220
position corrections: 7,055
tick heap allocations: 0
MSVC Release p50/p95/p99: 약 0.071 / 0.079 / 0.085ms
MSVC Debug·Release 및 GCC strict: 모두 exact parity 통과
```

- SDL_GPU는 opaque/PMA/additive pipeline, persistent vertex/transfer buffer, copy/render pass와 실제 draw/submit을 구현했다. 현재 texture·glyph·효과 command는 결정적 solid placeholder로 계측한다.
- GLES는 32-segment ellipse, 코너별 6-segment rounded rect, 방향성 두께 line quad와 butt/square/round cap, 회전 pivot을 실제 geometry로 처리한다.
- C++ `BodySoA`는 setup 때 고정 capacity를 확보하고 fixed tick에서 배열을 성장시키지 않는다. `TileCollisionSolver`는 JS의 row/column 순회, 최대 8회 보정, penetration tie-break와 inward normal velocity 제거 순서를 보존한다.
- 첫 C++ 실행은 operation count는 같았지만 Windows CRT `exp()`가 V8 `Math.exp()`보다 1 ULP 높아 state hash가 달랐다. V8 12.4.254의 fdlibm 경로를 보존한 `deterministicExp()`로 바꾼 뒤 240개 tick record 전체 digest가 완전 일치했다.
- Release p95는 계획의 simulation 8.33ms 예산보다 충분히 낮은 로컬 정보값이다. 아직 일반 broad/narrow phase, projectile sweep, 전체 GameSystem replay와 모바일 측정을 대신하지 않는다.

### 2026-07-27 — foreground·0×0 drawable·renderer reset 복구

```text
MSVC Debug CTest: 9/9 통과
MSVC Release CTest: 9/9 통과
GCC 16.1 SDL-off strict CTest: 5/5 통과

game_desktop --smoke-test-render-recovery
실제 sdl-gpu/D3D12: exit 0
실제 GLES ES3: exit 0
실제 Software: exit 0
dummy auto: GPU/GLES 실패 → Software → device rebuild → Software, exit 0
```

- foreground 복귀 순서는 backend `onForeground()`/context 복구 → pending target 처리 → window metrics/resize → scheduler/audio resume다. background metrics는 dirty 상태로 보류한다.
- drawable이 0×0이면 backend resize, FramePacket build와 render를 건너뛰고 simulation clock만 처리하며 redraw 요청을 유지한다.
- render-target reset은 `onRenderTargetsReset()`으로 분리했다. device reset/lost는 backend와 window를 완전히 내린 뒤 원래 선호 순서로 다시 초기화하고, 실패하면 SDL_GPU → GLES → Software의 다음 후보로 내려간다.
- `RenderCapabilities::mainCallbackRateLimitHz`를 추가했다. 현재 GPU/GLES는 안전한 60Hz, Software는 30Hz를 사용하며 0은 present pacing을 확실히 보장하는 구현만 허용한다.
- 자동 recovery CTest는 background → background metrics defer → foreground → targets reset → device reset/full rebuild → 최종 frame present를 실제 `Application::handleEvent()` 경로로 실행한다.
- 실제 OS가 만든 0×0 drawable과 물리적 device/context loss는 Android/iOS 실기에서 추가 검증해야 한다.

### 2026-07-27 — Phase 3 성능 게이트와 GameSystem C++ replay parity

```text
MSVC Debug CTest: 10/10 통과
MSVC Release CTest: 10/10 통과
GCC 16.1 SDL-off strict CTest: 6/6 통과

C++ GameSystem replay, 480 fixed ticks
static world hash: fd31f3c2801962f7
initial state hash: 9deef2f12bd1257d
records digest: 11fd486e39710bf6
final state hash: 748a6b36a9213900
tile corrections: 4
tick heap allocations: 0

Software renderer Release gate, 960x540
warmup/measured: 60 / 180 frames
render() p50/p95/p99: 24.087 / 24.456 / 25.398ms
commands submitted/rendered/skipped: 4,500 / 4,500 / 0
FramePacket build + render tracked C++ allocations: 0
33.33ms p95 gate: PASS
```

- C++ `GameSystem`은 입력을 Tower intent로 변환하고 60Hz `BodySoA` 적분·타일 충돌·Core/Tower snapshot을 JS 기준 실행기와 같은 순서로 hash한다. 현재 JS에 없는 RNG·투사체·일반 contact/event는 계속 `null/0` capability로 유지한다.
- Software 벤치마크는 phase를 매 프레임 바꾸고 phase-37 골든 및 동적 checkpoint pixel hash를 함께 검증한다. Release에서는 p95 33.33ms를 강제하고 Debug에서는 report-only다.
- 성능 게이트는 변동성이 큰 일반 CTest에 넣지 않고 별도 `software_renderer_benchmark` 실행 파일로 분리했다. 현재 수치는 CPU surface raster와 현재 placeholder command 범위이며 SDL texture upload/present, 실제 texture/glyph/effect, 모바일 성능을 대신하지 않는다.
- 위 결과로 FramePacket, 세 기본 backend의 실제 command drawing, 폴백, 복구/pacing과 Software 30fps 기준을 충족해 Phase 3을 완료로 전환한다.

### 2026-07-27 — WAT scalar reference와 legacy collision/projectile oracle

```text
MSVC Debug CTest: 11/11 통과
MSVC Release CTest: 11/11 통과
GCC 16.1 SDL-off strict CTest: 7/7 통과
JavaScript: 426/426 통과

FlowFieldScalar WAT exact parity
1x1~3x3 exhaustive 5,506 cases: 70d2072deca56472
4097x2 + 2x4097: 849e3b92e04d6631
49,601-cell stripe: 9e897ab19c9e9faa
deterministic random 64 cases: 282adc1247a1fce5
build heap allocations: 0

PreparedContactScalar WAT ordered flags
[1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]
scan heap allocations: 0

legacy ObjectSystem production replay
60 ticks / initial enemies 50 / projectiles 5 / hits 6
first solve bodies/grid cells/priority/normal: 52 / 32 / 503 / 16
full trace hash: a36082cf9d96d7db
records hash: 33e9251bd47d96f9
scan truncation / resolved pairs: 22 / 6,105
final enemies / state hash: 21 / 7cbb31b14a9c90e0
```

- `FlowFieldScalar`는 WAT의 u8 blocked grid, 8방향 순서, 대각선 corner-cut 금지, f32 integration 저장과 낮은 cell index heap tie를 보존한다. `PreparedContactScalar`는 f64 body·f32 part·ordered pair ABI, 반경 배율 0.765, epsilon `1e-6`, tangent 거부를 보존한다.
- 두 scalar는 생성 시 scratch capacity를 고정하고 caller span에만 기록한다. invalid batch는 output을 일부 쓰지 않으며 MSVC `/fp:strict`와 GCC `-ffp-contract=off`에서 같은 골든을 만든다.
- 레거시 oracle은 실제 `ObjectSystem.fixedUpdate()`에서 grid insertion, candidate scan/fairness, priority/normal 회전 처리, 3-pass immediate solve, projectile substep와 swap-pop/sleep을 기록한다. production `CollisionHandler`의 trace seam은 opt-in이며 sink가 없거나 null이면 snapshot/event 객체를 만들지 않는다.
- 최초 solve의 broad f32, relation/candidate f64 raw SHA-256와 전체 ordered grid/candidate 배열도 fixture에 보존했다. 이 기준선을 입력으로 allocation-free C++ spatial grid/candidate, generic narrowphase/solve와 projectile sweep을 순차 이식한다.

### 2026-07-27 — legacy broad/narrow C++ parity와 Desktop 실행 감사

```text
JavaScript full baseline: 427/427 통과
MSVC Debug CTest: 13/13 통과
MSVC Release CTest: 13/13 통과
GCC 16.1 SDL-off strict CTest: 9/9 통과

legacy first-solve broadphase
ordered grid cells: 32
priority / normal pairs: 503 / 16
grid hash: 4387583875b60d1a
candidate hash: 1d9a1870556328dc
tick heap allocations: 0

generic narrowphase representative fixture
bodies / cases / collisions: 28 / 27 / 22
raw output SHA-256: 89648ea08dbcf1a9c6158623d48c1f67ddf6001b5ea5f887cd483ae3d518e9e1
tick heap allocations: 0
```

- `CollisionSpatialGrid`와 `CollisionCandidateBuilder`는 고정 capacity 두 bank를 사용해 성공 결과만 publish한다. capacity/invalid 실패는 이전 active grid·pair·fairness와 epoch를 보존한다.
- `CollisionNarrowphase`는 circle/circle, circle-parts, parts/parts, circle/rect 조합과 signed zero·rect 내부 tie-break·대각 fallback을 MSVC/GCC strict에서 같은 fixture로 검증한다. 아직 3-pass position solve 완료를 의미하지 않는다.
- 세 SDL smoke가 같은 user-storage 임시 파일을 병렬로 잡던 테스트 격리 문제는 CTest `RESOURCE_LOCK`으로 직렬화해 `ctest -j 4`에서도 안정화했다.
- Computer Use로 Release `game_desktop.exe`를 정상 실행해 창·픽셀을 확인했다. 창과 backend는 정상이나 화면은 렌더 진단용 synthetic scene이며, `Application`이 `GameSystem`을 소유·update하지 않고 키 입력도 버리는 것이 원인이다.

### 2026-07-27 — Desktop playable session bridge와 짧은 입력 보존

```text
MSVC Debug CTest: 16/16 통과
MSVC Release CTest: 16/16 통과
GCC 16.1 SDL-off strict CTest: 11/11 통과

SDL movement event translation: 5/5 통과
MovementInputBuffer: 5/5 통과
playable scene presenter: 4/4 통과
playable commands: 94 (Shape 70 / Line 24)
120-frame presenter build heap allocations: 0
```

- 정상 `game_desktop`은 `GameSystem`을 소유하고 scheduler가 산출한 fixed step마다 의미 입력을 전달한다. 타일맵·Core·Tower는 보간된 playable `FramePacket`으로 그리며 synthetic scene은 `--diagnostic-scene`과 smoke 전용으로 격리했다.
- SDL W/↑, S/↓, A/←, D/→는 물리 source bit를 유지해 같은 의미 action의 alias를 합성한다. `MovementInputBuffer`는 같은 event batch의 keydown→keyup도 첫 authoritative fixed tick까지 보존하고 repeat는 새 pulse를 만들지 않으며 focus/background 전환에서 held/pending을 모두 지운다.
- Computer Use로 재빌드한 Release 실행 파일을 직접 열어 synthetic 패턴이 아닌 corridor 맵·Tower·Core가 표시되는 것을 확인했다. `D` 짧은 탭 네 번이 각각 소비되어 Tower가 오른쪽으로 누적 이동하는 것도 화면에서 확인했다.
- 이 결과는 현재 최소 playable slice의 실행 조립만 증명한다. 기존 타이틀, 모든 오버레이, 적·전투·웨이브·실제 texture/font/audio/save가 완성됐다는 뜻이 아니다.

### 2026-07-27 — Android 사용자 범위 툴체인 재감사

```text
JDK 17.0.15: C:\Program Files\Java\jdk-17
기본 Java: 25 (Android Gradle에 사용 금지)
CMake / Ninja: 4.4.0 / 1.13.2 사용자 범위 설치됨
Android SDK / sdkmanager / platform-tools / NDK: 없음
고정 후보: AGP 8.7.3 / Gradle 8.12 / SDK 35 / NDK 28.2.13676358
```

- Android Studio는 첫 ARM64 빌드의 필수 조건이 아니다. 공식 Command-line Tools를 `%LOCALAPPDATA%\Android\Sdk`에 설치하면 UAC 없이 준비할 수 있다.
- Gradle/SDK 명령은 전역 Java 25 대신 `JAVA_HOME=C:\Program Files\Java\jdk-17`을 세션별로 고정한다. 전역 Gradle 대신 프로젝트 Gradle Wrapper 8.12를 사용한다.
- SDK 약관 동의는 UAC가 아니지만 사용자 법적 동의이므로 자동 승인하지 않는다. Command-line Tools 준비와 프로젝트 skeleton은 진행할 수 있으나 package 설치는 사용자 승인 이후 수행한다.

### 2026-07-27 — 기존 타이틀·오버레이 Computer Use oracle 감사

```text
검증 해상도: 2560×1440
타이틀: 로고·shield/circle·적 배경·glass 메뉴·버전/패치·utility menu·custom cursor 확인
title factory overlay: mapSelect / deck / setting / credits / quickStart / records / research / achievements
manager/global overlay: exitConfirm / externalLinkWarning / debugPanel
factory 도달성: 8/8
```

- 기존 NW.js 제품 실행기를 read-only oracle로 직접 조작해 타이틀의 최종 정지 상태와 각 overlay의 open-complete 상태를 확인했다. 설정의 floating dropdown, 투명/불투명 glass, credits 위 external-link 경고의 하위 overlay dim/lock, 디버그 profiler·pool·hitbox와 animation control도 포함한다.
- 공통 overlay 전환은 약 0.5초 동안 alpha 0↔1, scale 0.9↔1, content blur 10↔0이며 open은 ease-out, close는 ease-in 계열이다. 중첩 overlay는 아래 session을 dim하고 interaction을 잠근다.
- Loading→Title은 동일 scene identity를 유지하며 1.5초 hold, 0.6초 blur, 3초 logo playback과 후속 circle/logo/menu 전환을 거친다. 타이틀 logo는 bitmap이 아니라 1178.8×589.45 기준 vector path다.
- `CollectionOverlay`는 소스에 남아 있지만 production 메뉴/factory 진입점이 없는 orphan이다. 관찰 가능한 제품 parity에서 누락된 것으로 오인하지 않도록 비도달 inventory로 별도 고정한다.
- 현재 JS 제품에는 일반 플레이 HUD·pause·game-over·tutorial·shop/status overlay가 구현돼 있지 않다. 이런 화면은 기존판과 동일 포팅 완료 항목으로 가장하지 않고 향후 별도 제품 설계 항목으로 다룬다.

### 2026-07-27 — 폰트·네이티브 UI 기반 감사

```text
PretendardVariable.woff2
bytes: 2,057,688
SHA-256: 9599F12FD42FC0BCE1CD50B47A0C022E108D7AA64DD0D1BB0ED44F3282D900B4
wght axis: 45..930, default 400
glyph count: 14,757

project/license/pretendard.txt
SHA-256: DBBFD9862CC8513C40D307D892A446B33EF4767E6423A3F74A913B8A210B91FD
```

- 실제 로드는 `game/index.html`→`game/style.css`→원본 WOFF2 경로이며, `font/pretendardvariable.css`는 미참조이고 존재하지 않는 하위 경로를 가리키는 중복 파일이다.
- 감사 시점에는 네이티브 FreeType/HarfBuzz/Brotli와 glyph atlas가 없었으며 세 backend 모두 text/sprite/effect/overlay placeholder를 사용했다. 이후 아래의 text foundation을 추가했지만 실제 atlas/backend drawing은 아직 placeholder다.
- 구현 순서를 원본 asset/hash/license 고정 → 공통 shape/raster/glyph atlas → `FramePacket v2` glyph run/vector/effect 계약 → SDL_GPU render graph → GLES/Software 동등 경로 → scene/UI 상태기로 확정한다.

### 2026-07-27 — 타이틀·오버레이 parity 계약과 UI 입력 seam

```text
결정적 UI 시나리오: 21개
title factory: 8/8
manager/global overlay: 3/3
orphan inventory: CollectionOverlay 1개
JavaScript full suite: 433/433 통과
MSVC Debug·Release CTest: 16/16 통과
```

- `ui_visual/scenarios_v1.json`은 1280×720, DPR 1, 60Hz fixed clock, seed 1817에서 Loading/Title 시점, hover, overlay open/mid/close, floating dropdown, 불투명 설정, 중첩 외부 링크 경고와 Debug/Exit 상태를 고정한다.
- SDL event는 backend 중립 mouse/touch/cancel/wheel, pointer identity, 고정 크기 UTF-8 commit/composition, focus-loss clear로 변환된다. 이후 UI 상태기는 이 seam만 소비하며 SDL 타입을 직접 참조하지 않는다.
- `Alt+F4`를 Computer Use로 원본 NW.js에 전달했을 때 즉시 종료되지 않고 `종료 / 게임을 종료할까요? / 아니오 / 예` overlay가 열리는 것을 재확인했다. native도 `windowCloseRequested`를 별도 event로 운반하며, exit overlay가 아직 연결되지 않은 현재만 정상 종료 fallback을 사용한다.

### 2026-07-27 — 원본 WOFF2 기반 네이티브 text foundation

```text
Brotli 1.2.0 → FreeType 2.14.3 (WOFF2) → HarfBuzz 14.2.1 (hb-ft)
MSVC Debug CTest: 17/17 통과
MSVC Release CTest: 17/17 통과
GCC 16.1 SDL-off strict CTest: 12/12 통과

설정, 64px / wght 400 / no hinting
glyph IDs: 6948, 8725
total advance 26.6: 7080

Lonely Tower, 64px / wght 400 / no hinting
glyph count: 12
total advance 26.6: 24388
```

- source-built 정적 dependency의 version·tag·commit·archive SHA-256을 `manifest.lock`에 고정했다. FreeType은 고정 Brotli로 WOFF2를 직접 읽고 HarfBuzz는 같은 FT face/size/variation을 공유한다.
- `TextAssets.cmake`는 Pretendard 원본 WOFF2와 OFL SHA-256을 configure 때 검증해 runtime asset으로 무변환 복사한다. public `FontFace`는 Pimpl 경계를 사용해 FreeType/HarfBuzz 타입을 노출하지 않는다.
- Pretendard에 없는 `🏆`·`📖`는 운영체제 font fallback을 사용하지 않고 고정 asset 대체 정책으로 분류했다. OS별 emoji 차이를 동일 구현으로 오인하지 않는다.
- 이 단계는 font 로드·shape 계약만 고정한다. 실제 UI에 필요한 다중 weight, glyph raster/atlas/cache, FramePacket glyph run과 세 backend 출력은 후속 작업이다.

## 현재 작업

- [x] SDL 포팅용 JS replay/state-hash exporter와 fixture
- [x] 통합 baseline 명령과 현재 구현 범위의 고부하 결정성 fixture
- [x] C++20 `game_core`, `game_headless`, `game_tests`
- [x] deterministic RNG, EntityId, FrameScheduler와 단위 테스트
- [x] SDL 3.4.10 dependency manifest와 CMake 연결
- [x] `SDL_MAIN_USE_CALLBACKS` Desktop smoke 앱
- [x] SDL storage/audio platform service와 정상 종료 검증
- [x] FramePacket command schema와 synthetic frame 검증
- [x] SDL_GPU/GLES/Software 기본 backend와 router (실제 command drawing·창 재생성·실패 폴백 완료, 고급 texture/effect는 후속 Phase)
- [x] Body SoA·corridor-eight 타일 충돌과 800-body JS exact parity·tick allocation telemetry
- [x] 현재 GameSystem 480-tick C++ replay parity·tick allocation telemetry
- [x] flow-field·prepared contact WAT scalar exact parity·무할당 검증
- [x] production legacy spatial grid/contact/projectile 60-tick JS oracle 동결
- [x] production first-solve spatial grid/candidate C++ exact parity·무할당/transaction 검증
- [x] generic narrowphase representative fixture C++ exact parity·무할당 검증
- [ ] 3-pass position solve·projectile sweep C++ exact parity
- [x] Desktop 정상 실행의 SDL 의미 입력→짧은 입력 latch→GameSystem fixed update→playable FramePacket 연결 및 Computer Use 실기 확인
- [x] 기존 타이틀·도달 가능한 overlay 11종과 orphan overlay의 source/Computer Use 인벤토리
- [x] 21개 Loading/Title/overlay 시각·상태·입력 시나리오 계약과 JS 회귀 테스트
- [x] SDL mouse/touch/wheel/text/IME/window-close의 backend 중립 UI 입력 seam
- [ ] 실제 Loading/Title/overlay 결정적 NW.js pixel golden 캡처·승인
- [x] 원본 WOFF2/OFL asset 고정과 공통 FreeType/HarfBuzz memory-face/shaping foundation
- [ ] 다중 weight glyph raster/atlas/cache와 세 backend text drawing
- [ ] `FramePacket v2` glyph/vector/gradient/clip/render-pass·중첩 overlay capture 계약
- [ ] 타이틀 화면과 모든 오버레이의 시각·입력·상태 전이 완전 동일 구현
- [ ] Android SDK/NDK/Gradle 툴체인 설치와 ARM64 빌드
- [x] iOS는 Mac 부재와 사용자 요청으로 현재 범위에서 제외(완료로 가장하지 않음)
- [x] Windows CI와 네이티브 아키텍처 가이드

## 다음 갱신 시점

다음 중 하나가 발생하면 이 문서를 갱신한다.

- Phase 작업 묶음이 완료되거나 종료 조건이 바뀔 때
- 새 플랫폼·의존성·아키텍처 결정을 확정할 때
- 검증 명령이 통과 또는 실패해 원인이 확인될 때
- 외부 환경이 필요한 차단 요소가 새로 생기거나 해소될 때
