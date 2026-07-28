#include "app/application.h"
#include "platform/sdl/sdl_platform_event.h"
#include "platform/sdl/storage/sdl_settings_storage.h"
#include "platform/sdl/storage/sdl_user_storage.h"
#include "platform/sdl/sdl_window.h"
#include "settings/settings_repository.h"
#include "ui/title_overlay_content.h"

#include <SDL3/SDL.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

using namespace cirvivor;

constexpr const char* smokeStorageOrganization = "CirVivorTests";
constexpr const char* smokeStorageApplication = "CirVivorNativeSmoke";
constexpr double globalDebugLogicalWidth = 1'920.0;
constexpr double globalDebugLogicalHeight = 1'080.0;

enum class SmokeScene : std::uint8_t {
    title,
    playable,
    diagnostic
};

class TestFailure final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void require(
    const bool condition,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!condition) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)

class SdlGuard final {
public:
    explicit SdlGuard(const SDL_InitFlags flags) {
        REQUIRE(SDL_Init(flags));
    }

    ~SdlGuard() {
        SDL_Quit();
    }

    SdlGuard(const SdlGuard&) = delete;
    SdlGuard& operator=(const SdlGuard&) = delete;
};

class ApplicationGuard final {
public:
    ApplicationGuard() = default;

    ~ApplicationGuard() {
        shutdown();
    }

    [[nodiscard]] bool initialize() noexcept {
        return initialize(SmokeScene::title);
    }

    [[nodiscard]] bool initialize(const SmokeScene scene) noexcept {
        char executable[] = "application_integration_smoke_tests";
        char titleSmoke[] = "--smoke-test-title";
        char smoke[] = "--smoke-test";
        char playable[] = "--playable-scene";
        char renderer[] = "--renderer=software";
        if (scene == SmokeScene::title) {
            std::array arguments{executable, titleSmoke, renderer};
            initialized_ = application_.initialize(
                static_cast<int>(arguments.size()),
                arguments.data()
            );
        } else if (scene == SmokeScene::playable) {
            // smokeTest_는 sticky이고 scene 선택은 last-option-wins이므로
            // playable selector가 일반 smoke selector 뒤에 와야 한다.
            std::array arguments{executable, smoke, playable, renderer};
            initialized_ = application_.initialize(
                static_cast<int>(arguments.size()),
                arguments.data()
            );
        } else {
            std::array arguments{executable, smoke, renderer};
            initialized_ = application_.initialize(
                static_cast<int>(arguments.size()),
                arguments.data()
            );
        }
        return initialized_;
    }

    void shutdown() noexcept {
        if (initialized_) {
            application_.shutdown();
            initialized_ = false;
        }
        SDL_Quit();
    }

    [[nodiscard]] app::Application& application() noexcept {
        return application_;
    }

private:
    app::Application application_;
    bool initialized_ = false;
};

void waitUntilReady(platform::sdl::SdlUserStorage& storage) {
    constexpr std::size_t maximumAttempts = 1'000U;
    for (std::size_t attempt = 0U; attempt < maximumAttempts; ++attempt) {
        if (storage.readyState() == platform::sdl::StorageReadyState::ready) {
            return;
        }
        SDL_Delay(1U);
    }
    REQUIRE(false);
}

void removeIfPresent(
    platform::sdl::SdlUserStorage& storage,
    const char* const path
) {
    const platform::sdl::StorageExistsResult exists = storage.exists(path);
    REQUIRE(exists.succeeded());
    if (exists.exists) {
        REQUIRE(storage.remove(path) == platform::sdl::StorageResult::success);
    }
}

void openSmokeStorage(platform::sdl::SdlUserStorage& storage) {
    REQUIRE(storage.open(smokeStorageOrganization, smokeStorageApplication)
        == platform::sdl::StorageResult::success);
    waitUntilReady(storage);
}

