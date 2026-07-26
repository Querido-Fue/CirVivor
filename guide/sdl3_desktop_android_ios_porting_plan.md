# SDL3 기반 Desktop·Android·iOS 전환 및 3단계 렌더 품질 구현 계획

> **대상 코드베이스**: 업로드된 `code.zip`의 `game/` 프로젝트
> **참조 가이드**: 업로드된 `guide.zip`의 아키텍처·충돌·성능·이식 문서
> **작성 기준일**: 2026-07-27
> **권장 언어/표준**: C++20
> **권장 SDL 기준 버전**: SDL 3.4.10 고정 후, 별도 호환성 게이트를 통과한 경우에만 갱신
> **문서 상태**: 구현 착수용 상세 설계안
> **현재 실행 범위**: Desktop과 Android를 진행하며, iOS 빌드·서명·실기는 Mac 부재와 사용자 요청으로 현재 작업에서 제외한다.

---

## 목차

1. [핵심 결론](#1-핵심-결론)
2. [현재 코드베이스 진단](#2-현재-코드베이스-진단)
3. [목표와 비목표](#3-목표와-비목표)
4. [핵심 아키텍처](#4-핵심-아키텍처)
5. [렌더 백엔드와 품질 프로필의 분리](#5-렌더-백엔드와-품질-프로필의-분리)
6. [Full GPU: Ultra·High 구현](#6-full-gpu-ultrahigh-구현)
7. [Reduced GPU: Low GPU 구현](#7-reduced-gpu-low-gpu-구현)
8. [Software 구현](#8-software-구현)
9. [현재 효과별 이식 사양](#9-현재-효과별-이식-사양)
10. [셰이더 빌드 파이프라인](#10-셰이더-빌드-파이프라인)
11. [SDL3 플랫폼 계층](#11-sdl3-플랫폼-계층)
12. [Desktop·Android·iOS 빌드 구조](#12-desktopandroidios-빌드-구조)
13. [C++ 게임 코어 및 시뮬레이션 이식](#13-c-게임-코어-및-시뮬레이션-이식)
14. [멀티코어 설계](#14-멀티코어-설계)
15. [입력·저장·오디오·에셋 전환](#15-입력저장오디오에셋-전환)
16. [권장 디렉터리 구조](#16-권장-디렉터리-구조)
17. [단계별 구현 로드맵](#17-단계별-구현-로드맵)
18. [작업 패키지와 의존성](#18-작업-패키지와-의존성)
19. [테스트 및 성능 합격 기준](#19-테스트-및-성능-합격-기준)
20. [주요 위험과 대응](#20-주요-위험과-대응)
21. [최종 완료 정의](#21-최종-완료-정의)
22. [착수 직후 실행 순서](#22-착수-직후-실행-순서)
23. [참조한 현재 코드와 공식 자료](#23-참조한-현재-코드와-공식-자료)

---

# 1. 핵심 결론

## 1.1 권장 최종 형태

이 프로젝트는 다음 구조로 전환하는 것이 가장 안전하다.

```text
SDL3 Platform Host
  ├─ Window / Display / DPI / Safe Area
  ├─ Keyboard / Mouse / Touch / Gamepad / IME
  ├─ Audio / Storage / Lifecycle
  └─ Native Entry Point
          │
          ▼
C++ Game Core                    ← SDL 타입을 모르는 계층
  ├─ EngineShell
  ├─ Scene / GameSession
  ├─ Fixed 60 Hz Simulation
  ├─ Physics / AI / Projectile
  ├─ Save-domain state
  └─ PresentationSnapshot
          │
          ▼
Render Frontend                  ← 공통 RenderCommand 생성
          │
          ▼
Renderer Router
  ├─ SDL_GPU Backend             ← D3D12 / Metal / Vulkan
  ├─ OpenGL ES Compatibility     ← Android 광범위 호환 폴백
  └─ CPU Software Backend        ← SDL_Surface 기반
          │
          ▼
Effect Profile
  ├─ FullGpu                     ← Ultra / High 프리셋
  ├─ ReducedGpu                  ← Low GPU 프리셋
  └─ Software                    ← CPU 대체 효과
```

핵심은 **그래픽 API와 품질 등급을 같은 개념으로 취급하지 않는 것**이다.

- `SDL_GPU`에서도 Ultra, High, Low를 모두 실행할 수 있다.
- Android의 OpenGL ES 호환 백엔드에서도 High 또는 Low를 선택할 수 있다.
- CPU Software 백엔드는 Software 프로필만 사용한다.
- 게임 로직과 시뮬레이션은 어느 렌더 백엔드에서도 동일하다.

## 1.2 세 가지 효과 분리의 정확한 정의

사용자가 요청한 세 가지 분리는 다음처럼 구현한다.

| 효과 경로 | 사용자 설정 | 핵심 동작 |
|---|---|---|
| `FullGpu` | Ultra / High | 현재 GPU 셰이더 효과를 모두 유지한다. Ultra와 High는 해상도·샘플 수·캐시 정책만 다르다. |
| `ReducedGpu` | Low GPU | 셰이더는 사용하지만 blur 해상도·pass 수·샘플 수를 줄이고, 일부 실시간 갱신을 dirty 기반으로 바꾼다. |
| `Software` | Software | GPU 셰이더를 사용하지 않는다. CPU용 대체 표현, 30fps 표시, 낮은 내부 해상도와 캐시를 사용한다. |

`Ultra`와 `High`는 별도 렌더러가 아니라 **같은 Full GPU 효과 구현의 두 프리셋**이어야 한다. 그래야 효과 코드가 네 갈래로 분기되지 않는다.

## 1.3 Android에 대한 필수 보완 결정

SDL_GPU의 현재 백엔드는 D3D12, Metal, Vulkan이며 OpenGL 백엔드는 없다. Android에서는 Vulkan 기능 요구를 낮춰 지원 범위를 넓힐 수 있지만, 기기별 드라이버 편차 때문에 **SDL_GPU만으로 Android 전체 호환성을 보장하면 안 된다**.

따라서 권장 폴백 순서는 다음과 같다.

```text
1. SDL_GPU 생성 시도
   ├─ Desktop: D3D12 / Vulkan / Metal
   ├─ iOS: Metal
   └─ Android: optional Vulkan feature를 모두 끈 Vulkan

2. Android에서 SDL_GPU 실패 또는 안정성 블랙리스트 적중
   └─ SDL3로 생성한 OpenGL ES 3.0/2.0 context 사용

3. GPU 경로 생성 실패 또는 사용자가 강제 지정
   └─ Software 경로
```

이 OpenGL ES 경로는 SDL3를 대체하는 것이 아니다. 창, 입력, lifecycle, 오디오, 저장은 계속 SDL3가 담당하고, 그래픽 context만 SDL3의 GL API를 통해 만든다.

## 1.4 빅뱅 포팅 금지

전체 JavaScript를 한 번에 C++로 다시 작성하지 않는다. 다음 네 가지 결과물을 병렬로 만든 후 한 개의 playable vertical slice에서 통합한다.

1. **JS 기준 실행기(oracle)**: 기존 게임의 replay와 상태 hash를 출력한다.
2. **C++ headless core**: 렌더링 없이 같은 입력을 실행한다.
3. **SDL3 플랫폼 셸**: 창·입력·lifecycle·저장·오디오만 검증한다.
4. **렌더러 실험 장면**: 현재 셰이더와 Software 대체 효과를 같은 테스트 장면에서 비교한다.

---

# 2. 현재 코드베이스 진단

## 2.1 규모

업로드된 현재 프로젝트를 기준으로 확인한 규모는 다음과 같다.

| 항목 | 규모 |
|---|---:|
| 런타임 JavaScript | 355개 파일, 68,519줄 |
| 테스트·테스트 지원 `.mjs` | 95개 파일, 35,452줄 |
| 실제 `*.test.mjs` | 88개 |
| 주요 WebAssembly 원본 | WAT 2개 |

런타임 코드 중 주요 디렉터리 비중은 다음과 같다.

| 영역 | 파일 수 | 줄 수 | 해석 |
|---|---:|---:|---|
| `scene` | 85 | 15,470 | 장면·연출·타이틀·게임 흐름 |
| `object` | 48 | 10,926 | 적·투사체·AI·오브젝트 |
| `display` | 28 | 8,535 | Canvas2D·WebGL·화면 처리 |
| `physics` | 42 | 7,074 | 공간 그리드·충돌·해소 |
| `ui` | 27 | 7,007 | 공통 UI와 위젯 |
| `overlay` | 29 | 6,420 | 모달·유리 효과·오버레이 |
| `ingame` | 24 | 3,296 | 신규 게임 세션 구조 |
| `simulation` | 6 | 1,410 | fixed-step·시뮬레이션 보조 |

엔진 변경의 주된 비용은 시뮬레이션 자체보다 `scene + display + ui + overlay`를 다시 표현하는 데서 발생한다.

## 2.2 현재 프레임 구조

현재 핵심 흐름은 `script/main.js`와 `script/module/system_handler.js`에 집중되어 있다.

```text
requestAnimationFrame
  ├─ 실제 경과 시간 수집
  ├─ accumulator에 누적
  ├─ 60 Hz fixed tick 반복
  │    ├─ Animation fixed
  │    ├─ ObjectSystem fixed
  │    ├─ SceneSystem fixed
  │    └─ Game manager fixed
  ├─ 보간 alpha 계산
  ├─ 각 canvas/WebGL surface clear
  ├─ variable update
  ├─ draw
  └─ WebGL batch flush
```

이 구조의 다음 계약은 그대로 보존해야 한다.

- 시뮬레이션 권위는 60Hz fixed tick에 있다.
- 화면 표시는 이전·현재 상태 사이를 보간한다.
- 큰 지연 뒤 무제한 catch-up을 수행하지 않는다.
- scene·object·overlay의 업데이트 순서를 함부로 바꾸지 않는다.
- 렌더 프레임률이 30이더라도 시뮬레이션은 60Hz를 유지한다.

## 2.3 현재 렌더 레이어

`display/display_system.js`는 다음 일곱 개의 고정 surface와 동적 overlay surface를 사용한다.

```text
background   : WebGL batch
object       : WebGL batch
 effect      : WebGL effect
texteffect   : Canvas2D
ui           : Canvas2D
vignette     : Canvas2D persistent
top          : Canvas2D
+ 동적 overlay surfaces
```

현재 합성 순서는 대체로 다음과 같다.

```text
background
→ object
→ effect
→ texteffect
→ ui
→ vignette
→ dynamic overlay surfaces
→ top
```

새 구현에서는 이 레이어 순서를 보존하되, **레이어마다 별도 WebGL context나 별도 SDL window를 만들지 않는다**. 하나의 GPU device와 하나의 swapchain에서 logical layer와 offscreen texture를 사용한다.

## 2.4 현재 핵심 GPU 효과

현재 코드에서 별도 GPU pass가 확인되는 주요 효과는 다음과 같다.

- `magneticShield`
- `hexaMergeBoundary`
- `titleLoadingCircle`
- overlay backdrop capture
- Kawase downsample / upsample blur
- glass tint·edge·refraction·shadow
- vignette 및 각종 gradient·glow

특히 overlay와 title loading circle은 장면을 texture로 캡처하고 여러 pass의 blur를 수행한다. 이 부분이 Full GPU와 Low GPU 품질 차이를 만드는 핵심 지점이다.

## 2.5 현재 시뮬레이션 자산

현재 물리·AI 코드는 단순한 브라우저 게임 수준을 넘어 이미 데이터 지향 구조를 상당 부분 갖추고 있다.

- 60Hz fixed-step
- 공간 그리드 broad phase
- typed-array 기반 SoA
- candidate pair budget
- narrow phase와 위치 해소 분리
- projectile sweep
- sleep 및 관측 계약
- 객체 풀과 scratch buffer
- 선택적 WebAssembly kernel
- flow-field AI
- hexa hive·merge 로직

C++ 이식 시 이 구조를 버리고 적마다 `class Enemy`와 가상 함수, physics component를 붙이는 방식으로 바꾸면 오히려 성능이 낮아질 수 있다. 현재 배열 중심 구조를 C++의 연속 메모리로 옮겨야 한다.

## 2.6 브라우저·NW.js 결합 지점

현재 코드는 렌더러 외에도 다음 브라우저 API에 직접 의존한다.

- `document`, `window`
- `requestAnimationFrame`
- `HTMLCanvasElement`
- `CanvasRenderingContext2D`
- `WebGLRenderingContext`
- `Audio`
- `Image`, `Blob`
- NW.js window·shell·filesystem
- Node.js `fs`, `path`, `process.cwd()`

대표적인 전환 대상은 다음과 같다.

| 현재 파일/영역 | 현재 의존성 | 새 계층 |
|---|---|---|
| `main.js` | rAF, window focus, visibility | `SdlApp`, `FrameScheduler`, lifecycle event |
| `system_handler.js` | 전역 subsystem singleton | `EngineShell`과 명시적 ownership |
| `display/*` | Canvas2D·WebGL | `RenderFrontend`와 backend |
| `_screen_handler.js` | NW display/window | `DisplayService` |
| `input/*` | DOM keyboard/mouse/touch | `InputService` |
| `save/*` | Node filesystem | `StorageService` |
| `sound/sound_system.js` | HTML Audio | `AudioService` |
| `_svg_drawer.js` | DOM SVG·Blob·Image | 빌드 시 rasterization 또는 native decoder |
| `nw_bridge.js` | NW.js | 제거 |
| `runtime_tool.js` | NW shell/window/devtools | 플랫폼별 `RuntimeService` |

## 2.7 현재 테스트 기준선

현재 환경에서 다음 명령으로 실행했다.

```bash
node --experimental-vm-modules --test test/*.test.mjs
```

결과는 다음과 같다.

```text
총 423개
통과 422개
실패 1개
```

실패 1개는 게임 로직 실패가 아니라 `wabt` 패키지가 설치되지 않아 WAT 재빌드 일치 검사를 실행하지 못한 것이다. 포팅 착수 전 다음을 기준선으로 고정해야 한다.

- `wabt` 버전을 package lock에 고정한다.
- 기존 423개 테스트를 전부 통과시킨다.
- replay fixture와 golden image fixture를 추가한다.
- 이후 C++ 결과를 기존 JS 구현과 비교한다.

---

# 3. 목표와 비목표

## 3.1 목표

### 플랫폼 목표

- Windows x64/ARM64 중 제품 요구 범위
- macOS Apple Silicon 우선, 필요 시 Intel 검증
- Linux x64 우선
- Android ARM64 필수
- iOS arm64와 iOS simulator
- headless test executable

### 성능 목표

- 모든 모드에서 authoritative simulation 60Hz
- Full GPU: 60fps 기본, 충분한 환경에서 120fps 선택 가능
- Low GPU: 60fps 안정성 우선
- Software: 30fps 표시 허용, 시뮬레이션 60Hz 유지
- 모바일 장시간 실행에서 thermal throttling 이후에도 목표 프레임을 급격히 이탈하지 않음
- 적 수백 개와 투사체 수십~수백 개의 충돌·해소를 현재 게임 규칙과 동일하게 처리

### 구조 목표

- 게임 코어에서 SDL 타입, GPU 타입, 파일 경로 타입 제거
- 같은 `PresentationSnapshot`을 세 렌더 경로가 소비
- 동일 replay가 플랫폼과 worker 수에 관계없이 같은 gameplay 결과를 생성
- 에디터 없이 CLI로 build, test, shader compile, asset build, benchmark 실행

### 화면·UI parity 목표

- 기존 타이틀, HUD, 일시정지, 설정, 결과·게임오버와 모든 필수 오버레이를 빠짐없이 이식
- 장면 진입 조건, 입력 전이, 레이어 순서, 문구, 폰트 metrics, 색, 크기, anchor와 애니메이션 timing을 JS/NW.js oracle과 동일하게 유지
- Full GPU 경로는 고정 해상도·DPI·시간 상태의 장면별 render golden을 통과
- Reduced GPU와 Software도 UI 구성·geometry·텍스트·상태 전이는 동일하게 유지하고, 이 문서에 명시된 효과 품질 대체 외에는 요소를 생략하지 않음

## 3.2 비목표

초기 이식 범위에서 다음은 목표로 삼지 않는다.

- Software와 Ultra 사이의 blur sample·noise 같은 품질별 효과 픽셀 완전 일치. 단, 타이틀·UI·오버레이의 구성·geometry·텍스트·입력·상태 전이는 모든 품질 경로에서 동일해야 한다.
- 모든 레거시 모듈을 구조 변경 없이 1:1 번역
- SDL physics 또는 제3자 physics engine으로 현재 충돌 규칙 교체
- Android 전 기기에서 Ultra 강제 지원
- runtime shader compiler를 제품에 포함
- 첫 버전부터 collision position solve 전체를 병렬화
- DOM과 Canvas API를 흉내 내는 대형 호환 계층 구축
- 현재 사용하지 않는 레거시 기능까지 선제적으로 포팅

---

# 4. 핵심 아키텍처

## 4.1 계층 구조

```text
┌─────────────────────────────────────────────────────────────┐
│                     SDL3 Application Host                   │
│ SDL_AppInit / SDL_AppEvent / SDL_AppIterate / SDL_AppQuit  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                       PlatformServices                      │
│ Window · Display · Input · Audio · Storage · Clock · URL   │
│ Lifecycle · SafeArea · Clipboard · Diagnostics             │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                         EngineShell                         │
│ FrameScheduler · SceneSystem · GameSession · SaveCoordinator│
└──────────────────────────────┬──────────────────────────────┘
                               │ fixed input
┌──────────────────────────────▼──────────────────────────────┐
│                         GameCore                            │
│ Domain State · Simulation · Physics · AI · Projectile      │
│ Deterministic RNG · Command/Event · Replay/StateHash        │
└──────────────────────────────┬──────────────────────────────┘
                               │ PresentationSnapshot
┌──────────────────────────────▼──────────────────────────────┐
│                       RenderFrontend                        │
│ Camera · Culling · TextLayout · UI Layout · RenderCommands │
└──────────────────────────────┬──────────────────────────────┘
                               │ FramePacket
┌──────────────────────────────▼──────────────────────────────┐
│                       RendererRouter                        │
│ SDL_GPU Backend · GLES Backend · Software Backend          │
└─────────────────────────────────────────────────────────────┘
```

## 4.2 의존성 규칙

다음 규칙을 CI의 include 검사 또는 clang-tidy rule로 강제한다.

1. `core/`는 `SDL3/*` 헤더를 include할 수 없다.
2. `game/`은 renderer의 texture·shader·surface 타입을 알 수 없다.
3. renderer는 gameplay state를 직접 수정할 수 없다.
4. platform event는 정규화된 `InputEvent` 또는 `LifecycleEvent`로 변환된 뒤 core에 전달된다.
5. 저장 payload에는 포인터, SDL 타입, GPU handle을 넣지 않는다.
6. UI action은 domain command를 발행하고 domain object를 직접 변경하지 않는다.
7. `PresentationSnapshot`은 렌더 전용 복사본이며 시뮬레이션 권위 상태가 아니다.

## 4.3 주요 인터페이스 예시

```cpp
enum class RenderPath {
    FullGpu,
    ReducedGpu,
    Software
};

enum class QualityPreset {
    Ultra,
    High,
    LowGpu,
    Software
};

struct RenderCapabilities {
    bool modernGpu = false;
    bool gles = false;
    bool software = true;
    bool supportsFloatRenderTarget = false;
    bool supportsTimestampQuery = false;
    int maxTextureSize = 0;
    int maxSamples = 1;
    std::string backendName;
    std::string adapterName;
};

struct RenderSettings {
    QualityPreset preset = QualityPreset::High;
    float renderScale = 1.0f;
    float blurScale = 0.5f;
    int blurDownPasses = 3;
    int blurUpPasses = 3;
    bool liveBackdropBlur = true;
    bool glassRefraction = true;
    bool dynamicResolution = false;
    int presentationFps = 60;
};

class IRenderBackend {
public:
    virtual ~IRenderBackend() = default;
    virtual bool initialize(const RenderSettings& settings) = 0;
    virtual void resize(int drawableWidth, int drawableHeight) = 0;
    virtual void render(const FramePacket& frame) = 0;
    virtual void present() = 0;
    virtual void onBackground() = 0;
    virtual void onForeground() = 0;
    virtual void purgeTransientResources() = 0;
    virtual const RenderCapabilities& capabilities() const = 0;
};
```

## 4.4 `FramePacket` 계약

`FramePacket`은 현재 Canvas2D/WebGL 호출을 그대로 담는 구조가 아니라, 렌더 의도를 표현해야 한다.

```cpp
struct FramePacket {
    FrameId frameId;
    float interpolationAlpha;
    ViewportState viewport;
    std::span<const SpriteInstance> sprites;
    std::span<const ShapeInstance> shapes;
    std::span<const TextRun> textRuns;
    std::span<const LineInstance> lines;
    std::span<const EffectCommand> effects;
    std::span<const UiCommand> ui;
    OverlayFrame overlay;
};
```

이 구조 덕분에 다음이 가능하다.

- Full GPU는 sprite와 shape를 batch 처리한다.
- Low GPU는 같은 effect command를 저비용 shader variant로 처리한다.
- Software는 같은 command를 CPU rasterizer로 해석한다.
- 테스트에서는 `FramePacket`을 JSON 또는 binary fixture로 저장해 렌더러만 독립 검증한다.

## 4.5 SDL callback 기반 main loop

`SDL_MAIN_USE_CALLBACKS`를 사용해 Desktop·Android·iOS의 entry point와 lifecycle 차이를 SDL 쪽에 맡긴다.

```cpp
#define SDL_MAIN_USE_CALLBACKS 1
#include <SDL3/SDL.h>
#include <SDL3/SDL_main.h>

SDL_AppResult SDL_AppInit(void** appstate, int argc, char** argv);
SDL_AppResult SDL_AppEvent(void* appstate, SDL_Event* event);
SDL_AppResult SDL_AppIterate(void* appstate);
void SDL_AppQuit(void* appstate, SDL_AppResult result);
```

`SDL_AppIterate` 내부는 다음 정책을 따른다.

```cpp
SDL_AppResult Application::iterate() {
    const double now = clock_.seconds();
    double frameDelta = std::clamp(now - previousTime_, 0.0, maxFrameDelta_);
    previousTime_ = now;

    if (lifecycle_.isSuspended()) {
        accumulator_ = 0.0;
        return SDL_APP_CONTINUE;
    }

    accumulator_ += frameDelta;

    int ticks = 0;
    while (accumulator_ >= fixedDelta_ && ticks < maxCatchUpTicks_) {
        const InputSnapshot input = input_.consumeFixedSnapshot();
        core_.fixedStep(input, fixedDelta_);
        accumulator_ -= fixedDelta_;
        ++ticks;
    }

    if (ticks == maxCatchUpTicks_ && accumulator_ >= fixedDelta_) {
        schedulerTelemetry_.recordDroppedDebt(accumulator_);
        accumulator_ = std::fmod(accumulator_, fixedDelta_);
    }

    const float alpha = static_cast<float>(accumulator_ / fixedDelta_);

    if (presentationClock_.shouldRender()) {
        FramePacket frame = frontend_.buildFrame(core_, alpha);
        renderer_.render(frame);
        renderer_.present();
    }

    return quitRequested_ ? SDL_APP_SUCCESS : SDL_APP_CONTINUE;
}
```

Software 모드에서는 `presentationClock_`만 30Hz로 제한하고 fixed step은 60Hz로 유지한다.

---

# 5. 렌더 백엔드와 품질 프로필의 분리

## 5.1 두 축을 분리한다

### 렌더 백엔드

실제로 명령을 실행하는 API다.

- `SdlGpuBackend`
- `GlesBackend`
- `SoftwareBackend`

### 효과 프로필

동일한 효과를 어느 비용으로 표현할지 결정한다.

- `FullGpuEffectProfile`
- `ReducedGpuEffectProfile`
- `SoftwareEffectProfile`

백엔드와 프로필 조합은 다음과 같다.

| 백엔드 | Ultra | High | Low GPU | Software |
|---|---:|---:|---:|---:|
| SDL_GPU | 가능 | 가능 | 가능 | 사용하지 않음 |
| OpenGL ES | 일부 기기 가능 | 가능 | 가능 | 사용하지 않음 |
| CPU Software | 불가 | 불가 | 불가 | 가능 |

## 5.2 자동 선택 순서

```text
사용자 강제 설정 확인
  │
  ├─ software 강제 → SoftwareBackend
  │
  ├─ gles 강제 → GlesBackend
  │
  └─ auto / gpu
       │
       ├─ SDL_GPU device 생성
       │    ├─ 성공 → capability probe
       │    └─ 실패 → Android이면 GLES 시도
       │
       ├─ 시작 microbenchmark
       │    ├─ 충분 → High 또는 Ultra 후보
       │    ├─ 부족 → Low GPU
       │    └─ 심각한 실패 → Software
       │
       └─ first-frame boot marker 갱신
```

## 5.3 안전 부팅

드라이버 crash 또는 무한 검은 화면에 대비해 다음 파일을 user storage에 저장한다.

```json
{
  "bootAttempt": 17,
  "lastSuccessfulBackend": "sdl_gpu_vulkan",
  "lastSuccessfulPreset": "high",
  "pendingBackend": "sdl_gpu_vulkan",
  "pendingPreset": "ultra",
  "reachedFirstPresent": false
}
```

다음 실행 시 이전 실행이 `reachedFirstPresent=false`로 끝났다면 한 단계 낮은 경로로 부팅한다.

```text
Ultra → High → Low GPU → GLES Low → Software
```

이 기능은 모바일의 특정 드라이버 문제와 오래된 데스크톱 GPU 문제에 특히 중요하다.

## 5.4 사용자 설정

기존 `renderScale`, `disableTransparency`, `windowMode`, `uiScale`과 호환되는 새 schema를 둔다.

```json
{
  "schemaVersion": 2,
  "graphics": {
    "backend": "auto",
    "quality": "high",
    "renderScale": 1.0,
    "dynamicResolution": true,
    "targetFps": 60,
    "softwareInternalResolution": "960x540",
    "reduceTransparency": false
  }
}
```

`backend`와 `quality`는 별도 필드다. 예를 들어 Android에서 `backend=gles`, `quality=low` 조합이 가능해야 한다.

---

# 6. Full GPU: Ultra·High 구현

## 6.1 공통 원칙

- 현재 GPU 효과 종류를 모두 유지한다.
- 하나의 GPU device와 하나의 swapchain만 사용한다.
- 논리 레이어는 command ordering으로 표현한다.
- 장면 texture가 필요한 시점에만 offscreen render target을 만든다.
- texture·pipeline·sampler·buffer는 초기화 또는 cache miss 때만 생성한다.
- 프레임마다 pipeline과 render target을 생성하지 않는다.
- premultiplied alpha 규약을 전 renderer에서 통일한다.
- sRGB/linear 처리 규칙을 shader manifest에 명시한다.

## 6.2 권장 render graph

```text
[Upload / Dynamic Buffer Preparation]
            │
            ▼
[World Base Pass]
 background + object sprites + basic shapes
            │
            ▼
[World Procedural Effect Pass]
 magnetic shield + hexa merge boundary + gameplay effects
            │
            ▼
[Text Effect / World Text Pass]
            │
            ▼
[UI Base Pass]
            │
            ├──────────────┐
            │              │ overlay가 blur를 요구할 때만
            ▼              ▼
[Scene Color]       [Backdrop ROI Capture]
                           │
                           ▼
                   [Blur Downsample Chain]
                           │
                           ▼
                   [Blur Upsample Chain]
                           │
                           ▼
                   [Glass / Refraction Pass]
                           │
            ┌──────────────┘
            ▼
[Vignette + Top Layer + Final Composite]
            │
            ▼
[Swapchain Present]
```

현재처럼 각 레이어를 별도 canvas로 유지하지 않고, scene color와 필요한 일부 임시 texture만 사용한다.

## 6.3 Ultra와 High 차이

| 항목 | Ultra | High |
|---|---:|---:|
| 기본 world render scale | 1.00 | 0.90~1.00 동적 |
| UI render scale | native drawable | native drawable |
| backdrop blur scale | 0.50 또는 0.375 | 0.375 또는 0.25 |
| Kawase down pass | 최대 4 | 최대 3 |
| Kawase up pass | 최대 4 | 최대 3 |
| blur 갱신 | 요청 효과의 원래 정책 유지 | 움직임이 없는 overlay는 dirty/cache 허용 |
| glass refraction | 전체 | 전체, 샘플 수 축소 가능 |
| procedural noise | 전체 | 저주파 또는 sample 축소 |
| magnetic shield | 최고 sample/edge | sample 축소, 같은 효과 유지 |
| particles | 설계 최대값 | 적응형 cap 허용 |
| MSAA | capability와 비용 측정 후 2x/4x | 기본 off 또는 2x |
| 목표 표시 | 60/120 | 60 |

High에서도 효과 종류를 제거하지 않는다. Ultra와의 차이는 해상도, 샘플 수, 캐시 정책이다.

## 6.4 batching

현재 `WebGLBatch`의 최대 sprite 수와 shape atlas 개념을 C++로 옮긴다.

권장 배치 종류:

- sprite instance batch
- solid/procedural shape instance batch
- line/outline batch
- glyph atlas batch
- effect-specific instance batch

한 프레임의 instance 데이터를 persistently reused staging buffer에 기록하고 GPU buffer로 업로드한다. SDL_GPU에서는 가능한 한 프레임 초기에 upload를 완료하고, render pass 수와 state change를 줄인다.

## 6.5 텍스트와 UI

- 텍스트 layout은 공통 frontend에서 수행한다.
- glyph raster와 atlas upload는 renderer resource manager가 담당한다.
- UI는 world render scale과 분리해 drawable 기준으로 선명하게 그린다.
- Software와 GPU에서 같은 line break·alignment를 사용하도록 font metrics cache를 공통화한다.
- 정확한 pixel glyph는 플랫폼 글꼴 API가 아니라 패키지에 포함한 동일 font asset을 사용한다.

---

# 7. Reduced GPU: Low GPU 구현

## 7.1 목표

Low GPU는 단순히 전체 화면 해상도만 낮추는 모드가 아니다. fill-rate, render pass, texture bandwidth, shader sample 수를 함께 줄인다.

```text
유지할 것
- 게임 정보 전달
- 효과의 정체성
- UI 가독성
- 60Hz simulation
- 가능하면 60fps presentation

줄일 것
- backdrop texture 크기
- blur pass 수
- refraction sample 수
- 실시간 갱신 빈도
- 과도한 particles와 full-screen overdraw
```

## 7.2 권장 기본값

| 항목 | Low GPU 기본값 |
|---|---:|
| world render scale | 0.67~0.80 |
| UI render scale | 1.0 또는 0.9 |
| blur input scale | 0.25 |
| blur down pass | 1~2 |
| blur up pass | 1 |
| backdrop 갱신 | dirty 또는 최대 15~30Hz |
| glass refraction | 끄거나 단일 sample 변형 |
| live noise | texture lookup 또는 저빈도 갱신 |
| particles | High의 40~60% cap |
| shadow | 작은 kernel 또는 pre-baked |
| MSAA | off |
| 목표 표시 | 60fps, 실패 시 명시적 45/30 전환 |

## 7.3 blur 최적화

현재 overlay blur는 여러 down/up pass를 사용한다. Low GPU에서는 다음 순서로 비용을 줄인다.

1. overlay가 차지하는 rectangle만 capture한다.
2. capture 영역을 1/4 해상도로 축소한다.
3. down 1~2회, up 1회만 수행한다.
4. 배경 revision이 바뀌지 않으면 이전 blur texture를 재사용한다.
5. modal animation 중에도 매 프레임이 아니라 2프레임 또는 4프레임마다 갱신할 수 있다.
6. overlay가 닫히면 transient target을 cache pool로 돌려보낸다.

## 7.4 Low 전용 shader variant

다음 define 또는 별도 pipeline variant를 사용한다.

```text
QUALITY_FULL
QUALITY_REDUCED
```

예시:

```hlsl
#if QUALITY_FULL
    const int SAMPLE_COUNT = 8;
    float distortion = SampleAnimatedNoise(...);
#else
    const int SAMPLE_COUNT = 3;
    float distortion = SampleStaticNoise(...);
#endif
```

분기 값은 frame마다 uniform으로 바꾸기보다 pipeline 생성 시 variant로 고정해 GPU 분기 비용과 shader 복잡도를 줄인다.

## 7.5 동적 품질 저하

Low GPU에서도 일정 시간 frame budget을 초과하면 순차적으로 낮춘다.

```text
1. world render scale 0.80 → 0.72 → 0.67
2. blur update 30Hz → 15Hz
3. blur down pass 2 → 1
4. particles 60% → 40%
5. refraction off
6. presentation 60 → 45 또는 30
```

상향 복구에는 긴 안정 구간과 hysteresis를 적용해 품질이 계속 흔들리지 않게 한다.

---

# 8. Software 구현

## 8.1 Software 모드의 의미

Software 모드는 다음 두 가지를 구분해야 한다.

### Desktop의 실제 GPU 없는 환경

- CPU에서 `SDL_Surface` 또는 자체 pixel buffer에 rasterize한다.
- window surface 또는 software renderer를 통해 표시한다.
- 셰이더 실행을 요구하지 않는다.
- headless에서는 같은 buffer를 PNG fixture 또는 stream으로 출력할 수 있다.

### Android·iOS의 Software 품질 모드

모바일 OS의 최종 compositor 자체는 일반적으로 GPU를 사용한다. 따라서 모바일 Software 모드는 **게임 효과와 rasterization을 CPU에서 수행하되**, 마지막 pixel buffer 표시만 매우 단순한 streaming texture 또는 플랫폼 표면을 사용할 수 있다.

즉, 모바일에서의 Software는 “시각 효과가 shader에 의존하지 않는 경로”이며, 물리적으로 GPU가 완전히 고장 난 기기까지 제품이 동작한다는 보장은 아니다.

## 8.2 기본 사양

| 항목 | Software 기본값 |
|---|---:|
| authoritative simulation | 60Hz |
| presentation | 30fps |
| 기본 내부 해상도 | 960×540 |
| 저사양 내부 해상도 | 640×360 |
| UI 기준 해상도 | 논리 1920×1080, 내부 raster에 맞춰 layout |
| pixel format | ARGB8888 또는 검증된 32-bit format |
| alpha | premultiplied alpha 통일 |
| 렌더 방식 | tile/dirty-region 기반 CPU raster |
| 후처리 | 대체 효과 또는 cache된 저해상도 CPU filter |

## 8.3 Software renderer 구조

```text
FramePacket
   │
   ▼
SoftwareCommandClassifier
   ├─ Opaque sprite/shape
   ├─ Alpha sprite/shape
   ├─ Text
   ├─ Overlay
   └─ CPU effect replacement
   │
   ▼
Tile Binner (예: 32×32 또는 64×64)
   │
   ▼
Worker Jobs
   ├─ 각 tile의 opaque draw
   ├─ alpha composite
   └─ 제한된 local effect
   │
   ▼
Internal SDL_Surface
   │
   ▼
Scale/Present
```

Software 모드에서는 렌더링도 멀티코어화할 수 있지만, simulation worker와 코어를 경쟁하지 않도록 별도 budget을 둔다.

## 8.4 CPU 렌더 최적화 원칙

- 화면 전체를 매번 blur하지 않는다.
- 정적인 배경과 UI panel을 cache한다.
- glyph와 shadow를 atlas 또는 bitmap cache로 유지한다.
- draw command를 texture·blend mode별로 정렬하되 layer 순서는 보존한다.
- alpha가 0인 command와 화면 밖 command를 frontend에서 제거한다.
- 큰 반투명 fullscreen quad 수를 제한한다.
- 애니메이션이 없는 영역은 dirty rectangle에서 제외한다.
- 임시 vector, string, surface를 프레임마다 생성하지 않는다.
- 내부 해상도 확대는 nearest/bilinear 중 설정 가능하게 한다.

## 8.5 CPU blur 정책

Software에서 실시간 backdrop blur를 Ultra와 동일하게 재현하지 않는다.

우선순위는 다음과 같다.

1. **기본값**: blur 없는 tint + edge + shadow panel
2. **선택적 품질**: 배경이 정지한 순간에만 1/4 해상도 box blur 생성
3. **작은 영역**: overlay ROI만 separable box/stack blur
4. **절대 금지**: 960×540 전체를 매 30fps마다 다중 Kawase pass로 처리

## 8.6 Software 30fps와 입력 응답성

화면을 30fps로 표시해도 입력 sampling과 simulation은 60Hz로 유지한다.

```text
0 ms   : input sample + fixed tick
16.7 ms: input sample + fixed tick
33.3 ms: input sample + fixed tick + render/present
```

UI hover·cursor 표시가 지나치게 느려 보이면 cursor 또는 touch feedback만 별도 저비용 overlay로 더 자주 갱신하는 방식을 검토할 수 있다. 초기 구현은 단순성을 위해 전체 30fps로 시작한다.

---

# 9. 현재 효과별 이식 사양

## 9.1 효과 대응표

| 현재 효과 | Full GPU | Low GPU | Software |
|---|---|---|---|
| Magnetic Shield | 현재 procedural shader 수학을 HLSL/GLSL ES로 이식, full sample·noise·edge | sample 축소, noise texture 저빈도 갱신, 작은 render scale | 미리 생성한 ring/hex texture + alpha pulse + CPU outline |
| Hexa Merge Boundary | 거리장/경계 shader와 glow 유지 | 단일 outline pass, glow 폭 축소 | polygon line·점선·색 pulse |
| Title Loading Circle | scene capture, blur, glow, refraction 전체 | 1/4 capture, down 1~2/up 1, refraction 축소 | ring sprite sequence 또는 CPU arc, 배경 blur 제거 |
| Overlay Backdrop Blur | ROI capture, 3~4 down/up, dirty/always 원래 계약 | 1/4~1/8, down 1~2/up 1, 15~30Hz 갱신 | tint panel, 선택적 dirty 시 1회 CPU blur |
| Glass Panel | tint·edge·refraction·shadow | tint·edge·약한 distortion, shadow 축소 | 9-slice 또는 round rect + border + cached shadow |
| Vignette | shader 또는 native-res texture | cache된 낮은 해상도 texture | cache된 radial mask를 alpha composite |
| Gradient | shader/vertex color | vertex color·간단 shader | scanline 또는 precomputed gradient bitmap |
| Glow | multi-pass 또는 SDF | 작은 kernel/atlas glow | pre-baked halo sprite |
| Text Shadow | shader/SDF 또는 glyph pass | sample 축소 | glyph bitmap cache에 포함 |

## 9.2 Magnetic Shield

### Full GPU

- 현재 shape geometry와 shader uniform 의미를 보존한다.
- world-space와 screen-space 값의 단위를 명시한다.
- animation time은 simulation time과 presentation time 중 어느 것을 쓰는지 계약으로 고정한다.
- 투명 합성은 premultiplied alpha로 통일한다.

### Low GPU

- shield instance를 별도 작은 texture에 렌더한 뒤 sprite로 합성하는 cache 모드를 제공한다.
- 화면에서 작은 shield에는 저샘플 variant를 사용한다.
- noise는 procedural 계산보다 반복 texture lookup을 우선한다.

### Software

- 8~16장의 animation atlas 또는 매개변수화된 ring bitmap을 사용한다.
- 색 pulse와 scale pulse만 실시간 계산한다.
- shield가 겹칠 때 alpha overdraw가 커지지 않도록 screen-space tile culling을 적용한다.

## 9.3 Hexa Merge Boundary

- gameplay 판정 geometry와 시각 geometry를 분리한다.
- 시각 경계가 없어도 merge 판정은 동일해야 한다.
- Software에서는 정확한 shader pattern 대신 polygon outline과 주기적 밝기 변화로 상태를 전달한다.

## 9.4 Overlay Glass

현재 가장 비용이 큰 효과이므로 독립적인 `BackdropService`로 분리한다.

```cpp
struct BackdropRequest {
    RectI sourceRect;
    RectI destinationRect;
    BackdropUpdateMode updateMode;
    EffectQuality quality;
    float blurRadius;
    float refractionStrength;
    uint64_t sourceRevision;
};
```

같은 source revision과 rectangle을 요구하는 overlay는 결과를 공유한다. overlay마다 독립 blur chain을 만들지 않는다.

---

# 10. 셰이더 빌드 파이프라인

## 10.1 기본 결정

- 제품 실행 중 shader source를 컴파일하지 않는다.
- build 단계에서 모든 플랫폼 형식으로 변환하고 검증한다.
- SDL_GPU용 canonical source는 HLSL을 권장한다.
- 현재 WebGL GLSL은 이식의 시각 기준이자 GLES 구현의 출발점으로 사용한다.
- HLSL과 GLSL ES wrapper가 공유하는 uniform·상수 layout을 manifest로 관리한다.

## 10.2 산출물

```text
assets/shaders/src/
  common/
    color_math.hlsli
    blur_common.hlsli
    effect_constants.json
  overlay_glass.hlsl
  magnetic_shield.hlsl
  hexa_merge_boundary.hlsl
  title_loading_circle.hlsl

assets/shaders/gles/
  overlay_glass.vert.glsl
  overlay_glass.frag.glsl
  ...

generated/shaders/
  dxil/
  spirv/
  msl/
  metallib/
  reflection/
  shader_manifest.json
```

## 10.3 SDL_shadercross 사용

SDL_shadercross CLI를 build tool로 사용해 HLSL 또는 SPIR-V에서 다음 형식을 생성한다.

- DXIL 또는 DXBC
- SPIR-V
- MSL 또는 Metal library 제작 입력
- 필요한 HLSL 변형

GLES는 SDL_GPU backend가 아니므로 별도 GLSL ES source를 유지한다. 초기에는 현재 WebGL shader를 수동 정리해 GLES source로 사용하고, 이후 필요하면 SPIRV-Cross 기반 자동 생성 도구를 별도 검토한다.

## 10.4 shader manifest

각 shader는 다음 정보를 생성한다.

```json
{
  "name": "overlay_glass",
  "stage": "fragment",
  "entryPoint": "main",
  "uniformSize": 64,
  "samplers": ["sceneColor", "blurredBackdrop", "noise"],
  "storageBuffers": [],
  "blendMode": "premultiplied_alpha",
  "colorSpace": "linear_input_srgb_output",
  "variants": ["QUALITY_FULL", "QUALITY_REDUCED"],
  "layoutHash": "..."
}
```

런타임은 shader code를 introspection하는 대신 이 manifest를 읽어 pipeline을 만든다.

## 10.5 CI 검증

각 commit에서 다음을 수행한다.

1. 모든 shader source compile
2. 모든 target format 생성
3. reflection layout과 C++ struct size 비교
4. 금지된 runtime binding mismatch 검사
5. shader test scene 렌더
6. golden image와 perceptual diff
7. Full/Reduced variant가 모두 존재하는지 검사

---

# 11. SDL3 플랫폼 계층

## 11.1 PlatformServices 구성

```cpp
struct PlatformServices {
    IClock& clock;
    IWindowService& window;
    IDisplayService& display;
    IInputService& input;
    IAudioService& audio;
    IStorageService& storage;
    ILifecycleService& lifecycle;
    IRuntimeService& runtime;
    IDiagnosticsService& diagnostics;
};
```

게임 로직은 이 interface의 좁은 기능만 사용한다. SDL event와 handle은 구현 내부에 숨긴다.

## 11.2 lifecycle 처리

다음 SDL event를 최소한 처리한다.

- terminating
- low memory
- will enter background
- did enter background
- will enter foreground
- did enter foreground
- display orientation changed
- window pixel size changed
- focus gained/lost
- audio device changed

### Background 진입

```text
1. 새 input command 차단
2. 현재 save transaction 완료 또는 journal 기록
3. user storage close/flush
4. audio pause
5. renderer transient command 종료
6. fixed accumulator 0으로 초기화
7. GPU resource는 플랫폼 정책에 따라 유지 또는 release 가능 상태로 표시
```

### Foreground 복귀

```text
1. clock 기준 시간 재설정
2. 입력 상태 전부 release 상태로 재동기화
3. drawable size·orientation·safe area 갱신
4. GPU device/swapchain/resource 유효성 확인
5. audio resume
6. 다음 프레임 전체 redraw
```

특히 iOS에서는 background 진입 이후 계속 화면을 그리는 구조를 피한다.

## 11.3 main-thread 규칙

- SDL window·video·GPU device 관련 API는 main thread에서 호출한다.
- simulation worker는 SDL event pump나 window API를 호출하지 않는다.
- worker가 main thread 작업을 요구하면 lock-free 또는 bounded queue에 command를 기록한다.
- shader·texture resource 생성도 기본적으로 render/main thread에서 수행한다.

## 11.4 고해상도와 viewport

현재 `_screen_handler.js`의 다음 개념을 보존한다.

- 논리 16:9 UI 좌표
- widescreen extension
- letterbox
- world/object offset
- render scale
- UI scale

새 좌표는 다음 네 공간을 명시적으로 구분한다.

```text
Physical Pixels
Drawable Pixels
Logical UI Coordinates
World Coordinates
```

모바일에서는 safe area inset을 `ViewportState`에 포함한다.

```cpp
struct ViewportState {
    SizeI drawableSize;
    RectI contentRect;
    InsetsI safeArea;
    float dpiScale;
    float uiScale;
    float worldRenderScale;
    Mat3 worldToScreen;
    Mat3 screenToWorld;
};
```

---

# 12. Desktop·Android·iOS 빌드 구조

## 12.1 공통 CMake target

```text
game_core              STATIC
render_frontend         STATIC
renderer_common         STATIC
renderer_sdl_gpu        STATIC
renderer_gles           STATIC
renderer_software       STATIC
platform_sdl            STATIC
game_tests              EXECUTABLE
game_headless           EXECUTABLE
```

플랫폼별 최종 target만 다르게 만든다.

## 12.2 Desktop

```text
Windows/Linux/macOS
  └─ game_desktop executable
       ├─ game_core
       ├─ platform_sdl
       ├─ renderer_sdl_gpu
       ├─ renderer_gles (필요 플랫폼만)
       └─ renderer_software
```

Desktop CI preset 예시:

```text
windows-msvc-debug
windows-msvc-release
linux-clang-debug
linux-clang-release
macos-arm64-debug
macos-arm64-release
headless-asan
headless-tsan
```

## 12.3 Android

SDL 공식 Android 구조에 맞춰 최종 게임 target을 shared library `main`으로 만든다.

```cmake
if(ANDROID)
    add_library(main SHARED ${APP_SOURCES})
else()
    add_executable(game_desktop ${APP_SOURCES})
endif()
```

권장 구조:

```text
platform/android/
  app/
    build.gradle
    src/main/AndroidManifest.xml
    src/main/java/<package>/GameActivity.java
    src/main/assets/
  settings.gradle
  gradle.properties
```

SDL3 AAR + Prefab 또는 SDL source를 CMake subproject로 포함할 수 있다. 제품 build 재현성을 위해 다음 중 하나를 선택해 고정한다.

- 검증된 SDL3 AAR를 checksum과 함께 vendor
- SDL source tag를 submodule로 고정하고 NDK로 함께 build

### Android SDL_GPU 생성 정책

```text
preferLowPower = true
clipDistance = false
depthClamping = false
indirectFirstInstance = false
anisotropy = false
```

위 optional Vulkan feature를 끈 상태로 시작하고, 실제 프로젝트가 필요로 하는 기능만 이후 다시 켠다.

### Android GLES 폴백

- GLES 3.0을 먼저 시도한다.
- 실패 시 지원 범위에 따라 GLES 2.0을 시도한다.
- GLES 2.0에서는 texture format과 uniform 제한을 고려해 Reduced GPU만 허용한다.
- backend와 adapter 정보를 진단 로그에 남긴다.

## 12.4 iOS

권장 구조:

```text
platform/ios/GameApp.xcodeproj
  ├─ App entry / Info.plist / icons / launch assets
  ├─ SDL3.xcframework
  ├─ game_ios static library
  └─ packaged game assets
```

- SDL3.xcframework를 Embed & Sign한다.
- C++ 게임 코어는 CMake 또는 Xcode target으로 static library를 생성한다.
- iOS renderer는 SDL_GPU Metal을 기본 경로로 한다.
- iOS simulator와 device shader binary를 모두 CI에서 검증한다.
- save는 bundle 내부가 아니라 user storage를 사용한다.
- safe area, home indicator, interruption, audio route 변경을 테스트한다.

## 12.5 dependency pinning

```text
third_party/manifest.lock
  SDL          3.4.10 + checksum/tag
  SDL_image    필요 시 고정
  SDL_ttf      필요 시 고정
  SDL_mixer    필요 시 고정
  shadercross  검증 commit/tag 고정
  json library 검증 version 고정
  test framework 검증 version 고정
```

`main` branch를 직접 따라가지 않고 검증된 tag 또는 commit을 고정한다.

---

# 13. C++ 게임 코어 및 시뮬레이션 이식

## 13.1 이식 우선순위

렌더러와 무관한 순서로 다음을 옮긴다.

1. 수학 타입과 deterministic RNG
2. 시간·fixed scheduler 계약
3. save-domain schema와 ID 체계
4. 공간 그리드와 body SoA
5. candidate pair 생성
6. narrow phase
7. position solve
8. projectile sweep
9. 적 이동·AI intent
10. hexa hive·merge
11. damage·death·spawn commit
12. GameSession과 scene/domain flow
13. presentation snapshot 생성

## 13.2 JS oracle

기존 JS 구현을 즉시 폐기하지 않고 기준 실행기로 유지한다.

각 fixed tick에서 다음을 기록한다.

```json
{
  "tick": 12345,
  "inputHash": "...",
  "rngState": "...",
  "entityCount": 811,
  "projectileCount": 57,
  "contactCount": 362,
  "stateHash": "...",
  "eventsHash": "..."
}
```

C++ headless executable이 같은 replay를 읽고 비교한다.

## 13.3 숫자 정밀도

초기 parity 단계에서는 현재 JavaScript Number와 가까운 다음 정책을 권장한다.

- authoritative position/velocity: `double`
- timer와 accumulator: `double`
- render snapshot: 필요 시 `float`
- 색·UV·GPU instance: `float`
- entity index·generation: 명시적 고정 폭 정수

성능 측정 후 일부 배열을 `float`로 낮추는 것은 별도 변경으로 처리한다. parity 이식과 정밀도 변경을 동시에 하지 않는다.

## 13.4 SoA 예시

```cpp
struct EnemySoA {
    std::vector<double> positionX;
    std::vector<double> positionY;
    std::vector<double> velocityX;
    std::vector<double> velocityY;
    std::vector<double> radius;
    std::vector<float> health;
    std::vector<uint32_t> flags;
    std::vector<uint32_t> generation;
    std::vector<uint16_t> type;
};
```

실제 구현에서는 capacity를 미리 확보하고 tick 중 resize를 금지한다. 필요하면 aligned allocator와 packed free-list를 사용한다.

## 13.5 이벤트와 commit

worker가 gameplay state를 직접 변경하기보다 thread-local event를 만든다.

```cpp
struct DamageEvent {
    EntityId source;
    EntityId target;
    float amount;
    uint32_t sequence;
};
```

commit 단계에서 stable key로 정렬한 뒤 적용한다.

```text
tick → source id → target id → event type → local sequence
```

## 13.6 렌더 snapshot

시뮬레이션 배열을 renderer가 직접 읽지 않는다.

```text
Simulation State
   │ fixed tick 종료
   ▼
PresentationSnapshot A 작성
   │ atomic publish
   ▼
Renderer가 Snapshot B 읽기
```

초기 구현은 double buffer로 충분하다. render와 simulation thread를 완전히 분리할 경우 triple buffer를 검토한다.

## 13.7 현재 모듈 매핑

| 현재 경로 | 새 경로 | 처리 방식 |
|---|---|---|
| `script/main.js` | `src/app/sdl_app.cpp` | 재작성 |
| `time_handler.js` | `src/engine/frame_scheduler.*` | 계약 이식 |
| `module/system_handler.js` | `src/engine/engine_shell.*` | ownership 재설계 |
| `module/simulation/` | `src/core/simulation/` | C++ 이식 |
| `module/physics/` | `src/core/physics/` | SoA·순서 보존 이식 |
| `module/object/enemy/ai/` | `src/core/ai/` | data-oriented 이식 |
| `module/object/projectile/` | `src/core/projectile/` | sweep·pool 보존 |
| `module/ingame/` | `src/game/session/` | 신규 target architecture 우선 |
| `module/scene/` | `src/game/scenes/` | 사용 기능별 선택 이식 |
| `module/display/` | `src/render/` | command frontend + backend로 재작성 |
| `module/ui/` | `src/presentation/ui/` | layout·command 이식 |
| `module/overlay/` | `src/presentation/overlay/` | state와 effect 분리 |
| `module/input/` | `src/platform/sdl/input/` | SDL event 변환 |
| `module/save/` | `src/platform/sdl/storage/` + `src/game/save/` | I/O와 schema 분리 |
| `module/sound/` | `src/platform/sdl/audio/` | native audio 전환 |
| `util/nw_bridge.js` | 없음 | 제거 |
| `util/runtime_tool.js` | `IRuntimeService` | 필요한 기능만 재구현 |

현재 `ingame` 가이드의 `GameScene → GameSystem → GameStateStore/Command/Event` 방향을 새 C++ 구조의 기준으로 삼고, 오래된 전역 `ObjectSystem` 구조를 그대로 복제하지 않는다.

---

# 14. 멀티코어 설계

## 14.1 원칙

- 고정 크기 worker pool을 사용한다.
- tick마다 thread를 만들고 파괴하지 않는다.
- main/render thread는 SDL video와 GPU 제출을 담당한다.
- simulation job은 SDL API를 호출하지 않는다.
- worker 수가 달라도 gameplay 결과가 같아야 한다.
- 모바일에서는 코어를 전부 점유하지 않는다.

## 14.2 1차 병렬화 단계

```text
[Serial] input snapshot / tick setup
       │
       ├─ [Parallel] AI intent
       ├─ [Parallel] movement prediction
       ├─ [Parallel] body/AABB construction
       ├─ [Parallel] spatial grid count
       ├─ [Parallel] spatial grid fill
       ├─ [Parallel] candidate pair generation
       ├─ [Parallel] narrow phase/contact generation
       └─ [Parallel] projectile query
       │
[Serial] stable merge / pair budget application
[Serial] position solve
[Serial] damage/lifecycle/merge/spawn commit
[Parallel or Serial] render snapshot packing
```

이 단계에서 위치 해소를 직렬로 남긴다. 동일 body를 여러 contact가 수정하는 data race를 피하고 기존 결과 순서를 보존하기 위해서다.

## 14.3 spatial grid 병렬화

두 단계 방식이 안전하다.

```text
1. 각 worker가 local cell count 계산
2. prefix sum으로 worker별 write range 계산
3. 각 worker가 겹치지 않는 range에 entity index 기록
```

공유 cell vector에 mutex로 push하는 방식은 피한다.

## 14.4 candidate와 contact 병합

각 worker가 local buffer를 사용한다.

```cpp
struct WorkerScratch {
    FixedVector<Pair, MaxPairsPerWorker> pairs;
    FixedVector<Contact, MaxContactsPerWorker> contacts;
    FixedVector<DamageEvent, MaxDamageEventsPerWorker> damage;
};
```

병합은 worker ID와 stable pair key 순서로 수행한다. work stealing을 사용하더라도 최종 정렬 키는 deterministic해야 한다.

## 14.5 2차 병렬화 후보

position solve가 새 병목이 된 경우에만 다음을 검토한다.

- contact graph coloring
- island 분리 후 island 단위 병렬화
- thread-local position delta 후 고정 순서 reduce

이 변경은 collision feel을 바꿀 수 있으므로 별도 replay·게임 감각 검증을 요구한다.

## 14.6 worker 수 정책

초기 자동값:

| 환경 | simulation worker 권장 시작값 |
|---|---:|
| 2 logical cores | 1 |
| 4 logical cores | 2 |
| 6~8 logical cores | 2~3 |
| 12+ logical cores Desktop | 3~4 |
| Software 렌더 활성 | simulation에 과도한 코어 할당 금지 |

`hardware_concurrency - 1`을 무조건 사용하는 방식은 피한다. 모바일 big.LITTLE과 Software renderer 경쟁을 고려해 benchmark 결과로 선택한다.

## 14.7 멀티코어 합격 조건

- 1·2·4 worker replay state hash 일치
- ThreadSanitizer에서 data race 없음
- tick 중 worker scratch heap allocation 없음
- 2 worker가 1 worker보다 p95를 악화시키지 않음
- worker wait가 fixed budget의 큰 비율을 차지하지 않음
- mobile foreground/background 전환 중 worker가 안전하게 정지·재개됨

---

# 15. 입력·저장·오디오·에셋 전환

## 15.1 입력

현재 action mapping 개념을 유지하고 SDL event를 직접 gameplay code에 전달하지 않는다.

```text
SDL_Event
  → RawInputState
  → Device-normalized InputAction
  → Fixed-tick InputSnapshot
  → Game command
```

지원 대상:

- keyboard
- mouse
- touch
- gamepad
- text input/IME
- window focus

모바일에서는 UI button이 virtual action을 발행하도록 한다. world touch와 UI touch의 ownership을 pointer ID 기준으로 고정한다.

## 15.2 저장

현재 `process.cwd()/save`와 Node `fs.promises` 의존성을 제거한다.

권장 구조:

```text
Game Save Schema
  ├─ SettingsDocument
  ├─ ProgressDocument
  └─ IngameDocument
           │
           ▼
SaveCoordinator
  ├─ migration
  ├─ validation
  ├─ backup/journal
  └─ serialization
           │
           ▼
IStorageService
           │
           ▼
SDL_OpenUserStorage
```

저장 순서:

```text
1. JSON/binary payload를 메모리에서 완성
2. validation과 checksum 계산
3. temporary/journal 파일 기록
4. 기존 파일 backup
5. atomic rename을 지원하면 교체
6. storage close로 flush
```

플랫폼 backend가 rename을 제공하지 않는 경우 custom journal recovery를 사용한다.

## 15.3 오디오

현재 HTML `Audio`와 autoplay unlock listener를 제거한다.

필요 기능:

- BGM stream
- SFX voice pool
- master/music/effect volume
- device change
- pause/resume
- mobile interruption
- focus loss 정책

SDL3 audio stream 또는 SDL_mixer 3 중 하나를 선택한다. 현재 MP3 BGM과 SFX 요구가 단순하다면 SDL_mixer를 먼저 평가하되, 프로젝트 wrapper인 `IAudioService` 밖으로 API를 노출하지 않는다.

## 15.4 PNG·SVG·폰트

### PNG

- 패키지 asset으로 포함한다.
- decode 결과와 premultiplied alpha 정책을 고정한다.
- texture atlas를 build 단계에서 생성할 수 있다.

### SVG

현재 DOM SVG→Blob→Image 경로는 제거한다.

우선순위:

1. 빌드 시 필요한 크기의 PNG/SDF로 rasterize
2. 색 변형이 필요한 icon은 단순 vector command로 변환
3. runtime SVG decoder는 정말 필요한 경우에만 도입

### 폰트

현재 WOFF2와 CSS font loading은 native에서 직접 사용할 수 없다.

- 원본 TTF/OTF를 확보한다.
- 라이선스와 재배포 권한을 확인한다.
- 필요한 glyph subset과 atlas를 build한다.
- 한국어 glyph가 많으므로 동적 glyph atlas와 eviction 정책을 설계한다.
- Software와 GPU가 같은 glyph raster 결과를 공유하게 한다.

## 15.5 에셋 manifest

```json
{
  "version": 1,
  "textures": {
    "ui/icon_settings": {
      "file": "atlas_ui.ktx_or_png",
      "rect": [0, 0, 64, 64],
      "premultiplied": true
    }
  },
  "fonts": {},
  "audio": {},
  "shaders": {},
  "contentHash": "..."
}
```

모든 플랫폼에서 같은 logical asset ID를 사용한다.

---

# 16. 권장 디렉터리 구조

```text
native/
├─ CMakeLists.txt
├─ CMakePresets.json
├─ cmake/
│  ├─ Dependencies.cmake
│  ├─ Shaders.cmake
│  ├─ Assets.cmake
│  └─ Warnings.cmake
│
├─ src/
│  ├─ app/
│  │  ├─ sdl_app.cpp
│  │  ├─ application.cpp
│  │  └─ boot_policy.cpp
│  │
│  ├─ engine/
│  │  ├─ engine_shell.cpp
│  │  ├─ frame_scheduler.cpp
│  │  └─ scene_system.cpp
│  │
│  ├─ core/
│  │  ├─ math/
│  │  ├─ ids/
│  │  ├─ rng/
│  │  ├─ simulation/
│  │  ├─ physics/
│  │  ├─ ai/
│  │  ├─ projectile/
│  │  ├─ jobs/
│  │  ├─ replay/
│  │  └─ state_hash/
│  │
│  ├─ game/
│  │  ├─ session/
│  │  ├─ scenes/
│  │  ├─ domain/
│  │  ├─ commands/
│  │  ├─ events/
│  │  └─ save/
│  │
│  ├─ presentation/
│  │  ├─ snapshot/
│  │  ├─ ui/
│  │  ├─ overlay/
│  │  ├─ text/
│  │  └─ animation/
│  │
│  ├─ render/
│  │  ├─ frontend/
│  │  ├─ common/
│  │  ├─ graph/
│  │  ├─ effects/
│  │  ├─ sdl_gpu/
│  │  ├─ gles/
│  │  └─ software/
│  │
│  └─ platform/
│     └─ sdl/
│        ├─ window/
│        ├─ display/
│        ├─ input/
│        ├─ audio/
│        ├─ storage/
│        ├─ lifecycle/
│        └─ diagnostics/
│
├─ assets/
│  ├─ source/
│  ├─ shaders/
│  ├─ generated/
│  └─ manifest/
│
├─ tools/
│  ├─ asset_builder/
│  ├─ shader_builder/
│  ├─ replay_converter/
│  └─ golden_compare/
│
├─ tests/
│  ├─ unit/
│  ├─ contract/
│  ├─ replay/
│  ├─ render_golden/
│  ├─ performance/
│  └─ platform/
│
├─ platform/
│  ├─ android/
│  ├─ ios/
│  └─ desktop/
│
└─ third_party/
   ├─ manifest.lock
   └─ licenses/
```

---

# 17. 단계별 구현 로드맵

각 단계는 이전 단계를 완전히 폐기하지 않고 독립적으로 검증 가능한 산출물을 만든다.

## Phase 0 — 기준선 동결

### 작업

- 기존 `wabt` 의존성을 고정하고 423개 테스트 전체 통과
- 대표 replay seed와 입력 fixture 저장
- 적 약 800개, 투사체 burst, hexa merge, overlay blur benchmark scene 고정
- 현재 screenshot/golden image 저장
- save file schema와 실제 fixture 수집
- 현재 셰이더 uniform·blend·coordinate 계약 문서화
- 현재 frame update/draw 순서를 machine-readable test로 고정

### 산출물

```text
baseline/
  replays/
  state_hashes/
  render_goldens/
  saves/
  performance/
  shader_contracts/
```

### 종료 조건

- 동일 commit에서 테스트와 benchmark가 재현된다.
- JS oracle이 tick별 state hash를 출력한다.
- 현재 효과의 기준 이미지가 존재한다.

---

## Phase 1 — C++·CMake·Headless 골격

### 작업

- C++20 project와 CMake presets 생성
- SDL3 3.4.10 및 dependency lock
- `game_core`, `game_headless`, `game_tests` target 생성
- logging, assertions, error/result 타입 구축
- deterministic RNG와 ID 타입 구현
- replay reader와 state hash skeleton 구현
- sanitizers와 warning-as-error preset 추가

### 종료 조건

- SDL 없이 `game_headless`가 실행된다.
- 한 명령으로 unit test와 static analysis를 실행한다.
- build 결과가 repository 외 임의 파일에 의존하지 않는다.

---

## Phase 2 — SDL3 Desktop 플랫폼 셸

### 작업

- `SDL_MAIN_USE_CALLBACKS` 적용
- window, event, input, clock, lifecycle wrapper 구현
- `FrameScheduler`에 현재 60Hz fixed 정책 이식
- resize, DPI, fullscreen, focus 처리
- user storage 읽기/쓰기 smoke test
- audio device open/close smoke test
- renderer 없이 clear 화면과 diagnostics overlay 표시

### 종료 조건

- Windows/macOS/Linux 중 개발 우선 플랫폼에서 실행된다.
- focus loss와 resume 뒤 fixed debt가 폭발하지 않는다.
- storage와 audio가 정상 종료된다.

---

## Phase 3 — RenderCommand와 기본 세 백엔드

### 작업

- `FramePacket`과 command schema 확정
- synthetic render test scene 작성
- SDL_GPU device와 swapchain 초기화
- Android를 제외한 desktop용 GLES smoke backend 또는 필요 플랫폼 GL backend 구현
- `SDL_Surface` 기반 Software backend 구현
- sprite, rect, circle, line, text placeholder 지원
- viewport·letterbox·render scale 구현

### 종료 조건

- 동일 `FramePacket`이 세 backend에서 의미상 같은 장면을 출력한다.
- Software가 960×540에서 30fps 기준을 통과한다.
- backend 초기화 실패 시 다음 backend로 폴백한다.

---

## Phase 4 — C++ Simulation parity 1차

### 작업

- body SoA, spatial grid, candidate, narrow phase, solve 이식
- projectile sweep 이식
- 기존 WAT kernel 결과를 C++ scalar reference와 비교
- allocation telemetry 추가
- JS replay와 C++ replay 상태 비교

### 종료 조건

- 대표 collision replay의 state hash가 합의된 tolerance 또는 완전 일치 기준을 통과한다.
- tick 중 heap allocation이 없다.
- single-thread 800개 benchmark가 목표 budget에 들어온다.

---

## Phase 5 — Full GPU playable vertical slice

### 작업

- sprite/shape/text batching
- scene color render target
- camera와 culling
- magnetic shield 이식
- hexa merge boundary 이식
- title loading circle 이식
- overlay capture·Kawase blur·glass 이식
- 타이틀 화면과 공통 UI·overlay primitive를 이식하고 장면별 골든 기반을 구축
- 현재 gameplay vertical slice와 연결

### 종료 조건

- 대표 전투 장면이 조작 가능하다.
- Ultra와 High 모두 모든 effect type을 표시한다.
- golden image의 허용 오차를 통과한다.
- 800개 적 + overlay blur에서 목표 frame pacing을 통과한다.

---

## Phase 6 — Low GPU 프로필

### 작업

- Reduced shader variants
- blur ROI, 1/4 target, pass 축소
- backdrop revision cache
- particle cap과 dynamic resolution
- 품질 자동 강등·복구 hysteresis
- 저사양 GPU benchmark preset

### 종료 조건

- effect의 의미가 사라지지 않는다.
- Full GPU보다 GPU time·bandwidth가 명확히 감소한다.
- 강등·복구가 반복 진동하지 않는다.

---

## Phase 7 — Software 효과 완성

### 작업

- tile/dirty-region CPU renderer
- glyph, panel, shadow cache
- shield sprite/outline 대체
- hexa outline 대체
- title circle CPU 대체
- overlay tint·edge·cached blur 대체
- vignette mask
- 640×360·960×540 profile
- 30fps presentation scheduler

### 종료 조건

- GPU shader 없이 핵심 화면과 gameplay를 이해할 수 있다.
- 800개 적 상태에서 simulation 60Hz를 유지한다.
- 960×540 30fps가 실패하면 자동으로 640×360으로 강등한다.
- memory growth와 frame spike가 허용 범위 안이다.

---

## Phase 8 — GameSession·Scene·UI·Save 이식 확대

### 작업

- 신규 `ingame` target architecture를 C++로 이식
- scene flow와 transition
- settings UI
- save migration
- localization
- 모든 필수 UI widget
- title·pause·result·overlay
- HUD·설정·게임오버를 포함한 필수 화면/오버레이 전수 인벤토리와 골든 parity
- 레거시 기능별 사용 여부 판정

### 종료 조건

- 시작→게임→종료→저장→재실행 flow가 동작한다.
- 새 save와 기존 save migration fixture가 통과한다.
- renderer를 바꿔도 gameplay state가 달라지지 않는다.
- 타이틀과 모든 필수 오버레이의 시각·입력·상태 전이가 JS/NW.js oracle과 합의된 pixel/perceptual 기준을 통과한다.

---

## Phase 9 — Android

### 작업

- Gradle/NDK/CMake 프로젝트
- SDL3 AAR/Prefab 또는 source build 고정
- `main` shared library target
- Vulkan optional feature 최소화
- GLES fallback
- touch·IME·safe area·orientation
- pause/resume·low memory·audio interruption
- APK/AAB asset packaging
- device capability log

### 종료 조건

- 저·중·고성능 대표 기기에서 앱 시작과 한 세션 완료
- background/foreground 반복 후 검은 화면이나 clock debt 없음
- SDL_GPU 실패 기기에서 GLES 또는 Software로 안전 폴백
- 장기 실행 frame-time과 thermal 자료 수집

---

## Phase 10 — iOS

### 작업

- Xcode wrapper와 SDL3.xcframework
- Metal SDL_GPU backend
- simulator/device build
- touch·IME·safe area·orientation
- background rule와 audio interruption
- user storage와 save recovery
- app package assets

### 종료 조건

- 지원 최소 iOS와 현재 iOS 대표 기기에서 세션 완료
- background 진입 후 rendering을 중단하고 정상 복귀
- device와 simulator에서 shader resource layout 일치

---

## Phase 11 — 멀티코어와 지속 성능

### 작업

- fixed worker pool
- AI, AABB, grid, candidates, narrow phase, projectile 병렬화
- deterministic merge
- 1/2/4 worker replay 비교
- false sharing 분석
- Android big.LITTLE worker policy
- Software renderer와 simulation thread budget 조정

### 종료 조건

- worker 수와 무관하게 gameplay hash 일치
- p95·p99가 single-thread보다 개선되거나 최소 악화되지 않음
- 모바일에서 발열로 인한 장기 성능이 허용 범위에 들어옴

---

## Phase 12 — Cutover

### 작업

- 모든 필수 콘텐츠 parity checklist 완료
- NW.js package 경로 제거
- JS 기준 구현을 read-only archive로 전환
- native crash report와 diagnostics export
- dependency license 정리
- 플랫폼별 release packaging과 서명 절차 정리

### 종료 조건

- Desktop·Android·iOS release candidate가 동일 save schema와 gameplay 결과를 사용한다.
- 세 품질 경로가 설정과 자동 폴백 양쪽에서 선택된다.
- 레거시 실행 파일 없이 제품 요구가 충족된다.

---

# 18. 작업 패키지와 의존성

## 18.1 핵심 작업 목록

| ID | 작업 | 선행 작업 | 완료 기준 |
|---|---|---|---|
| BASE-01 | JS 전체 테스트 정상화 | 없음 | 423/423 통과 |
| BASE-02 | replay/state hash exporter | BASE-01 | tick fixture 생성 |
| BASE-03 | 렌더 golden scene | BASE-01 | 주요 효과 기준 이미지 |
| BUILD-01 | CMake/C++20 skeleton | 없음 | desktop/headless build |
| BUILD-02 | dependency lock | BUILD-01 | tag/checksum 고정 |
| APP-01 | SDL callback app | BUILD-01 | init/event/iterate/quit |
| APP-02 | frame scheduler | APP-01, BASE-02 | fixed 정책 test 통과 |
| PLAT-01 | display/viewport | APP-01 | DPI/resize/letterbox |
| PLAT-02 | input normalization | APP-01 | keyboard/mouse/touch fixture |
| PLAT-03 | storage adapter | APP-01 | read/write/recovery |
| PLAT-04 | audio adapter | APP-01 | BGM/SFX/lifecycle |
| RENDER-01 | FramePacket schema | BASE-03 | serialization test |
| RENDER-02 | SDL_GPU skeleton | RENDER-01, APP-01 | triangle/sprite present |
| RENDER-03 | GLES skeleton | RENDER-01, APP-01 | Android compatible scene |
| RENDER-04 | Software skeleton | RENDER-01 | surface present |
| RENDER-05 | sprite/shape batch | RENDER-02 | 16k instance stress |
| RENDER-06 | text/glyph atlas | RENDER-02, ASSET-02 | Korean text test |
| FX-01 | render graph | RENDER-02 | scene target/composite |
| FX-02 | magnetic shield | FX-01 | Full/Low/Software parity |
| FX-03 | hexa boundary | FX-01 | Full/Low/Software parity |
| FX-04 | title circle | FX-01 | Full/Low/Software parity |
| FX-05 | backdrop/blur/glass | FX-01 | Full/Low/Software parity |
| SHADER-01 | shader build CLI | BUILD-02 | all target binaries |
| SHADER-02 | reflection manifest | SHADER-01 | C++ layout validation |
| CORE-01 | math/RNG/IDs | BUILD-01, BASE-02 | replay primitive parity |
| CORE-02 | SoA/spatial grid | CORE-01 | grid fixture parity |
| CORE-03 | collision pipeline | CORE-02 | collision replay parity |
| CORE-04 | projectile | CORE-02 | sweep replay parity |
| CORE-05 | AI/movement | CORE-01 | AI replay parity |
| CORE-06 | GameSession | CORE-01 | vertical slice state flow |
| CORE-07 | render snapshot | CORE-03, CORE-05 | FramePacket feed |
| JOB-01 | worker pool | CORE-03 | deterministic unit test |
| JOB-02 | parallel stages | JOB-01 | 1/2/4 worker parity |
| ASSET-01 | texture/SVG pipeline | BUILD-01 | no DOM asset dependency |
| ASSET-02 | font pipeline | ASSET-01 | Korean glyph coverage |
| ASSET-03 | audio pipeline | PLAT-04 | packaged BGM/SFX |
| MOB-AND-01 | Android project | APP-01 | debug install |
| MOB-AND-02 | Vulkan/GLES fallback | MOB-AND-01, RENDER-02/03 | device matrix 통과 |
| MOB-IOS-01 | iOS project | APP-01 | simulator/device build |
| MOB-IOS-02 | Metal integration | MOB-IOS-01, RENDER-02 | shader test scene |
| TEST-01 | render golden comparator | BASE-03 | CI diff report |
| UI-01 | title/overlay 전수 인벤토리와 상태 fixture | BASE-03 | 모든 필수 화면·진입·입력 목록 고정 |
| UI-02 | title/HUD/pause/settings/result/game-over parity | UI-01, RENDER-06, FX-05 | 장면별 시각·동작 golden 통과 |
| TEST-02 | performance harness | CORE-03, RENDER-05 | p50/p95/p99 report |
| TEST-03 | lifecycle automation | PLAT-03/04 | suspend/resume suite |
| CUT-01 | native feature parity | 모든 필수 작업 | parity checklist |
| CUT-02 | NW.js 제거 | CUT-01 | native-only package |

## 18.2 병렬 진행 가능 트랙

```text
Track A: BASE → CORE → JOB
Track B: BUILD → APP/PLAT → RENDER → FX
Track C: ASSET → UI/Text/Audio
Track D: Android/iOS shell
```

통합 지점은 다음 세 개다.

1. `CORE-07`의 render snapshot
2. `RENDER-01`의 FramePacket
3. `CORE-06`의 playable GameSession

---

# 19. 테스트 및 성능 합격 기준

## 19.1 테스트 계층

### Unit

- math
- geometry
- collision primitive
- spatial hash
- save migration
- input mapping
- render command generation

### Contract

- fixed update 순서
- render layer 순서
- blend·alpha 규약
- shader resource binding
- overlay source revision
- save schema

### Replay

- 동일 seed·입력의 tick별 hash
- 1·2·4 worker 비교
- Desktop·Android·iOS gameplay event 비교

### Render Golden

- Full GPU Ultra
- Full GPU High
- Low GPU
- Software 960×540
- Software 640×360

픽셀 완전 일치가 불가능한 backend는 perceptual diff와 영역별 tolerance를 사용한다. 텍스트 baseline, 효과 영역, gameplay geometry를 별도로 평가한다.

### Lifecycle

- focus loss
- background/foreground
- orientation
- resize
- low memory
- audio interruption
- storage 실패·복구
- GPU/backend 초기화 실패

## 19.2 기준 benchmark 장면

최소 다음 장면을 고정한다.

1. 적 약 800개가 밀집한 충돌 장면
2. 투사체 50개 지속 + 100개 burst
3. hexa merge 다중 발생
4. magnetic shield 다수 중첩
5. overlay blur always 갱신
6. title loading circle과 backdrop 효과
7. UI text와 한국어 glyph 다수
8. Software에서 최대 alpha overdraw 장면

## 19.3 성능 budget

### Simulation

| 지표 | 목표 |
|---|---:|
| fixed frequency | 60.0Hz |
| fixed p50 | 6ms 이하 권장 |
| fixed p95 | 8.33ms 이하 |
| fixed p99 | 12ms 이하 |
| 장기 debt/lost | 0 또는 명시된 예외만 |
| tick heap allocation | 0 |

현재 게임이 약 800개 적에서 60Hz를 유지하더라도, 모바일·Software 렌더에 CPU 여유를 주기 위해 p95를 한 fixed budget의 절반 정도로 낮추는 것을 목표로 한다.

### Full GPU

| 지표 | Ultra | High |
|---|---:|---:|
| 목표 표시 | 60/120 | 60 |
| 60fps frame p95 | 16.67ms 미만 | 16.67ms 미만 |
| 반복 hitch | 허용하지 않음 | 허용하지 않음 |
| transient resource churn | 없음 | 없음 |

### Low GPU

| 지표 | 목표 |
|---|---:|
| 표시 | 60fps 우선 |
| frame p95 | 16.67ms 미만 |
| blur GPU time | Full 대비 유의미하게 감소 |
| 품질 진동 | 없음 |

### Software

| 지표 | 목표 |
|---|---:|
| 표시 | 30fps |
| frame p95 | 33.33ms 미만 |
| CPU raster 목표 | 약 20~25ms 이하 권장 |
| simulation | 60Hz 유지 |
| 내부 해상도 | 960×540, 실패 시 640×360 |
| 지속 memory 증가 | 없음 |

## 19.4 모바일 장기 검증

각 대표 기기에서 다음을 수행한다.

- 최소 20~30분 연속 gameplay
- 시작 직후, 5분, 15분, 종료 시점의 p50/p90/p95/p99 기록
- CPU/GPU frame time 분리
- thermal 상태 또는 clock 변화 기록 가능 시 수집
- battery 상태와 충전 여부 기록
- foreground/background 반복
- 화면 회전과 잠금
- 알림·통화·오디오 interruption

평균 FPS만으로 합격시키지 않는다.

## 19.5 기기 매트릭스

### Desktop

- GPU 없는 또는 software-only 환경
- 오래된 integrated GPU
- 현대 integrated GPU
- discrete GPU
- Windows/macOS/Linux 각 최소 한 개

### Android

- Vulkan 지원이 약한 저사양
- 중간급 GLES/Vulkan
- 고성능 최신 기기
- 서로 다른 GPU vendor 최소 2종 이상

### iOS

- 지원 최소 OS를 실행하는 오래된 대상 기기
- 중간 세대
- 최신 세대
- simulator

---

# 20. 주요 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| SDL_GPU Android Vulkan 호환 편차 | 일부 기기 실행 실패·검은 화면 | optional feature 비활성화, GLES fallback, boot marker, device blacklist |
| GLSL→HLSL 시 시각 차이 | 효과 품질·색상 차이 | current WebGL golden, linear/sRGB·Y축·premultiplied 계약, shader test scene |
| 레이어 합성 순서 변경 | overlay가 잘못된 소스를 blur | render graph contract test, layer inclusion mask |
| Software에서 CPU 부족 | simulation과 renderer가 코어 경쟁 | 30fps, 내부 해상도 축소, dirty tiles, worker budget 분리 |
| C++ 포팅 중 gameplay drift | 충돌·AI 감각 변화 | JS oracle, tick hash, `double` 유지, 한 기능씩 이식 |
| position solve 병렬화 race | 비결정성·튕김 | 초기 직렬 solve, 이후 graph coloring 별도 단계 |
| 폰트 raster 차이 | UI 줄바꿈·정렬 깨짐 | 동일 TTF/OTF, 공통 metrics cache, golden text tests |
| SVG/DOM 제거 | 아이콘 손실·색 변형 어려움 | build-time raster/SDF, logical asset ID |
| iOS lifecycle 위반 | background에서 종료 | callback lifecycle, background 렌더 중단, 자동 테스트 |
| save I/O 차이 | 데이터 손상 | SDL user storage, journal/checksum/backup/migration tests |
| 빅뱅 포팅 | 장기간 실행 불가 상태 | vertical slice, parallel tracks, phase exit gate |
| dependency 최신화로 회귀 | 플랫폼별 build 파손 | exact version pin, update branch와 device gate |
| 에이전트가 platform API를 core에 확산 | 유지보수 악화 | include boundary CI, narrow interfaces, architecture tests |

---

# 21. 최종 완료 정의

다음 조건을 모두 만족해야 SDL3 전환 완료로 본다.

## 공통

- [ ] C++ GameCore가 SDL·renderer 타입을 include하지 않는다.
- [ ] Desktop·Android·iOS가 같은 save schema와 gameplay core를 사용한다.
- [ ] fixed 60Hz와 catch-up 정책이 기존 계약을 만족한다.
- [ ] 핵심 replay가 JS 기준 또는 승인된 새 기준과 일치한다.
- [ ] 적 약 800개 benchmark가 simulation budget을 통과한다.
- [ ] tick hot path에 heap allocation이 없다.

## 렌더

- [ ] Ultra/High에서 모든 현재 주요 GPU effect가 존재한다.
- [ ] Low GPU에서 blur 해상도·pass·샘플·갱신 빈도가 감소한다.
- [ ] Software에서 shader 없이 기능을 이해할 수 있는 대체 효과가 존재한다.
- [ ] Software가 30fps와 내부 해상도 자동 강등을 지원한다.
- [ ] backend 초기화 실패 시 안전하게 폴백한다.
- [ ] logical layer와 overlay capture 순서가 contract test로 고정돼 있다.
- [ ] 기존 타이틀·HUD·일시정지·설정·결과·게임오버와 모든 필수 오버레이의 구성·geometry·텍스트·입력·상태 전이가 oracle과 일치한다.

## 플랫폼

- [ ] Android에서 SDL_GPU와 GLES fallback을 검증했다.
- [ ] iOS device와 simulator build가 통과한다.
- [ ] background/foreground, low-memory, resize/orientation을 처리한다.
- [ ] 저장·오디오가 lifecycle 전환에서 손상되지 않는다.
- [ ] safe area와 DPI가 UI에 반영된다.

## 운영

- [ ] shader와 asset을 CI에서 재현 가능하게 생성한다.
- [ ] 모든 dependency의 버전과 라이선스가 기록돼 있다.
- [ ] crash/diagnostics에 backend, adapter, preset, frame telemetry가 포함된다.
- [ ] NW.js와 브라우저 runtime이 release package에서 제거됐다.

---

# 22. 착수 직후 실행 순서

아래 순서는 첫 구현 commit부터 그대로 사용할 수 있는 우선순위다.

1. 기존 Node test 실행 문서에 `--experimental-vm-modules`와 pinned `wabt`를 추가한다.
2. 423개 테스트를 모두 녹색으로 만든다.
3. 800개 적·투사체·blur benchmark fixture를 저장한다.
4. JS tick state hash exporter를 추가한다.
5. `native/` CMake 프로젝트와 `game_headless`를 만든다.
6. C++ RNG, EntityId, fixed scheduler를 구현한다.
7. SDL3 3.4.10과 third-party manifest를 고정한다.
8. SDL callback app과 Desktop window를 만든다.
9. `FramePacket` v1 schema를 확정한다.
10. synthetic test scene generator를 만든다.
11. SDL_GPU sprite/shape 최소 backend를 만든다.
12. SDL_Surface Software 최소 backend를 만든다.
13. backend boot marker와 폴백 상태기를 만든다.
14. current viewport/letterbox/renderScale 규칙을 이식한다.
15. shader build CLI와 첫 shader를 연결한다.
16. overlay blur 없이 기본 scene color composite를 만든다.
17. C++ spatial grid와 collision scalar reference를 이식한다.
18. JS/C++ collision replay 비교를 통과시킨다.
19. magnetic shield를 Full/Low/Software 세 구현으로 만든다.
20. overlay blur/glass를 Full/Low/Software 세 구현으로 만든다.
21. 한 개의 playable GameSession vertical slice를 연결한다.
22. Android shared library `main`과 Gradle 프로젝트를 만든다.
23. Android SDL_GPU optional feature 최소 설정을 적용한다.
24. Android GLES fallback을 연결한다.
25. iOS Xcode wrapper와 SDL3.xcframework를 연결한다.
26. storage, audio, touch, safe area를 각 플랫폼에서 검증한다.
27. worker pool을 추가하고 검출 단계부터 병렬화한다.
28. 장기 performance와 lifecycle test를 자동화한다.
29. 모든 필수 scene·UI·save 기능을 기능별로 cutover한다.
30. NW.js release 경로를 제거한다.

가장 먼저 만들어야 하는 사용자 체감 결과물은 **“한 전투 장면을 Full GPU·Low GPU·Software 버튼으로 즉시 전환해 비교할 수 있는 native sandbox”**다. 이 sandbox가 성능, 셰이더, CPU 대체 효과, 입력, viewport를 동시에 검증하는 통합 기준이 된다.

---

# 23. 참조한 현재 코드와 공식 자료

## 23.1 현재 코드 주요 참조 위치

```text
game/script/main.js
game/script/time_handler.js
game/script/module/system_handler.js
game/script/module/display/display_system.js
game/script/module/display/_screen_handler.js
game/script/module/display/webgl/_webgl_constants.js
game/script/module/display/webgl/_overlay_effect_renderer.js
game/script/module/display/webgl/_title_loading_circle_effect_pass.js
game/script/module/display/webgl/_magnetic_shield_effect_pass.js
game/script/module/display/webgl/_hexa_merge_boundary_effect_pass.js
game/script/module/physics/
game/script/module/object/enemy/ai/
game/script/module/object/projectile/
game/script/module/simulation/
game/script/module/ingame/game_system.js
game/script/module/save/
game/script/module/sound/sound_system.js
game/script/module/input/input_system.js
game/script/util/nw_bridge.js
game/script/util/runtime_tool.js
```

## 23.2 현재 가이드 주요 참조 위치

```text
guide/core_architecture_guide.md
guide/module_architecture_guide.md
guide/domain/collision_pipeline_guide.md
guide/domain/simulation_native_acceleration_guide.md
guide/progress/performance_bottleneck_report.md
guide/progress/performance_improvement_plan.md
guide/reference/render_command_guide.md
guide/reference/display_viewport_guide.md
guide/ingame_plan/01_target_architecture.md
guide/ingame_plan/11_legacy_reuse_and_cutover.md
guide/ingame_plan/12_implementation_roadmap.md
guide/ingame_plan/13_testing_and_acceptance.md
```

## 23.3 SDL 공식 자료

- [SDL3 공식 Wiki](https://wiki.libsdl.org/SDL3/FrontPage)
- [SDL GPU API](https://wiki.libsdl.org/SDL3/CategoryGPU)
- [SDL GPU 개발 FAQ: 백엔드와 Android 지원](https://wiki.libsdl.org/SDL3/FAQDevelopment)
- [SDL_CreateGPUDeviceWithProperties](https://wiki.libsdl.org/SDL3/SDL_CreateGPUDeviceWithProperties)
- [SDL_MAIN_USE_CALLBACKS](https://wiki.libsdl.org/SDL3/SDL_MAIN_USE_CALLBACKS)
- [SDL_AppIterate](https://wiki.libsdl.org/SDL3/SDL_AppIterate)
- [SDL Android README](https://wiki.libsdl.org/SDL3/README-android)
- [SDL iOS README](https://wiki.libsdl.org/SDL3/README-ios)
- [SDL_OpenUserStorage](https://wiki.libsdl.org/SDL3/SDL_OpenUserStorage)
- [SDL_CreateSoftwareRenderer](https://wiki.libsdl.org/SDL3/SDL_CreateSoftwareRenderer)
- [SDL_shadercross](https://github.com/libsdl-org/SDL_shadercross)
- [SDL 공식 릴리스](https://github.com/libsdl-org/SDL/releases)

---

# 부록 A — 권장 품질 설정 초안

```cpp
RenderSettings makeUltraSettings() {
    return {
        .preset = QualityPreset::Ultra,
        .renderScale = 1.0f,
        .blurScale = 0.5f,
        .blurDownPasses = 4,
        .blurUpPasses = 4,
        .liveBackdropBlur = true,
        .glassRefraction = true,
        .dynamicResolution = false,
        .presentationFps = 60
    };
}

RenderSettings makeHighSettings() {
    return {
        .preset = QualityPreset::High,
        .renderScale = 1.0f,
        .blurScale = 0.375f,
        .blurDownPasses = 3,
        .blurUpPasses = 3,
        .liveBackdropBlur = true,
        .glassRefraction = true,
        .dynamicResolution = true,
        .presentationFps = 60
    };
}

RenderSettings makeLowSettings() {
    return {
        .preset = QualityPreset::LowGpu,
        .renderScale = 0.75f,
        .blurScale = 0.25f,
        .blurDownPasses = 1,
        .blurUpPasses = 1,
        .liveBackdropBlur = false,
        .glassRefraction = false,
        .dynamicResolution = true,
        .presentationFps = 60
    };
}

RenderSettings makeSoftwareSettings() {
    return {
        .preset = QualityPreset::Software,
        .renderScale = 0.5f,
        .blurScale = 0.0f,
        .blurDownPasses = 0,
        .blurUpPasses = 0,
        .liveBackdropBlur = false,
        .glassRefraction = false,
        .dynamicResolution = true,
        .presentationFps = 30
    };
}
```

수치는 최종값이 아니라 첫 benchmark용 시작값이다. 각 플랫폼 device matrix 결과로 조정하되 프리셋의 의미는 유지한다.

# 부록 B — 자동 backend 선택 의사코드

```cpp
std::unique_ptr<IRenderBackend> createRenderer(
    const BootOptions& options,
    DiagnosticLog& log)
{
    if (options.forceSoftware) {
        return createSoftwareBackend();
    }

    if (!options.forceGles) {
        SdlGpuCreateOptions gpuOptions;
        gpuOptions.preferLowPower = options.isMobile;

        if (options.isAndroid) {
            gpuOptions.clipDistance = false;
            gpuOptions.depthClamping = false;
            gpuOptions.indirectFirstInstance = false;
            gpuOptions.anisotropy = false;
        }

        if (auto gpu = tryCreateSdlGpuBackend(gpuOptions, log)) {
            return gpu;
        }
    }

    if (options.platformSupportsGles) {
        if (auto gles3 = tryCreateGlesBackend(3, log)) {
            return gles3;
        }
        if (auto gles2 = tryCreateGlesBackend(2, log)) {
            return gles2;
        }
    }

    return createSoftwareBackend();
}
```

# 부록 C — 첫 vertical slice 범위

첫 native playable slice에는 다음만 포함한다.

- 고정된 한 개의 전투 map
- player 이동과 기본 공격
- 적 2~3종
- 적 800개 stress spawn 옵션
- projectile burst 옵션
- magnetic shield
- hexa merge boundary
- overlay glass modal
- title loading circle test panel
- UI text와 settings panel
- F1/F2/F3 또는 화면 버튼으로 Full/Low/Software 즉시 전환
- frame, fixed, collision, render-pass, blur, memory telemetry
- replay record/playback

이 범위가 통과하기 전에는 전체 story scene, 모든 UI, 모든 콘텐츠를 포팅하지 않는다.
