# SDL3 네이티브 포트 가이드

이 문서는 SDL3 포트의 안정된 구조와 로컬 검증 경로를 설명한다. 단계별 완료 여부와 최신 실패·검증 기록은 [`sdl_progess.md`](C:/CirVivor/sdl_progess.md), 전체 전환 순서와 종료 조건은 [`sdl3_desktop_android_ios_porting_plan.md`](C:/CirVivor/guide/sdl3_desktop_android_ios_porting_plan.md)를 기준으로 한다.

현재 실행 범위는 Windows Desktop뿐이다. Android와 iOS는 사용자 결정으로 제외하며, 플랫폼 중립 경계를 보존하는 것과 모바일 SDK·프로젝트·빌드·실기 지원을 완료하는 것은 구분한다.

## 전환 원칙

- 기존 `project/`의 JavaScript/NW.js 경로는 native parity가 증명될 때까지 기준 실행기(oracle)로 보존한다.
- `native/`는 독립적인 C++20 rewrite다. JavaScript engine을 embed·실행·해석하거나 ECMAScript event loop, Promise/microtask, 우연한 부동소수점 진행을 에뮬레이션하지 않는다. 기존 경로에서는 관찰 가능한 게임 규칙·화면·입력·상태 전이와 승인 fixture만 가져온다.
- `native/src/core/`와 `native/src/engine/`는 SDL 헤더, SDL handle, OS 파일 경로 타입을 포함하지 않는다.
- 입력은 플랫폼 event가 아니라 의미 action으로 simulation에 전달한다.
- authoritative simulation은 60Hz fixed step으로 실행하고 rendering은 보간 가능한 `FramePacket`을 소비한다.
- 같은 replay의 canonical state hash가 JS와 C++에서 일치하기 전에는 해당 시스템의 이식을 완료로 간주하지 않는다.
- backend 종류(SDL_GPU, GLES, Software)와 품질 profile(Full, Reduced, Software)을 별도 축으로 다룬다.

## 현재 네이티브 구조

| 경로/target | 책임 |
| --- | --- |
| `native/src/core/` / `game_core` | 결정적 수학·RNG·EntityId·state hash, 고정 capacity Body SoA·타일 충돌·flow-field/prepared-contact scalar reference 등 플랫폼 독립 기반 |
| `native/src/engine/` / `game_core` | fixed-step frame scheduling과 공통 runtime 정책 |
| `native/src/data/` / `game_core` | native 제품이 공유하는 map ID 등 선언형 catalog |
| `native/src/game/` / `game_core` | 의미 입력을 소비하는 세션 GameSystem과 Core/Tower authoritative snapshot 조립 |
| `native/src/app/movement_input_buffer.*` / `app_runtime` | 물리 source alias 합성, 짧은 press의 첫 fixed tick 보존, focus/background clear를 담당하는 SDL 비의존 입력 버퍼 |
| `native/src/ui/` / `ui_runtime` | 가변 시간 Loading/Title·overlay 상태, light/dark 렌더 토큰, responsive/safe-area 레이아웃과 presentation sampler |
| `native/src/headless/` / `game_headless` | 창 없이 seed·tick 기반 결정성 실행 |
| `native/src/platform/sdl/` / `platform_sdl` | SDL 창, event 변환, lifecycle, user storage, 기본 audio device 수명 |
| `native/src/app/` / `game_desktop` | `SDL_MAIN_USE_CALLBACKS` 진입점과 application 조립 |
| `native/src/render/common/` | backend 중립 render command와 FramePacket 계약 |
| `native/src/render/text/` / `render_text` | 원본 WOFF2 memory face, variable weight와 HarfBuzz shaping의 third-party 비노출 경계 |
| `native/src/render/frontend/` | simulation/presentation 상태를 FramePacket으로 변환 |
| `native/src/render/backend/` / `renderer_backend` | SDL 타입을 모르는 backend 수명 인터페이스와 선택/fallback Router |
| `native/src/render/sdl_gpu/` / `renderer_sdl_gpu` | SDL_GPU device, window claim, swapchain 제출 |
| `native/src/render/gles/` / `renderer_gles` | 사전 구성된 ES3/ES2 window용 compatibility renderer |
| `native/src/render/software/` / `renderer_software` | SDL_Surface CPU raster와 streaming texture presenter |
| `native/tests/` | 플랫폼 독립 단위·계약, FramePacket/router, Software golden, JS simulation parity 테스트 |