void cleanSmokeSettings() {
    SdlGuard guard(0U);
    platform::sdl::SdlUserStorage storage;
    openSmokeStorage(storage);
    removeIfPresent(storage, settings::settings_temporary_file_path.data());
    removeIfPresent(storage, settings::settings_file_path.data());
    REQUIRE(storage.close() == platform::sdl::StorageResult::success);
}

settings::GameSettings seedSmokeSettings() {
    SdlGuard guard(0U);
    platform::sdl::SdlUserStorage storage;
    openSmokeStorage(storage);
    removeIfPresent(storage, settings::settings_temporary_file_path.data());
    removeIfPresent(storage, settings::settings_file_path.data());

    platform::sdl::SdlSettingsStorage adapter(storage);
    settings::SettingsRepository repository(
        adapter,
        {settings::Language::userLanguage}
    );
    REQUIRE(repository.load().status
        == settings::SettingsLoadStatus::defaultsForMissingFile);

    settings::GameSettings seed = repository.current();
    seed.theme = settings::Theme::light;
    seed.language = settings::Language::english;
    seed.uiScalePercent = 125U;
    seed.tooltipDelayTenths = 8U;
    seed.bgmVolumePercent = 37U;
    seed.sfxVolumePercent = 63U;
    seed.debugMode = false;
    REQUIRE(repository.save(seed).succeeded());
    REQUIRE(storage.close() == platform::sdl::StorageResult::success);
    return seed;
}

settings::GameSettings readSmokeSettings() {
    SdlGuard guard(0U);
    platform::sdl::SdlUserStorage storage;
    openSmokeStorage(storage);
    platform::sdl::SdlSettingsStorage adapter(storage);
    settings::SettingsRepository repository(
        adapter,
        {settings::Language::userLanguage}
    );
    REQUIRE(repository.load().status == settings::SettingsLoadStatus::loaded);
    const settings::GameSettings result = repository.current();
    REQUIRE(storage.close() == platform::sdl::StorageResult::success);
    return result;
}

