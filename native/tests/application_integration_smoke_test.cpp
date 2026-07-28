#include "app/application.h"
#include "platform/sdl/sdl_platform_event.h"
#include "platform/sdl/storage/sdl_settings_storage.h"
#include "platform/sdl/storage/sdl_user_storage.h"
#include "platform/sdl/sdl_window.h"
#include "settings/settings_repository.h"
#include "ui/title_overlay_content.h"

#include <SDL3/SDL.h>

#include <array>
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
        char executable[] = "application_integration_smoke_tests";
        char smoke[] = "--smoke-test-title";
        char renderer[] = "--renderer=software";
        std::array arguments{executable, smoke, renderer};
        initialized_ = application_.initialize(
            static_cast<int>(arguments.size()),
            arguments.data()
        );
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

} // namespace

int main() {
    try {
        testSdlWindowTracksExternalWindowedResize();
        testApplicationSettingsAndDebugIntegration();
        cleanSmokeSettings();
        std::cout << "[PASS] Application settings/debug integration smoke\n";
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