`native/build/`는 생성물이며 버전 관리하지 않는다. Android와 iOS target은 현재 작업 범위 밖이므로 이 구조를 모바일 지원 완료로 해석하지 않는다.

## 정상 실행과 입력 계약

정상 `game_desktop`은 기본적으로 순수 C++ title runtime과 `title_scene` presenter를 실행한다. Start 카드는 MapSelect를 열고, 시작 버튼을 놓으면 `data/game_map_catalog.h`의 알려진 map ID를 담은 one-shot effect를 `Application`에 전달한다. Application은 후보 `GameSystem`을 먼저 준비한 뒤 입력·scheduler·title frame/cache를 정리하고 마지막에 playable scene을 commit한다. 후보 생성이나 검증이 실패하면 기존 MapSelect를 유지하고 상호작용을 다시 열어 재시도할 수 있다. `--playable-scene`은 최소 게임 세션의 개발용 직접 진입이며, synthetic scene은 `--smoke-test`, `--smoke-test-render-recovery`, `--diagnostic-scene`에서만 사용한다.

SDL keyboard event는 W/↑, S/↓, A/←, D/→의 물리 source bit를 보존한다. `MovementInputBuffer`는 같은 SDL event batch에서 keydown과 keyup이 모두 도착해도 press를 첫 fixed step까지 latch한다. held action은 모든 fixed step에 유지되고 repeat keydown은 새 pulse를 만들지 않는다. focus/background 전환과 shutdown에서는 source와 pending press를 모두 지워 phantom input을 막는다.

UI 입력용 `PlatformEvent`는 mouse motion/down/up, wheel 방향, touch down/motion/up/cancel의 pointer identity·정규화 좌표, 256-byte 고정 UTF-8 commit/composition과 focus-loss clear 신호를 SDL 타입 없이 운반한다. title 모드의 창 닫기는 `windowCloseRequested`를 exit-confirm overlay로 전달하며 취소/확인 입력을 거친다. 개발용 playable/diagnostic 모드에서는 기존 즉시 종료 fallback을 유지한다.

현재 playable presenter는 corridor 맵을 행 run으로 압축해 Shape 70개와 Line 24개, 총 94개 command를 생성한다. 기본 zoom에서는 맵 중심 투영과 Core/Tower 보간을 사용한다. 이 최소 장면은 실행 조립 검증용이며 적·전투·웨이브·HUD 완성을 의미하지 않는다.

## 타이틀·UI·오버레이 parity 계약

타이틀 화면과 production에서 도달 가능한 기존 오버레이는 JS/NW.js 경로를 read-only oracle로 삼아 같은 기능·화면·입력 흐름을 C++로 다시 작성한다. JS의 실행 순서·객체 구조·Promise/microtask를 원자적으로 복제하는 것은 목표가 아니다. `project/game/test/fixtures/ui_visual/scenarios_v1.json`은 Loading/Title 전환과 hover, title factory 8종, Debug/Exit/ExternalLink manager overlay 3종, 중첩 외부 링크 경고·floating dropdown·불투명 모드를 포함한 21개 관찰 상태를 고정한다. `CollectionOverlay`는 구현 파일만 있고 production 진입점이 없는 orphan으로 명시한다.

완료 판정은 화면별 진입 상태와 입력 전이, 레이어 순서, 문구·폰트·색·크기·anchor, 애니메이션 시점과 overlay 합성 결과를 고정한 뒤 native 출력과 비교한다. 단순히 유사한 모양을 만들거나 placeholder text/texture를 표시한 상태는 완료가 아니다. 현재 JS 제품에 없는 일반 플레이 HUD·pause·game-over·tutorial·shop/status 화면은 동일 포팅 항목이 아니라 별도 제품 설계다.

구현 순서는 breadth-first다. 먼저 Windows에서 title→메뉴/overlay→playable session→종료의 실제 C++ 기능 흐름을 한 번 완성하고, 그 결과물을 실행하면서 21개 oracle 상태를 기준으로 text/logo/glass/blur/간격/애니메이션을 화면별로 보완한다. 이 순서는 JS 내부 구조를 복제하지 않으면서도 기능 없는 버튼이나 영구 placeholder를 최종 결과로 남기지 않기 위한 작업 순서다.