void testSdlWindowTracksExternalWindowedResize() {
    SdlGuard guard(SDL_INIT_VIDEO);
    platform::sdl::SdlWindow window;
    REQUIRE(window.initialize(
        platform::sdl::WindowGraphicsProfile::neutral,
        true
    ));
    REQUIRE(SDL_SetWindowSize(window.nativeHandle(), 1'600, 900));
    REQUIRE(SDL_SyncWindow(window.nativeHandle()));
    REQUIRE(window.refreshMetrics());
    REQUIRE(!window.displayConfiguration().fullscreen);
    REQUIRE(window.displayConfiguration().width
        == window.metrics().windowWidth);
    REQUIRE(window.displayConfiguration().height
        == window.metrics().windowHeight);
    REQUIRE(window.displayConfiguration().width == 1'600);
    REQUIRE(window.displayConfiguration().height == 900);
    window.shutdown();
}

void requireApplicationContinues(const app::ApplicationResult result) {
    REQUIRE(result != app::ApplicationResult::failure);
}

void primeApplication(app::Application& application) {
    constexpr std::size_t maximumAttempts = 1'000U;
    for (std::size_t attempt = 0U; attempt < maximumAttempts; ++attempt) {
        const app::ApplicationResult result = application.iterate();
        requireApplicationContinues(result);
        if (result == app::ApplicationResult::success) {
            return;
        }
        SDL_Delay(1U);
    }
    REQUIRE(false);
}

platform::sdl::PlatformEvent pointerEvent(
    const platform::sdl::PlatformPointerPhase phase,
    const platform::sdl::PlatformPointerButton button,
    const float x,
    const float y,
    const std::uint64_t timestampMilliseconds
) noexcept {
    platform::sdl::PlatformEvent result;
    result.kind = platform::sdl::PlatformEventKind::pointerChanged;
    result.pointer.device = platform::sdl::PlatformPointerDevice::mouse;
    result.pointer.phase = phase;
    result.pointer.button = button;
    result.pointer.deviceId = 1U;
    result.pointer.pointerId = 1U;
    result.pointer.x = x;
    result.pointer.y = y;
    result.timestampMilliseconds = timestampMilliseconds;
    return result;
}

void sendMiddleClick(
    app::Application& application,
    const std::uint64_t pressedAt,
    const std::uint64_t releasedAt
) {
    requireApplicationContinues(application.handleEvent(pointerEvent(
        platform::sdl::PlatformPointerPhase::pressed,
        platform::sdl::PlatformPointerButton::middle,
        1.0F,
        1.0F,
        pressedAt
    )));
    requireApplicationContinues(application.handleEvent(pointerEvent(
        platform::sdl::PlatformPointerPhase::released,
        platform::sdl::PlatformPointerButton::middle,
        1.0F,
        1.0F,
        releasedAt
    )));
}

void sendDebugKey(
    app::Application& application,
    const platform::sdl::PlatformAction action
) {
    platform::sdl::PlatformEvent event;
    event.kind = platform::sdl::PlatformEventKind::actionChanged;
    event.action = action;
    event.pressed = true;
    event.sourceMask = 1U;
    requireApplicationContinues(application.handleEvent(event));
    event.pressed = false;
    requireApplicationContinues(application.handleEvent(event));
}

void sendMoveRight(app::Application& application, const bool pressed) {
    platform::sdl::PlatformEvent event;
    event.kind = platform::sdl::PlatformEventKind::actionChanged;
    event.action = platform::sdl::PlatformAction::moveRight;
    event.pressed = pressed;
    event.sourceMask = 1U;
    requireApplicationContinues(application.handleEvent(event));
}

void iterateAfterDelay(
    app::Application& application,
    const std::uint32_t delayMilliseconds = 20U
) {
    SDL_Delay(delayMilliseconds);
    requireApplicationContinues(application.iterate());
}

void advanceApplicationFrames(
    app::Application& application,
    const std::size_t frameCount,
    const std::uint32_t delayMilliseconds = 20U
) {
    for (std::size_t frame = 0U; frame < frameCount; ++frame) {
        iterateAfterDelay(application, delayMilliseconds);
    }
}

SDL_Window* onlyApplicationWindow() {
    int count = 0;
    SDL_Window** const windows = SDL_GetWindows(&count);
    REQUIRE(windows != nullptr);
    REQUIRE(count == 1);
    SDL_Window* const result = windows[0];
    SDL_free(windows);
    REQUIRE(result != nullptr);
    return result;
}

std::uint64_t applicationFrameContentDigest(
    const app::Application& application
) {
    const std::uint64_t digest = application.lastRenderedFrameContentHash();
    REQUIRE(digest != 0U);
    return digest;
}

struct GlobalDebugProjection final {
    int windowWidth = 0;
    int windowHeight = 0;
    int drawableWidth = 0;
    int drawableHeight = 0;
    int contentX = 0;
    int contentY = 0;
    int contentWidth = 0;
    int contentHeight = 0;
    ui::layout::LogicalSafeAreaInsets logicalSafeArea{};
};

int scaleWindowCoordinateToPixels(
    const int value,
    const int windowExtent,
    const int pixelExtent
) {
    REQUIRE(windowExtent > 0);
    REQUIRE(pixelExtent > 0);
    const long rounded = std::lround(
        static_cast<double>(std::max(value, 0))
            * static_cast<double>(pixelExtent)
            / static_cast<double>(windowExtent)
    );
    return static_cast<int>(std::clamp<long>(rounded, 0L, pixelExtent));
}

int insetInsideContent(
    const int outerInset,
    const int letterboxInset,
    const int maximum
) noexcept {
    return std::clamp(outerInset - letterboxInset, 0, maximum);
}

GlobalDebugProjection globalDebugProjection() {
    SDL_Window* const window = onlyApplicationWindow();
    GlobalDebugProjection result;
    REQUIRE(SDL_GetWindowSize(window, &result.windowWidth, &result.windowHeight));
    REQUIRE(SDL_GetWindowSizeInPixels(
        window,
        &result.drawableWidth,
        &result.drawableHeight
    ));
    REQUIRE(result.windowWidth > 0);
    REQUIRE(result.windowHeight > 0);
    REQUIRE(result.drawableWidth > 0);
    REQUIRE(result.drawableHeight > 0);

    const bool widthLimited =
        static_cast<std::int64_t>(result.drawableWidth) * 1'080
        <= static_cast<std::int64_t>(result.drawableHeight) * 1'920;
    result.contentWidth = widthLimited
        ? result.drawableWidth
        : result.drawableHeight * 1'920 / 1'080;
    result.contentHeight = widthLimited
        ? result.drawableWidth * 1'080 / 1'920
        : result.drawableHeight;
    result.contentX = (result.drawableWidth - result.contentWidth) / 2;
    result.contentY = (result.drawableHeight - result.contentHeight) / 2;

    SDL_Rect safeArea{};
    if (!SDL_GetWindowSafeArea(window, &safeArea)) {
        safeArea = {0, 0, result.windowWidth, result.windowHeight};
        SDL_ClearError();
    }
    const int windowRight = result.windowWidth - safeArea.x - safeArea.w;
    const int windowBottom = result.windowHeight - safeArea.y - safeArea.h;
    const int drawableLeft = scaleWindowCoordinateToPixels(
        safeArea.x,
        result.windowWidth,
        result.drawableWidth
    );
    const int drawableTop = scaleWindowCoordinateToPixels(
        safeArea.y,
        result.windowHeight,
        result.drawableHeight
    );
    const int drawableRight = scaleWindowCoordinateToPixels(
        windowRight,
        result.windowWidth,
        result.drawableWidth
    );
    const int drawableBottom = scaleWindowCoordinateToPixels(
        windowBottom,
        result.windowHeight,
        result.drawableHeight
    );
    const int rightLetterbox = result.drawableWidth
        - result.contentX - result.contentWidth;
    const int bottomLetterbox = result.drawableHeight
        - result.contentY - result.contentHeight;
    const int contentSafeLeft = insetInsideContent(
        drawableLeft,
        result.contentX,
        result.contentWidth
    );
    const int contentSafeRight = insetInsideContent(
        drawableRight,
        rightLetterbox,
        result.contentWidth - contentSafeLeft
    );
    const int contentSafeTop = insetInsideContent(
        drawableTop,
        result.contentY,
        result.contentHeight
    );
    const int contentSafeBottom = insetInsideContent(
        drawableBottom,
        bottomLetterbox,
        result.contentHeight - contentSafeTop
    );
    const double logicalScale = std::min(
        static_cast<double>(result.contentWidth) / globalDebugLogicalWidth,
        static_cast<double>(result.contentHeight) / globalDebugLogicalHeight
    );
    REQUIRE(logicalScale > 0.0);
    result.logicalSafeArea = {
        static_cast<double>(contentSafeLeft) / logicalScale,
        static_cast<double>(contentSafeTop) / logicalScale,
        static_cast<double>(contentSafeRight) / logicalScale,
        static_cast<double>(contentSafeBottom) / logicalScale
    };
    return result;
}

ui::layout::PointD globalDebugControlCenter(
    const ui::TitleOverlayControlId controlId,
    const double uiScale
) {
    const GlobalDebugProjection projection = globalDebugProjection();
    ui::layout::UiLayoutMetrics layout;
    REQUIRE(layout.tryUpdate({
        .logicalWidth = globalDebugLogicalWidth,
        .logicalHeight = globalDebugLogicalHeight,
        .uiScale = uiScale,
        .hasVersionHistoryLink = false,
        .logicalSafeArea = projection.logicalSafeArea
    }));

    ui::TitleOverlayStateMachine state;
    const ui::UiActionOutcome opened = state.apply(ui::UiAction::openDebug());
    REQUIRE(opened.accepted());
    for (std::size_t step = 0U; step < 10U; ++step) {
        state.advance(0.05);
    }
    ui::TitleOverlayPresentationSet presentations{};
    REQUIRE(ui::tryBuildTitleOverlayPresentationSet(
        state.snapshot(),
        layout.snapshot(),
        presentations
    ));
    const ui::TitleOverlayPresentation* const debug =
        ui::findTitleOverlayPresentation(presentations, opened.overlaySequence);
    REQUIRE(debug != nullptr);
    for (std::size_t index = 0U; index < debug->controlCount; ++index) {
        const ui::TitleOverlayControl& control = debug->controls[index];
        if (control.id != controlId) {
            continue;
        }
        const double logicalX = control.rect.x + (control.rect.width * 0.5);
        const double logicalY = control.rect.y + (control.rect.height * 0.5);
        const double drawableX = static_cast<double>(projection.contentX)
            + logicalX / globalDebugLogicalWidth
                * static_cast<double>(projection.contentWidth);
        const double drawableY = static_cast<double>(projection.contentY)
            + logicalY / globalDebugLogicalHeight
                * static_cast<double>(projection.contentHeight);
        return {
            drawableX * static_cast<double>(projection.windowWidth)
                / static_cast<double>(projection.drawableWidth),
            drawableY * static_cast<double>(projection.windowHeight)
                / static_cast<double>(projection.drawableHeight)
        };
    }
    REQUIRE(false);
    return {};
}

void sendMouseMoveAway(app::Application& application) {
    requireApplicationContinues(application.handleEvent(pointerEvent(
        platform::sdl::PlatformPointerPhase::moved,
        platform::sdl::PlatformPointerButton::none,
        1.0F,
        1.0F,
        0U
    )));
}

void clickGlobalDebugControl(
    app::Application& application,
    const ui::TitleOverlayControlId controlId,
    const std::uint64_t timestampMilliseconds
) {
    const ui::layout::PointD center = globalDebugControlCenter(controlId, 1.25);
    requireApplicationContinues(application.handleEvent(pointerEvent(
        platform::sdl::PlatformPointerPhase::pressed,
        platform::sdl::PlatformPointerButton::primary,
        static_cast<float>(center.x),
        static_cast<float>(center.y),
        timestampMilliseconds
    )));
    requireApplicationContinues(application.handleEvent(pointerEvent(
        platform::sdl::PlatformPointerPhase::released,
        platform::sdl::PlatformPointerButton::primary,
        static_cast<float>(center.x),
        static_cast<float>(center.y),
        timestampMilliseconds + 10U
    )));
}

ui::layout::PointD debugAnimationControlCenter(const double uiScale) {
    SDL_Window* const window = onlyApplicationWindow();
    int width = 0;
    int height = 0;
    REQUIRE(SDL_GetWindowSize(window, &width, &height));

    SDL_Rect safeArea{};
    if (!SDL_GetWindowSafeArea(window, &safeArea)) {
        safeArea = {0, 0, width, height};
        SDL_ClearError();
    }
    const ui::layout::LogicalSafeAreaInsets insets{
        static_cast<double>(safeArea.x),
        static_cast<double>(safeArea.y),
        static_cast<double>(width - safeArea.x - safeArea.w),
        static_cast<double>(height - safeArea.y - safeArea.h)
    };

    ui::layout::UiLayoutMetrics layout;
    REQUIRE(layout.tryUpdate({
        .logicalWidth = static_cast<double>(width),
        .logicalHeight = static_cast<double>(height),
        .uiScale = uiScale,
        .hasVersionHistoryLink = true,
        .logicalSafeArea = insets
    }));

    ui::TitleOverlayStateMachine state;
    const ui::UiActionOutcome opened = state.apply(ui::UiAction::openDebug());
    REQUIRE(opened.accepted());
    ui::TitleOverlayPresentationSet presentations{};
    REQUIRE(ui::tryBuildTitleOverlayPresentationSet(
        state.snapshot(),
        layout.snapshot(),
        presentations
    ));
    const ui::TitleOverlayPresentation* const debug =
        ui::findTitleOverlayPresentation(presentations, opened.overlaySequence);
    REQUIRE(debug != nullptr);
    for (std::size_t index = 0U; index < debug->controlCount; ++index) {
        const ui::TitleOverlayControl& control = debug->controls[index];
        if (control.id == ui::TitleOverlayControlId::debugAnimation) {
            return {
                control.rect.x + (control.rect.width * 0.5),
                control.rect.y + (control.rect.height * 0.5)
            };
        }
    }
    REQUIRE(false);
    return {};
}

void activateDebugAnimation(app::Application& application) {
    const ui::layout::PointD center = debugAnimationControlCenter(1.25);
    requireApplicationContinues(application.handleEvent(pointerEvent(
        platform::sdl::PlatformPointerPhase::pressed,
        platform::sdl::PlatformPointerButton::primary,
        static_cast<float>(center.x),
        static_cast<float>(center.y),
        400U
    )));
    requireApplicationContinues(application.handleEvent(pointerEvent(
        platform::sdl::PlatformPointerPhase::released,
        platform::sdl::PlatformPointerButton::primary,
        static_cast<float>(center.x),
        static_cast<float>(center.y),
        410U
    )));
}

void runEnableCycle() {
    ApplicationGuard application;
    REQUIRE(application.initialize());
    primeApplication(application.application());

    sendMiddleClick(application.application(), 100U, 110U);
    sendMiddleClick(application.application(), 200U, 210U);
    sendMiddleClick(application.application(), 300U, 310U);
    activateDebugAnimation(application.application());

    sendDebugKey(
        application.application(),
        platform::sdl::PlatformAction::debugPause
    );
    requireApplicationContinues(application.application().iterate());
    sendDebugKey(
        application.application(),
        platform::sdl::PlatformAction::debugStep
    );
    requireApplicationContinues(application.application().iterate());
    sendDebugKey(
        application.application(),
        platform::sdl::PlatformAction::debugPause
    );
    requireApplicationContinues(application.application().iterate());
}

void runReloadAndDisableCycle() {
    ApplicationGuard application;
    REQUIRE(application.initialize());
    primeApplication(application.application());

    sendMiddleClick(application.application(), 1'000U, 1'010U);
    requireApplicationContinues(application.application().iterate());
    sendMiddleClick(application.application(), 1'100U, 1'110U);
    sendMiddleClick(application.application(), 1'200U, 1'210U);
    requireApplicationContinues(application.application().iterate());
}

void testApplicationSettingsAndDebugIntegration() {
    const settings::GameSettings seed = seedSmokeSettings();
    runEnableCycle();

    settings::GameSettings expected = seed;
    expected.debugMode = true;
    REQUIRE(readSmokeSettings() == expected);

    runReloadAndDisableCycle();
    expected.debugMode = false;
    REQUIRE(readSmokeSettings() == expected);
}

void runGlobalDebugEnableCycle(const SmokeScene scene) {
    REQUIRE(scene == SmokeScene::playable || scene == SmokeScene::diagnostic);
    ApplicationGuard application;
    REQUIRE(application.initialize(scene));
    primeApplication(application.application());

    sendMiddleClick(application.application(), 100U, 110U);
    sendMiddleClick(application.application(), 200U, 210U);
    sendMiddleClick(application.application(), 300U, 310U);
    // Debug overlay의 open transition과 glyph-backed panel을 실제 Software
    // raster에 충분히 제출하되 긴 CPU render loop 대신 큰 표시 delta를 사용한다.
    advanceApplicationFrames(application.application(), 6U, 100U);

    if (scene == SmokeScene::playable) {
        sendMoveRight(application.application(), true);
        // single-step 한 번도 raster 차이로 관측되도록 Tower에 먼저 속도를 준다.
        advanceApplicationFrames(application.application(), 2U, 100U);
    }

    sendMouseMoveAway(application.application());
    iterateAfterDelay(application.application());
    const std::uint64_t unselectedDigest = applicationFrameContentDigest(
        application.application()
    );

    clickGlobalDebugControl(
        application.application(),
        ui::TitleOverlayControlId::debugAnimation,
        400U
    );
    sendMouseMoveAway(application.application());
    iterateAfterDelay(application.application());
    const std::uint64_t selectedDigest = applicationFrameContentDigest(
        application.application()
    );
    REQUIRE(selectedDigest != unselectedDigest);

    sendDebugKey(
        application.application(),
        platform::sdl::PlatformAction::debugPause
    );
    iterateAfterDelay(application.application());

    // animation pause 중 Debug close는 즉시 panel을 제거하지만 debug mode와
    // pause authority는 유지한다.
    clickGlobalDebugControl(
        application.application(),
        ui::TitleOverlayControlId::close,
        500U
    );
    iterateAfterDelay(application.application());
    const std::uint64_t pausedDigest = applicationFrameContentDigest(
        application.application()
    );
    iterateAfterDelay(application.application());
    REQUIRE(applicationFrameContentDigest(application.application()) == pausedDigest);

    sendDebugKey(
        application.application(),
        platform::sdl::PlatformAction::debugStep
    );
    iterateAfterDelay(application.application());
    const std::uint64_t steppedDigest = applicationFrameContentDigest(
        application.application()
    );
    REQUIRE(steppedDigest != pausedDigest);
    iterateAfterDelay(application.application());
    REQUIRE(applicationFrameContentDigest(application.application()) == steppedDigest);

    if (scene == SmokeScene::playable) {
        sendMoveRight(application.application(), false);
    }
}

void runGlobalDebugDisableCycle(const SmokeScene scene) {
    REQUIRE(scene == SmokeScene::playable || scene == SmokeScene::diagnostic);
    ApplicationGuard application;
    REQUIRE(application.initialize(scene));
    primeApplication(application.application());

    sendMiddleClick(application.application(), 1'000U, 1'010U);
    sendMiddleClick(application.application(), 1'100U, 1'110U);
    sendMiddleClick(application.application(), 1'200U, 1'210U);
    iterateAfterDelay(application.application());
}

void testGlobalDebugIntegration(const SmokeScene scene) {
    const settings::GameSettings seed = seedSmokeSettings();
    runGlobalDebugEnableCycle(scene);

    settings::GameSettings expected = seed;
    expected.debugMode = true;
    REQUIRE(readSmokeSettings() == expected);

    runGlobalDebugDisableCycle(scene);
    expected.debugMode = false;
    REQUIRE(readSmokeSettings() == expected);
}

} // namespace

int main() {
    try {
        testSdlWindowTracksExternalWindowedResize();
        testApplicationSettingsAndDebugIntegration();
        std::cout << "[PASS] Application title settings/debug integration\n";
        testGlobalDebugIntegration(SmokeScene::diagnostic);
        std::cout << "[PASS] Application diagnostic global Debug integration\n";
        testGlobalDebugIntegration(SmokeScene::playable);
        std::cout << "[PASS] Application playable global Debug integration\n";
        cleanSmokeSettings();
        return 0;
    } catch (const std::exception& error) {
        try {
            cleanSmokeSettings();
        } catch (...) {
        }
        std::cerr << "[FAIL] Application settings/debug integration smoke: "
                  << error.what() << '\n';
        return 1;
    }
}