현재 `ui_runtime`은 30/60/120/144Hz에서 같은 wall-clock presentation을 만드는 seconds 기반 상태기와 Loading→Title 시간축, title factory 8종 및 Debug/Exit/External keyed overlay stack을 제공한다. Debug pause/focus 특례, 외부 URL 실행의 sequence acknowledge, one-shot 종료 요청, 고정 용량·무할당 snapshot도 계약으로 고정했다. 레이아웃은 논리 safe-area, light/dark title·settings·overlay 렌더 토큰, 타이틀 카드/pane/tile entrance와 exit/external shell geometry를 계산한다.

`Application`은 이 runtime을 기본 실행 경로에서 소유하고 title `FramePacket`을 만든다. title pointer, 창 닫기, exit/external confirmation, 버전 링크의 플랫폼 URL handoff와 Start→MapSelect→playable 전환까지 연결했다. MapSelect에는 responsive panel과 취소/시작 hit geometry가 있으며 mouse/touch pointer release를 소비한다. 그러나 MapSelect preview/text를 포함한 8개 title overlay와 Debug/Settings control 본문, floating 상태, 실제 문자열·로고·texture, shaped-text cache와 atlas upload, GPU 계열 고급 렌더 및 21개 native 시각 회귀가 남아 있으므로 타이틀·오버레이 완료로 판정하지 않는다.

## 창과 renderer 소유권

`SdlWindow`는 `SDL_Window`만 소유하고 renderer/context/device를 만들지 않는다. Router factory는 각 후보를 초기화하기 전에 숨김 창을 profile에 맞게 새로 만들고, 선택이 끝난 뒤에만 창을 표시한다.

```text
neutral window → SDL_GPU claim
실패·완전 종료
SDL_WINDOW_OPENGL + ES3 attributes → GLES ES3
실패·창 파괴
SDL_WINDOW_OPENGL + ES2 attributes → GLES ES2
실패·창 파괴
neutral window → Software SDL_Renderer presenter
```

GLES 호환 경로에서도 OpenGL surface와 SDL_GPU surface가 같은 창을 공유하지 않게 한다. GLES context version도 창 생성 뒤 같은 창에서 임의로 낮추지 않는다. 종료 순서는 renderer backend → window이며 둘 다 SDL video 종료보다 먼저 끝나야 한다.

## SDL 의존성 고정

SDL은 `native/third_party/manifest.lock`과 `native/cmake/Dependencies.cmake` 양쪽에서 다음 값으로 고정한다.

```text
version: 3.4.10
tag: release-3.4.10
commit: 8e37db5e797b6167f3a00d697d816a684bd259c7
source SHA-256: 12b34280415ec8418c864408b93d008a20a6530687ee613d60bfbd20411f2785
```

CMake configure는 archive SHA-256뿐 아니라 압축 파일의 `.git-hash`도 확인한다. 버전을 바꿀 때는 manifest, CMake 상수, 포팅 계획, 진행 문서를 한 작업에서 함께 갱신하고 Desktop/Android/iOS 영향 범위를 다시 검토한다.

authoritative `deterministicExp()`는 Node 22.19.0의 V8 12.4 oracle과 bit parity를 위해 V8 `12.4.254` commit `309640da62fae0485c7e4f64829627c92d53b35d`, `src/base/ieee754.cc` blob `e71b63fd7c17711e5dc04d9acc040be0aa0b7c40`의 fdlibm exponential을 최소 범위로 이식했다. 원 저작권·사용 허가는 구현 파일에 보존하고 provenance는 `manifest.lock`에 고정한다.

## Text dependency와 원본 font asset

`CIRVIVOR_BUILD_TEXT_STACK=ON`은 source-built 정적 dependency를 다음 값으로 고정한다.

```text
Brotli 1.2.0 / commit 028fb5a23661f123017c060daa546b55cf4bde29
FreeType 2.14.3 / commit 0a0221a1347e2f1e07c395263540026e9a0aa7c7
HarfBuzz 14.2.1 / commit 56feae4035bdd48f62ba2b8d8c16232d4d89b3a4
PretendardVariable.woff2 SHA-256 9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4
OFL SHA-256 dbbfd9862cc8513c40d307d892a446b33ef4767e6423a3f74a913b8a210b91fd
```

WOFF2를 TTF로 변환해 같은 Reserved Font Name으로 재배포하지 않는다. `TextAssets.cmake`가 저장소 원본 WOFF2와 OFL hash를 configure 때 검사한 뒤 `runtime_assets`로 무변환 복사한다. `FontFace`는 `FT_New_Memory_Face`, unicode charmap, variable `wght`, `hb-ft`와 no-hinting grayscale raster를 사용하며 public header에는 FreeType/HarfBuzz 타입을 노출하지 않는다. 64px·wght 400 shaping과 32px·wght 300 raster를 canonical hash로 고정한다.

`GlyphAtlas`는 font source FNV-1a fingerprint, glyph index, pixel size, weight를 key로 사용하며 생성 때 pixel/entry/open-address lookup 저장소를 모두 확보한다. 1px padding shelf pack은 중복 조회, entry/공간 초과와 실패 시 pixel·entry·generation 불변을 검사한다. atlas 채우기는 asset/UI preload 단계 작업이며 frame tick에서는 lookup만 사용한다. 실제 shaped-text cache와 backend atlas upload·draw는 후속 단계다.

## FramePacket v2 UI 렌더 계약

`FramePacket::schema_version` 2는 기존 command kind 0~6과 `FramePacketCapacity`의 기존 prefix를 그대로 두고 glyph run, projective textured mesh, linear/radial gradient, scissor/rounded clip stack, offscreen capture/composite pass를 추가한다. glyph·vertex/index·gradient stop은 packet이 별도 연속 저장소로 소유하며 fixed-capacity builder에서는 command와 부속 저장소 어느 쪽이든 부족하면 부분 결과를 publish하지 않는다.

canonical codec은 padding과 host endian에 의존하지 않는 little-endian v2만 decode한다. v1 synthetic wire `2,862B / be64e77fc11fc188`은 migration fixture로 보존하고 v2 decoder가 명시적으로 거부한다. 기존 명령만 담은 v2 fixture는 `2,898B / 73c9f4cc45c2d5db`, 모든 신규 명령 fixture는 `1,809B / dc42ba9a8b97777b`다. decode는 count·wire·decoded memory 상한을 allocation 전에 검사하고 실패 시 destination을 변경하지 않는다. UTF-8 저장소는 전체를 한 번 검증하고 각 text slice는 code-point 시작·끝 경계만 O(1)로 확인하므로 겹치는 slice 수에 비례해 같은 문자열을 다시 스캔하지 않는다.

clip/pass stack의 균형, layer·coordinate-space·order 범위, session/destination 중복, capture dependency를 packet validation에서 거부한다. capture source anchor는 참조한 command의 실제 sequence/layer/layer-order tuple과 정확히 일치해야 하며, 다른 offscreen session을 참조할 때는 그 session의 composite가 끝난 뒤여야 한다. Software backend는 linear/radial gradient와 중첩 scissor/rounded clip을 실제 raster하고, glyph run·textured mesh·pass는 계속 `placeholderCommands`로 계측한다. SDL_GPU/GLES의 고급 명령과 legacy overlay control도 아직 placeholder다. 파생 glyph/mesh bounds가 비유한 값이 되면 프레임 전체를 버리지 않고 결정적 진단 marker로 격리한다. 실제 atlas sampling, perspective-correct mesh, GPU gradient/clip, blur/glass pass를 구현해 production UI frame에서 이 값이 0이 되기 전에는 UI 렌더 완료로 보지 않는다.

## Windows 빌드와 검증

명령은 `C:\CirVivor\native`에서 실행한다. 로컬 Visual Studio 2026 환경은 다음 preset을 사용한다.

```powershell
cmake --preset windows-msvc-debug
cmake --build --preset windows-msvc-debug --parallel
ctest --preset windows-msvc-debug --output-on-failure

cmake --preset windows-msvc-release
cmake --build --preset windows-msvc-release --parallel
ctest --preset windows-msvc-release --output-on-failure
```

Ninja가 compiler 환경에서 검색 가능하면 `ninja-debug`와 `ninja-release` preset도 사용할 수 있다. SDL shell 없이 core만 빠르게 검사하려면 별도 build directory에 `-DCIRVIVOR_BUILD_SDL_APP=OFF`를 지정한다.

```powershell
cmake -S . -B build/headless -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCIRVIVOR_BUILD_SDL_APP=OFF
cmake --build build/headless --parallel
ctest --test-dir build/headless --output-on-failure
```

실행 수준 검증은 빌드 구성에 맞는 출력 폴더에서 수행한다.

```powershell
.\game_headless.exe --seed 42 --ticks 60
.\game_desktop.exe --smoke-test
.\game_desktop.exe --smoke-test-title --renderer software
.\game_desktop.exe --smoke-test-title-to-playable
.\game_desktop.exe --smoke-test-title-to-playable --renderer software
.\game_desktop.exe --playable-scene
.\game_desktop.exe --smoke-test --renderer sdl-gpu
.\game_desktop.exe --smoke-test --renderer gles
.\game_desktop.exe --smoke-test --renderer software
.\game_desktop.exe --smoke-test-render-recovery
.\software_renderer_benchmark.exe --gate
$env:SDL_VIDEODRIVER = 'dummy'
$env:SDL_RENDER_DRIVER = 'software'
$env:SDL_AUDIODRIVER = 'dummy'
.\game_desktop.exe --smoke-test
```

seed 42, 60 tick의 현재 headless 기준 hash는 `58e40b4174f11e95`다. 이 값은 테스트 계약을 의도적으로 변경할 때만 fixture와 함께 갱신한다.

`simulation_parity_tests`는 JS production `PhysicsBody2D`와 `TileMapCollisionResolver`로 고정한 800개 body × 240 tick oracle을 실행한다. `initialStateHash=83adf889c06a6f90`, 전체 tick record digest `0f701c9ea7aef6a2`, 최종 hash `ed129825bfe92c12`, tile probe `796220`, position correction `7055`, tick heap allocation `0`이 모두 맞아야 한다. authoritative 지수 마찰은 OS별 `std::exp` 결과를 사용하지 않고 V8 12.4/fdlibm 호환 `deterministicExp`를 사용한다.

`game_replay_parity_tests`는 실제 JS `GameSystem → GameObjectSystem → Tower → PhysicsBody2D → TileMapCollisionResolver` 기준과 같은 480 fixed tick 입력을 C++ 세션에 재생한다. static world `fd31f3c2801962f7`, initial state `9deef2f12bd1257d`, 전체 record digest `11fd486e39710bf6`, final state `748a6b36a9213900`, tile correction `4`, tick heap allocation `0`이 모두 맞아야 한다. 현재 oracle에 없는 RNG·투사체·일반 contact/event는 capability와 `null/0`으로 유지하며 구현된 것처럼 확장하지 않는다.

`movement_input_buffer_tests`는 짧은 down/up pulse, held input, repeat idempotence, 복수 alias source, focus/background에 대응하는 clear 계약을 검사한다. `sdl_platform_event_tests`는 mouse/touch/cancel/wheel, UTF-8 경계 절단, IME composition, focus clear와 dismissible window-close seam을 검사한다. `font_stack_tests`는 WOFF2/OFL hash, memory face, 누락 emoji asset 정책과 canonical 한국어/라틴 shaping을 검사한다. `playable_game_scene_tests`는 94-command 장면, 보간·safe area·DPI·capacity transaction과 반복 build의 무할당을 검사한다.

`title_overlay_state_machine_tests`는 가변 frame rate, 큰 delta 제한, Loading→Title carry, overlay open/close retarget, Debug pause/focus, UTF-8 URL 경계·scheme/authority와 플랫폼 acknowledge, exactly-once 종료 및 무할당 snapshot을 검사한다. `ui_layout_metrics_tests`는 16:9/ultrawide, zero-inset Desktop과 비대칭 Android safe-area, uiScale, light/dark token, 타이틀 entrance 중간값, exit/external geometry와 transactional invalid input을 검사한다.

`wat_scalar_parity_tests`는 production flow-field와 prepared-hexa-contact WAT의 raw 결과를 C++ scalar reference와 비교한다. flow는 f32 integration/direction bit, 8방향/corner-cut/heap tie와 전수·대형·난수 digest를, contact는 f64 body·f32 part·ordered u8 flag, 반경 배율 `0.765`, epsilon `1e-6`를 보존한다. 두 API 모두 생성 시 capacity를 고정하고 `build()`/`scan()` 중 C++ `new`가 0이어야 한다. 이는 범용 spatial grid·position solve·projectile 구현 완료를 의미하지 않는다.

Release `software_renderer_benchmark --gate`는 960×540 synthetic FramePacket을 60 frame warmup 뒤 180 frame 측정하고 render call nearest-rank p95 `33.33ms`를 강제한다. phase-37 pixel golden, 동적 phase checkpoint, command count와 FramePacket build+render 구간 C++ `new` 0회도 함께 검사한다. 이 실행 파일은 변동성 때문에 일반 CTest에는 넣지 않으며 CPU raster와 현재 placeholder command 성능만 나타낸다.

`--smoke-test`는 선택된 backend가 synthetic `FramePacket`을 처리한 뒤 기본 playback 장치의 open/pause/resume/close와 SDL user storage의 임시 파일 write/read-cap/read/remove/close까지 함께 검증한다. `--smoke-test-title-to-playable`은 실제 title frame, 열린 MapSelect shell frame, 새 `GameSystem`의 playable frame이 순서대로 render되는지 확인한다. `--smoke-test-render-recovery`는 background/foreground와 deferred metrics, target reset, device reset에 따른 backend/window 전체 재생성 및 최종 present를 추가로 검사한다. storage가 준비될 때까지 main callback에서 block 없이 폴링한다. 제품 실행에서는 audio 장치가 없는 환경을 치명 오류로 취급하지 않지만 smoke에서는 명시적인 실패다. dummy video에서 auto 선택은 SDL_GPU와 GLES 실패 후 Software로 내려가는 계약도 검증한다. 종료 시 renderer를 window보다 먼저 내리고 audio/storage/window를 SDL runtime보다 먼저 정리한다.

foreground에서는 backend context/device 복구가 resize보다 먼저다. background 중 metrics는 dirty 상태로만 저장하고, 0×0 drawable에서는 FramePacket build/render를 건너뛴다. render-target reset은 backend target 계약으로 처리하며 device reset/lost는 backend와 창을 다시 만든 뒤 실패 시 다음 후보로 내려간다. present 동기화를 보장하지 못하는 backend는 `RenderCapabilities::mainCallbackRateLimitHz`로 callback 상한을 선언한다.

## JS 기준선

명령은 `C:\CirVivor\project`에서 실행한다.

```powershell
npm test
npm run baseline:sdl
npm run baseline:sdl:legacy
npm run check:wasm:flow-field
npm run check:wasm:collision-contact
npm run test:render:golden
```

`baseline:sdl:update`와 `baseline:sdl:legacy:update`는 검증 명령이 아니라 fixture 재생성 명령이다. 상태 계약을 의도적으로 바꿨고 diff를 검토할 준비가 된 경우에만 사용한다. legacy fixture는 production `ObjectSystem.fixedUpdate()` 60틱의 spatial grid/candidate/3-pass solve/projectile/swap-pop/sleep 순서와 raw f32/f64 plane을 고정한다. 렌더 골든은 NW.js와 Windows 그래픽 실행 환경이 필요하므로 headless CI와 동일한 성격으로 취급하지 않는다.

## 변경 시 체크

1. 수정 대상 파일을 전체 읽고 소유 계층을 확인한다.
2. simulation 변경이면 JS replay/state hash와 C++ hash 범위를 먼저 정의한다.
3. SDL 타입이 `core/`나 backend 중립 render 계약으로 새지 않았는지 검색한다.
4. Debug와 Release에서 엄격 경고 빌드 및 CTest를 실행한다.
5. 창·lifecycle 변경이면 실제 video driver와 dummy/software smoke를 모두 실행한다.
6. `sdl_progess.md`에 새 완료 범위, 실패 원인, 검증 결과, 외부 환경 blocker를 반영한다.
7. `git diff --check`로 마무리한다.
