#include "app/application.h"

#include "platform/sdl/sdl_platform_event.h"
#include "platform/sdl/sdl_runtime_asset.h"
#include "render/frontend/playable_game_scene.h"
#include "render/frontend/synthetic_test_scene.h"
#include "render/frontend/title_scene.h"
#include "render/gles/gles_backend.h"
#include "render/sdl_gpu/sdl_gpu_backend.h"
#include "render/software/software_backend.h"
#include "render/text/title_text_catalog.h"

#include <SDL3/SDL.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <limits>
#include <memory>
#include <string>
#include <string_view>
#include <utility>

namespace cirvivor::app {
namespace {

constexpr double nanosecondsPerSecond = 1'000'000'000.0;
constexpr std::string_view smokeStoragePath = "sdl-platform-smoke-v1.tmp";
constexpr std::uint8_t renderRecoverySmokeLifecycleStage = 1;
constexpr std::uint8_t renderRecoverySmokeTargetsStage = 2;
constexpr std::uint8_t renderRecoverySmokeDeviceStage = 3;
constexpr std::uint8_t renderRecoverySmokeCompleteStage = 4;
constexpr std::uint8_t titleToPlayableSmokeTitleStage = 1;
constexpr std::uint8_t titleToPlayableSmokeMapStage = 2;
constexpr std::uint8_t titleToPlayableSmokePlayableStage = 3;
constexpr std::uint8_t titleToPlayableSmokeCompleteStage = 4;
constexpr std::uint64_t debugPersistenceRetryDelayMilliseconds = 1'000U;
constexpr std::uint8_t maximumDebugPersistenceRetryCount = 3U;
constexpr std::size_t maximumBundledFontBytes = 32U * 1'024U * 1'024U;

using TitlePreloadSpecs = std::array<
    render::text::TextPreloadSpec,
    render::text::title_text_catalog.size() * 2U
>;
using DynamicTitleTextBuffers = std::array<
    std::array<char, 96U>,
    render::text::title_text_catalog.size() * 2U
>;

constexpr settings::SettingsOverlayFieldMask allSettingsOverlayFields =
    static_cast<settings::SettingsOverlayFieldMask>(
        (settings::SettingsOverlayFieldMask{1U}
            << static_cast<std::uint8_t>(settings::SettingsOverlayField::count))
        - 1U
    );

[[nodiscard]] constexpr bool includesSettingsField(
    const settings::SettingsOverlayFieldMask fields,
    const settings::SettingsOverlayField field
) noexcept {
    return (fields & settings::settingsOverlayFieldBit(field)) != 0U;
}

[[nodiscard]] render::UiTextLocale titleLocaleFor(
    const settings::Language language
) noexcept {
    return language == settings::Language::english
        ? render::UiTextLocale::english
        : render::UiTextLocale::korean;
}

[[nodiscard]] bool tryFormatDynamicTitleText(
    const render::UiTextSemanticId semantic,
    const render::UiTextLocale locale,
    const settings::GameSettings& settings,
    std::array<char, 96U>& storage,
    std::string_view& output
) noexcept {
    const bool korean = locale == render::UiTextLocale::korean;
    int length = -1;
    switch (semantic) {
    case render::UiTextSemanticId::settingWindowMode:
        length = SDL_snprintf(
            storage.data(),
            storage.size(),
            korean ? "화면 모드   %s" : "Window Mode   %s",
            settings.windowMode == settings::WindowMode::fullscreen
                ? (korean ? "전체화면" : "FullScreen")
                : (korean ? "창모드" : "Windowed")
        );
        break;
    case render::UiTextSemanticId::settingRenderScale:
        length = SDL_snprintf(
            storage.data(),
            storage.size(),
            korean ? "렌더링 해상도   %u%%" : "Render Scale   %u%%",
            static_cast<unsigned int>(settings.renderScalePercent)
        );
        break;
    case render::UiTextSemanticId::settingUiScale:
        length = SDL_snprintf(
            storage.data(),
            storage.size(),
            korean ? "UI 크기   %u%%" : "UI Scale   %u%%",
            static_cast<unsigned int>(settings.uiScalePercent)
        );
        break;
    case render::UiTextSemanticId::settingLanguage:
        length = SDL_snprintf(
            storage.data(),
            storage.size(),
            korean ? "언어 (Language)   %s" : "Language   %s",
            settings.language == settings::Language::english
                ? "English"
                : (korean ? "한국어" : "Korean")
        );
        break;
    case render::UiTextSemanticId::settingTheme:
        length = SDL_snprintf(
            storage.data(),
            storage.size(),
            korean ? "테마   %s" : "Theme   %s",
            settings.theme == settings::Theme::dark
                ? (korean ? "어둡게" : "Dark")
                : (korean ? "밝게" : "Light")
        );
        break;
    case render::UiTextSemanticId::settingTooltipDelay:
        length = SDL_snprintf(
            storage.data(),
            storage.size(),
            korean ? "툴팁 표시 시간   %u.%u초" : "Tooltip Delay   %u.%us",
            static_cast<unsigned int>(settings.tooltipDelayTenths / 10U),
            static_cast<unsigned int>(settings.tooltipDelayTenths % 10U)
        );
        break;
    case render::UiTextSemanticId::settingBgm:
        length = SDL_snprintf(
            storage.data(),
            storage.size(),
            korean ? "배경음악   %u" : "Music   %u",
            static_cast<unsigned int>(settings.bgmVolumePercent)
        );
        break;
    case render::UiTextSemanticId::settingSfx:
        length = SDL_snprintf(
            storage.data(),
            storage.size(),
            korean ? "효과음   %u" : "Effects   %u",
            static_cast<unsigned int>(settings.sfxVolumePercent)
        );
        break;
    default:
        return false;
    }
    if (length < 0) {
        return false;
    }
    output = {
        storage.data(),
        std::min<std::size_t>(
            static_cast<std::size_t>(length),
            storage.size() - 1U
        )
    };
    return true;
}

[[nodiscard]] TitlePreloadSpecs makeTitlePreloadSpecs(
    const settings::GameSettings& settings,
    DynamicTitleTextBuffers& dynamicText
) noexcept {
    TitlePreloadSpecs result{};
    std::size_t index = 0U;
    for (const render::text::TitleTextCatalogEntry& entry :
         render::text::title_text_catalog) {
        std::string_view korean = entry.korean;
        std::string_view english = entry.english;
        static_cast<void>(tryFormatDynamicTitleText(
            entry.semantic,
            render::UiTextLocale::korean,
            settings,
            dynamicText[index],
            korean
        ));
        result[index++] = {
            render::text::titleTextKey(
                entry.semantic,
                render::UiTextLocale::korean
            ),
            korean
        };
        static_cast<void>(tryFormatDynamicTitleText(
            entry.semantic,
            render::UiTextLocale::english,
            settings,
            dynamicText[index],
            english
        ));
        result[index++] = {
            render::text::titleTextKey(
                entry.semantic,
                render::UiTextLocale::english
            ),
            english
        };
    }
    return result;
}

[[nodiscard]] const ui::OverlaySnapshot* findLatestOverlay(
    const ui::UiStateSnapshot& state,
    const ui::OverlayKind kind
) noexcept {
    const ui::OverlaySnapshot* result = nullptr;
    for (std::size_t index = 0U; index < state.overlayCount; ++index) {
        if (state.overlays[index].kind == kind
            && (result == nullptr
                || state.overlays[index].sequence > result->sequence)) {
            result = &state.overlays[index];
        }
    }
    return result;
}

[[nodiscard]] bool settingsFieldForControl(
    const ui::TitleOverlayControlId id,
    settings::SettingsOverlayField& output
) noexcept {
    switch (id) {
    case ui::TitleOverlayControlId::settingWindowMode:
        output = settings::SettingsOverlayField::windowMode;
        return true;
    case ui::TitleOverlayControlId::settingUltrawide:
        output = settings::SettingsOverlayField::widescreenSupport;
        return true;
    case ui::TitleOverlayControlId::settingRenderScale:
        output = settings::SettingsOverlayField::renderScale;
        return true;
    case ui::TitleOverlayControlId::settingUiScale:
        output = settings::SettingsOverlayField::uiScale;
        return true;
    case ui::TitleOverlayControlId::settingOpaqueUi:
        output = settings::SettingsOverlayField::disableTransparency;
        return true;
    case ui::TitleOverlayControlId::settingLanguage:
        output = settings::SettingsOverlayField::language;
        return true;
    case ui::TitleOverlayControlId::settingTheme:
        output = settings::SettingsOverlayField::theme;
        return true;
    case ui::TitleOverlayControlId::settingTooltipDelay:
        output = settings::SettingsOverlayField::tooltipDelay;
        return true;
    case ui::TitleOverlayControlId::settingBgm:
        output = settings::SettingsOverlayField::bgmVolume;
        return true;
    case ui::TitleOverlayControlId::settingSfx:
        output = settings::SettingsOverlayField::sfxVolume;
        return true;
    default:
        return false;
    }
}

[[nodiscard]] bool debugOptionForControl(
    const ui::TitleOverlayControlId id,
    debug::DebugDisplayOption& output
) noexcept {
    switch (id) {
    case ui::TitleOverlayControlId::debugFrameTime:
        output = debug::DebugDisplayOption::frameTime;
        return true;
    case ui::TitleOverlayControlId::debugPoolInfo:
        output = debug::DebugDisplayOption::poolInfo;
        return true;
    case ui::TitleOverlayControlId::debugHitboxes:
        output = debug::DebugDisplayOption::hitboxes;
        return true;
    case ui::TitleOverlayControlId::debugAnimation:
        output = debug::DebugDisplayOption::animationDebug;
        return true;
    default:
        return false;
    }
}

void advanceUiStateForSmoke(
    ui::TitleOverlayStateMachine& state,
    double seconds
) noexcept {
    while (seconds > 0.0) {
        const double step = std::min(
            seconds,
            ui::TitleOverlayStateMachine::maximum_frame_delta_seconds
        );
        state.advance(step);
        seconds -= step;
    }
}

class GlesWindowBackend final : public render::backend::IRenderBackend {
public:
    explicit GlesWindowBackend(platform::sdl::SdlWindow& window) noexcept
        : window_(window) {}

    [[nodiscard]] render::backend::RenderBackendKind kind() const noexcept override {
        return render::backend::RenderBackendKind::gles;
    }

    [[nodiscard]] const render::backend::RenderCapabilities& capabilities()
        const noexcept override {
        return active_ == nullptr ? emptyCapabilities_ : active_->capabilities();
    }

    [[nodiscard]] render::backend::BackendInitializeResult initialize() override {
        if (active_ != nullptr) {
            return render::backend::BackendInitializeResult::failure(
                "GLES window backend is already initialized"
            );
        }

        std::string failures;
        constexpr std::array versions{
            render::gles::GlesContextVersion::es3,
            render::gles::GlesContextVersion::es2
        };
        for (const render::gles::GlesContextVersion version : versions) {
            const platform::sdl::WindowGraphicsProfile profile =
                version == render::gles::GlesContextVersion::es3
                ? platform::sdl::WindowGraphicsProfile::gles3
                : platform::sdl::WindowGraphicsProfile::gles2;
            if (!window_.recreate(profile, true)) {
                appendFailure(failures, version, SDL_GetError());
                continue;
            }

            auto candidate = std::make_unique<render::gles::GlesBackend>(
                window_.nativeHandle(),
                version
            );
            render::backend::BackendInitializeResult result = candidate->initialize();
            if (result.succeeded()) {
                active_ = std::move(candidate);
                return render::backend::BackendInitializeResult::success();
            }
            appendFailure(failures, version, result.reason());
            candidate->shutdown();
        }
        if (failures.empty()) {
            failures = "GLES ES3 and ES2 initialization failed without diagnostics";
        }
        return render::backend::BackendInitializeResult::failure(std::move(failures));
    }

    void shutdown() noexcept override {
        if (active_ != nullptr) {
            active_->shutdown();
            active_.reset();
        }
    }

    [[nodiscard]] bool resize(
        const std::int32_t drawableWidth,
        const std::int32_t drawableHeight
    ) noexcept override {
        return active_ != nullptr && active_->resize(drawableWidth, drawableHeight);
    }

    [[nodiscard]] bool render(
        const render::FramePacket& frame,
        const render::RenderResourcesView resources = {}
    ) noexcept override {
        return active_ != nullptr && active_->render(frame, resources);
    }

    [[nodiscard]] bool onBackground() noexcept override {
        return active_ != nullptr && active_->onBackground();
    }

    [[nodiscard]] bool onForeground() noexcept override {
        return active_ != nullptr && active_->onForeground();
    }

    [[nodiscard]] bool purgeTransientResources() noexcept override {
        return active_ != nullptr && active_->purgeTransientResources();
    }

    [[nodiscard]] bool onRenderTargetsReset() noexcept override {
        return active_ != nullptr && active_->onRenderTargetsReset();
    }

private:
    static void appendFailure(
        std::string& output,
        const render::gles::GlesContextVersion version,
        const std::string_view reason
    ) {
        if (!output.empty()) {
            output += "; ";
        }
        output += version == render::gles::GlesContextVersion::es3 ? "ES3: " : "ES2: ";
        output += reason.empty() ? "initialization failed" : reason;
    }

    platform::sdl::SdlWindow& window_;
    std::unique_ptr<render::gles::GlesBackend> active_;
    render::backend::RenderCapabilities emptyCapabilities_;
};

[[nodiscard]] bool parseRendererPreference(
    const std::string_view value,
    render::backend::RendererPreference& preference
) noexcept {
    if (value == "auto") {
        preference = render::backend::RendererPreference::automatic;
        return true;
    }
    if (value == "gpu" || value == "sdl-gpu") {
        preference = render::backend::RendererPreference::sdlGpu;
        return true;
    }
    if (value == "gles") {
        preference = render::backend::RendererPreference::gles;
        return true;
    }
    if (value == "software") {
        preference = render::backend::RendererPreference::software;
        return true;
    }
    return false;
}

[[nodiscard]] int scaleWindowCoordinateToPixels(
    const int value,
    const int windowExtent,
    const int pixelExtent
) noexcept {
    if (value <= 0 || windowExtent <= 0 || pixelExtent <= 0) {
        return 0;
    }
    const double scaled = static_cast<double>(value)
        * static_cast<double>(pixelExtent)
        / static_cast<double>(windowExtent);
    const long rounded = std::lround(scaled);
    return static_cast<int>(std::clamp<long>(rounded, 0L, pixelExtent));
}

[[nodiscard]] render::InsetsI drawableSafeArea(
    const platform::sdl::WindowMetrics& metrics
) noexcept {
    const std::int64_t safeRight = static_cast<std::int64_t>(metrics.safeAreaX)
        + static_cast<std::int64_t>(metrics.safeAreaWidth);
    const std::int64_t safeBottom = static_cast<std::int64_t>(metrics.safeAreaY)
        + static_cast<std::int64_t>(metrics.safeAreaHeight);
    const int rightInset = static_cast<int>(std::clamp<std::int64_t>(
        static_cast<std::int64_t>(metrics.windowWidth) - safeRight,
        0,
        metrics.windowWidth
    ));
    const int bottomInset = static_cast<int>(std::clamp<std::int64_t>(
        static_cast<std::int64_t>(metrics.windowHeight) - safeBottom,
        0,
        metrics.windowHeight
    ));
    return {
        scaleWindowCoordinateToPixels(
            metrics.safeAreaX,
            metrics.windowWidth,
            metrics.pixelWidth
        ),
        scaleWindowCoordinateToPixels(
            metrics.safeAreaY,
            metrics.windowHeight,
            metrics.pixelHeight
        ),
        scaleWindowCoordinateToPixels(rightInset, metrics.windowWidth, metrics.pixelWidth),
        scaleWindowCoordinateToPixels(bottomInset, metrics.windowHeight, metrics.pixelHeight)
    };
}

[[nodiscard]] ui::layout::LogicalSafeAreaInsets logicalSafeArea(
    const platform::sdl::WindowMetrics& metrics
) noexcept {
    const std::int64_t windowWidth = std::max(metrics.windowWidth, 0);
    const std::int64_t windowHeight = std::max(metrics.windowHeight, 0);
    const std::int64_t safeRight = static_cast<std::int64_t>(metrics.safeAreaX)
        + static_cast<std::int64_t>(metrics.safeAreaWidth);
    const std::int64_t safeBottom = static_cast<std::int64_t>(metrics.safeAreaY)
        + static_cast<std::int64_t>(metrics.safeAreaHeight);
    return {
        static_cast<double>(std::clamp<std::int64_t>(
            metrics.safeAreaX,
            0,
            windowWidth
        )),
        static_cast<double>(std::clamp<std::int64_t>(
            metrics.safeAreaY,
            0,
            windowHeight
        )),
        static_cast<double>(std::clamp<std::int64_t>(
            windowWidth - safeRight,
            0,
            windowWidth
        )),
        static_cast<double>(std::clamp<std::int64_t>(
            windowHeight - safeBottom,
            0,
            windowHeight
        ))
    };
}

[[nodiscard]] double titleEntranceElapsedSeconds(
    const ui::TitleTimelineSnapshot& title
) noexcept {
    switch (title.phase) {
    case ui::TitlePhase::sceneTransition:
        return title.phaseElapsedSeconds;
    case ui::TitlePhase::interactive:
        return ui::TitleOverlayStateMachine::scene_transition_seconds;
    case ui::TitlePhase::loadingDelay:
    case ui::TitlePhase::logoPlayback:
        return 0.0;
    }
    return 0.0;
}

[[nodiscard]] bool tryTranslateTitlePointer(
    const platform::sdl::PlatformEvent& source,
    const platform::sdl::WindowMetrics& metrics,
    const TitleDisplayArea& displayArea,
    ui::UiPointerEvent& output
) noexcept {
    if (source.kind != platform::sdl::PlatformEventKind::pointerChanged) {
        return false;
    }

    ui::UiPointerDevice device{};
    switch (source.pointer.device) {
    case platform::sdl::PlatformPointerDevice::mouse:
        device = ui::UiPointerDevice::mouse;
        break;
    case platform::sdl::PlatformPointerDevice::touch:
        device = ui::UiPointerDevice::touch;
        break;
    case platform::sdl::PlatformPointerDevice::none:
        return false;
    }

    ui::UiPointerEventType type{};
    switch (source.pointer.phase) {
    case platform::sdl::PlatformPointerPhase::moved:
        type = ui::UiPointerEventType::move;
        break;
    case platform::sdl::PlatformPointerPhase::pressed:
        type = ui::UiPointerEventType::down;
        break;
    case platform::sdl::PlatformPointerPhase::released:
        type = ui::UiPointerEventType::up;
        break;
    case platform::sdl::PlatformPointerPhase::canceled:
        type = ui::UiPointerEventType::cancel;
        break;
    case platform::sdl::PlatformPointerPhase::none:
        return false;
    }

    ui::UiPointerButton button = ui::UiPointerButton::none;
    if (device == ui::UiPointerDevice::mouse
        && type != ui::UiPointerEventType::move
        && type != ui::UiPointerEventType::cancel) {
        switch (source.pointer.button) {
        case platform::sdl::PlatformPointerButton::primary:
            button = ui::UiPointerButton::left;
            break;
        case platform::sdl::PlatformPointerButton::secondary:
            button = ui::UiPointerButton::right;
            break;
        case platform::sdl::PlatformPointerButton::middle:
            button = ui::UiPointerButton::middle;
            break;
        case platform::sdl::PlatformPointerButton::none:
        case platform::sdl::PlatformPointerButton::auxiliary1:
        case platform::sdl::PlatformPointerButton::auxiliary2:
        case platform::sdl::PlatformPointerButton::other:
            return false;
        }
    }

    double x = source.pointer.x;
    double y = source.pointer.y;
    if (source.pointer.coordinatesNormalized) {
        x *= static_cast<double>(std::max(metrics.windowWidth, 0));
        y *= static_cast<double>(std::max(metrics.windowHeight, 0));
    }
    const ui::layout::PointD localPosition = titleLocalPoint({x, y}, displayArea);
    output = {
        .type = type,
        .device = device,
        .button = button,
        .pointerId = device == ui::UiPointerDevice::mouse
            ? 0U
            : source.pointer.pointerId,
        .position = localPosition
    };
    return true;
}

[[nodiscard]] const char* storageResultName(
    const platform::sdl::StorageResult result
) noexcept {
    using platform::sdl::StorageResult;
    switch (result) {
    case StorageResult::success:
        return "success";
    case StorageResult::alreadyOpen:
        return "already-open";
    case StorageResult::notOpen:
        return "not-open";
    case StorageResult::notReady:
        return "not-ready";
    case StorageResult::invalidArgument:
        return "invalid-argument";
    case StorageResult::readLimitExceeded:
        return "read-limit-exceeded";
    case StorageResult::addressSpaceExceeded:
        return "address-space-exceeded";
    case StorageResult::allocationFailed:
        return "allocation-failed";
    case StorageResult::backendFailure:
    default:
        return "backend-failure";
    }
}

[[nodiscard]] const char* audioResultName(
    const platform::sdl::AudioDeviceResult result
) noexcept {
    using platform::sdl::AudioDeviceResult;
    switch (result) {
    case AudioDeviceResult::success:
        return "success";
    case AudioDeviceResult::alreadyOpen:
        return "already-open";
    case AudioDeviceResult::notOpen:
        return "not-open";
    case AudioDeviceResult::subsystemNotInitialized:
        return "subsystem-not-initialized";
    case AudioDeviceResult::noPlaybackDevice:
        return "no-playback-device";
    case AudioDeviceResult::deviceEnumerationFailed:
        return "device-enumeration-failed";
    case AudioDeviceResult::deviceOpenFailed:
        return "device-open-failed";
    case AudioDeviceResult::commandFailed:
    default:
        return "command-failed";
    }
}

} // namespace

Application::Application()
    : renderer_([this](const render::backend::RenderBackendKind kind) {
          return makeRenderBackend(kind);
      }),
      settingsStorage_(storage_),
      settingsRepository_(
          settingsStorage_,
          {settings::Language::userLanguage}
      ),
      titleTheme_(ui::layout::darkThemeMetrics()),
      framePacket_(render::maximumFramePacketCapacity(
          render::maximumFramePacketCapacity(
              render::frontend::syntheticTestSceneCapacity(),
              render::frontend::maximumPlayableGameSceneCapacity()
          ),
          render::frontend::maximumTitleSceneCapacity()
      )) {}

std::unique_ptr<render::backend::IRenderBackend> Application::makeRenderBackend(
    const render::backend::RenderBackendKind kind
) {
    switch (kind) {
    case render::backend::RenderBackendKind::sdlGpu:
        if (!window_.recreate(platform::sdl::WindowGraphicsProfile::neutral, true)) {
            return {};
        }
        return std::make_unique<render::sdl_gpu::SdlGpuBackend>(window_.nativeHandle());
    case render::backend::RenderBackendKind::gles:
        return std::make_unique<GlesWindowBackend>(window_);
    case render::backend::RenderBackendKind::software:
        if (!window_.recreate(platform::sdl::WindowGraphicsProfile::neutral, true)) {
            return {};
        }
        return std::make_unique<render::software::SoftwareBackend>(window_.nativeHandle());
    }
    return {};
}

bool Application::initializeRenderer(
    const render::backend::RendererPreference preference
) noexcept {
    const render::backend::RendererSelection selection{
        preference,
        true,
        sceneMode_ == SceneMode::title
    };
    try {
        if (!renderer_.initialize(selection)) {
            const render::backend::RendererSelectionDiagnostics& diagnostics =
                renderer_.lastDiagnostics();
            for (const render::backend::BackendAttemptDiagnostic& attempt :
                 diagnostics.attempts) {
                const std::string_view name = render::backend::renderBackendKindName(
                    attempt.kind
                );
                SDL_LogError(
                    SDL_LOG_CATEGORY_APPLICATION,
                    "Renderer attempt %s failed: %s",
                    name.data(),
                    attempt.reason.c_str()
                );
            }
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Renderer selection failed: %s",
                diagnostics.terminalFailureReason.c_str()
            );
            return false;
        }
    } catch (const std::exception& error) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Renderer selection raised an exception: %s",
            error.what()
        );
        return false;
    } catch (...) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Renderer selection raised a non-standard exception."
        );
        return false;
    }

    if (window_.nativeHandle() == nullptr || !window_.show()) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Selected renderer did not produce a usable window: %s",
            SDL_GetError()
        );
        renderer_.shutdown();
        return false;
    }
    drawableReady_ = false;
    rendererSizeDirty_ = true;

    const auto selected = renderer_.selectedBackend();
    const render::backend::RenderCapabilities* const capabilities = renderer_.capabilities();
    if (!selected.has_value() || capabilities == nullptr) {
        renderer_.shutdown();
        return false;
    }
    const std::string_view name = render::backend::renderBackendKindName(*selected);
    SDL_LogInfo(
        SDL_LOG_CATEGORY_APPLICATION,
        "Renderer ready: %s / %s / %s",
        name.data(),
        capabilities->backendName.c_str(),
        capabilities->adapterName.c_str()
    );
    return true;
}

bool Application::rebuildRenderer(const bool skipCurrentBackend) noexcept {
    render::backend::RendererPreference recoveryPreference = rendererPreference_;
    if (skipCurrentBackend) {
        const auto failedBackend = renderer_.selectedBackend();
        if (!failedBackend.has_value()
            || *failedBackend == render::backend::RenderBackendKind::software) {
            return false;
        }
        recoveryPreference = *failedBackend == render::backend::RenderBackendKind::sdlGpu
            ? render::backend::RendererPreference::gles
            : render::backend::RendererPreference::software;
    }

    clearMovementActions();
    static_cast<void>(titleUiController_.handleFocusLost());
    static_cast<void>(debugRuntime_.handleFocusLost());
    renderer_.shutdown();
    drawableReady_ = false;
    rendererSizeDirty_ = true;
    if (!initializeRenderer(recoveryPreference)) {
        return false;
    }
    resetFrameClock();
    renderDeviceRecoveryPending_ = false;
    renderTargetsResetPending_ = false;
    return true;
}

bool Application::prepareRendererForForeground() noexcept {
    if (renderDeviceRecoveryPending_ && !rebuildRenderer(false)) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Renderer device recovery exhausted every configured backend."
        );
        return false;
    }

    for (std::size_t attempt = 0; attempt < 3U; ++attempt) {
        if (renderer_.onForeground()) {
            break;
        }
        const auto failedBackend = renderer_.selectedBackend();
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Renderer %s foreground recovery failed; trying the next backend.",
            failedBackend.has_value()
                ? render::backend::renderBackendKindName(*failedBackend).data()
                : "unknown"
        );
        if (!rebuildRenderer(true)) {
            return false;
        }
        if (attempt == 2U) {
            return false;
        }
    }

    if (renderTargetsResetPending_) {
        if (!renderer_.onRenderTargetsReset()) {
            const auto failedBackend = renderer_.selectedBackend();
            SDL_LogWarn(
                SDL_LOG_CATEGORY_APPLICATION,
                "Renderer %s target reset recovery failed; trying the next backend.",
                failedBackend.has_value()
                    ? render::backend::renderBackendKindName(*failedBackend).data()
                    : "unknown"
            );
            if (!rebuildRenderer(true)) {
                return false;
            }
            return prepareRendererForForeground();
        }
        renderTargetsResetPending_ = false;
        rendererSizeDirty_ = true;
    }

    if ((rendererSizeDirty_ || !drawableReady_) && !refreshRendererSize()) {
        const auto failedBackend = renderer_.selectedBackend();
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Renderer %s resize recovery failed; trying the next backend.",
            failedBackend.has_value()
                ? render::backend::renderBackendKindName(*failedBackend).data()
                : "unknown"
        );
        if (!rebuildRenderer(true)) {
            return false;
        }
        return prepareRendererForForeground();
    }
    configureActiveCallbackRate();
    return true;
}

bool Application::refreshRendererSize() noexcept {
    rendererSizeDirty_ = true;
    if (!window_.refreshMetrics()) {
        drawableReady_ = false;
        return false;
    }
    const platform::sdl::WindowMetrics& metrics = window_.metrics();
    if (sceneMode_ == SceneMode::title && !refreshTitleLayout()) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Native title layout refresh failed for %dx%d logical units.",
            metrics.windowWidth,
            metrics.windowHeight
        );
        drawableReady_ = false;
        return false;
    }
    ++projectionRevision_;
    if (metrics.pixelWidth <= 0 || metrics.pixelHeight <= 0) {
        drawableReady_ = false;
        rendererSizeDirty_ = false;
        return true;
    }
    if (!renderer_.resize(metrics.pixelWidth, metrics.pixelHeight)) {
        drawableReady_ = false;
        return false;
    }
    drawableReady_ = true;
    rendererSizeDirty_ = false;
    return true;
}

bool Application::refreshTitleLayout() noexcept {
    return refreshTitleLayout(activeSettings());
}

bool Application::refreshTitleLayout(
    const settings::GameSettings& runtimeSettings
) noexcept {
    const platform::sdl::WindowMetrics& metrics = window_.metrics();
    if (metrics.windowWidth <= 0 || metrics.windowHeight <= 0) {
        return titleLayout_.hasSnapshot();
    }

    TitleDisplayArea candidateDisplayArea{};
    if (!tryResolveTitleDisplayArea(
            static_cast<double>(metrics.windowWidth),
            static_cast<double>(metrics.windowHeight),
            logicalSafeArea(metrics),
            runtimeSettings.widescreenSupport,
            candidateDisplayArea)) {
        return false;
    }

    ui::layout::UiLayoutMetrics candidateLayout = titleLayout_;
    ui::layout::LayoutInput input{
        .logicalWidth = candidateDisplayArea.logicalWidth,
        .logicalHeight = candidateDisplayArea.logicalHeight,
        .uiScale = static_cast<double>(runtimeSettings.uiScalePercent) / 100.0,
        .hasVersionHistoryLink = true,
        .logicalSafeArea = candidateDisplayArea.logicalSafeArea
    };
    if (!candidateLayout.tryUpdate(input)) {
        return false;
    }
    if (titleTextCache_ == nullptr
        && !prepareTitleTextResources(runtimeSettings)) {
        return false;
    }
    if (titleTextCache_ != nullptr) {
        const render::PreShapedTextRunView* const versionLink =
            titleTextCache_->textResources().find(
                render::text::titleTextKey(
                    render::UiTextSemanticId::versionHistoryLink,
                    titleLocaleFor(runtimeSettings.language)
                )
            );
        const auto& labelTypography = candidateLayout.snapshot().typography[
            static_cast<std::size_t>(ui::layout::TypographyRole::label)
        ];
        if (versionLink == nullptr || versionLink->rasterPixelSize == 0U) {
            return false;
        }
        input.versionHistoryLinkTextWidth = static_cast<double>(versionLink->advance)
            * labelTypography.size
            / static_cast<double>(versionLink->rasterPixelSize);
        if (!candidateLayout.tryUpdate(input)) {
            return false;
        }
    }
    const ui::UiStateSnapshot state = titleUiState_.snapshot();
    ui::layout::TitleEntranceRenderState candidateEntrance{};
    if (!ui::layout::trySampleTitleEntrance(
            candidateLayout.snapshot(),
            titleEntranceElapsedSeconds(state.title),
            candidateEntrance
        )) {
        return false;
    }

    const bool displayAreaChanged = candidateDisplayArea != titleDisplayArea_;
    titleLayout_ = candidateLayout;
    titleEntrance_ = candidateEntrance;
    titleDisplayArea_ = candidateDisplayArea;
    if (displayAreaChanged) {
        static_cast<void>(titleUiController_.handleFocusLost());
        projectionRevision_ = projectionRevision_
                == std::numeric_limits<std::uint64_t>::max()
            ? 1U
            : projectionRevision_ + 1U;
    }
    return true;
}

bool Application::loadTitleTextAssets() noexcept {
    platform::sdl::RuntimeAssetReadResult font =
        platform::sdl::readRuntimeAsset(
            "font/PretendardVariable.woff2",
            maximumBundledFontBytes
        );
    if (!font.success()) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Pretendard runtime asset load failed with code %u.",
            static_cast<unsigned int>(font.error)
        );
        return false;
    }
    titleFontBytes_ = std::move(font.bytes);
    return true;
}

bool Application::prepareTitleTextResources() noexcept {
    return prepareTitleTextResources(activeSettings());
}

bool Application::prepareTitleTextResources(
    const settings::GameSettings& runtimeSettings
) noexcept {
    if (titleFontBytes_.empty()) {
        return false;
    }
    const std::uint64_t candidateGeneration = titleTextGeneration_
            == std::numeric_limits<std::uint64_t>::max()
        ? 1U
        : titleTextGeneration_ + 1U;
    DynamicTitleTextBuffers dynamicText{};
    const TitlePreloadSpecs specs = makeTitlePreloadSpecs(
        runtimeSettings,
        dynamicText
    );
    render::text::ShapedTextCacheBuildError error =
        render::text::ShapedTextCacheBuildError::none;
    std::unique_ptr<render::text::ShapedTextCache> candidate =
        render::text::ShapedTextCache::create(
            titleFontBytes_,
            specs,
            candidateGeneration,
            error
        );
    if (candidate == nullptr) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Pretendard text preload failed with code %u; previous snapshot retained.",
            static_cast<unsigned int>(error)
        );
        return false;
    }
    titleTextCache_ = std::move(candidate);
    titleTextGeneration_ = candidateGeneration;
    return true;
}

const settings::GameSettings& Application::activeSettings() const noexcept {
    const settings::SettingsOverlaySessionSnapshot session =
        settingsOverlaySession_.snapshot();
    return session.active ? settingsOverlaySession_.draft() : settingsRepository_.current();
}

render::UiTextLocale Application::activeTitleLocale() const noexcept {
    return titleLocaleFor(activeSettings().language);
}

ui::UiFrameContext Application::currentUiFrameContext() const noexcept {
    return {.animationPaused = debugRuntime_.snapshot().animationPaused};
}

bool Application::buildTitleControlStateOverrides(
    const ui::UiStateSnapshot& state,
    ui::TitleOverlayControlStateOverrides& output
) const noexcept {
    ui::TitleOverlayControlStateOverrides candidate{};
    candidate.revision = std::max<std::uint64_t>(titleControlStateRevision_, 1U);
    const auto append = [&candidate](
        const std::uint32_t sequence,
        const ui::TitleOverlayControlId id,
        const double value,
        const bool selected,
        const bool enabled
    ) noexcept {
        if (sequence == 0U
            || candidate.controlCount >= candidate.controls.size()) {
            return false;
        }
        candidate.controls[candidate.controlCount++] = {
            sequence,
            id,
            std::clamp(value, 0.0, 1.0),
            selected,
            enabled
        };
        return true;
    };

    const settings::SettingsOverlaySessionSnapshot session =
        settingsOverlaySession_.snapshot();
    const settings::GameSettings& settings = activeSettings();
    const bool settingsReady = settingsBootState_ == SettingsBootState::loaded;
    for (std::size_t index = 0U; index < state.overlayCount; ++index) {
        const ui::OverlaySnapshot& overlay = state.overlays[index];
        if (overlay.kind == ui::OverlayKind::setting) {
            const bool controlsEnabled = settingsReady
                && session.active
                && session.overlaySequence == overlay.sequence
                && overlay.phase != ui::OverlayPhase::closing;
            const double renderScale = static_cast<double>(
                settings.renderScalePercent - settings::minimum_render_scale_percent
            ) / static_cast<double>(
                settings::maximum_render_scale_percent
                    - settings::minimum_render_scale_percent
            );
            const double uiScale = static_cast<double>(
                settings.uiScalePercent - settings::minimum_ui_scale_percent
            ) / static_cast<double>(
                settings::maximum_ui_scale_percent - settings::minimum_ui_scale_percent
            );
            if (!append(overlay.sequence,
                    ui::TitleOverlayControlId::settingWindowMode,
                    settings.windowMode == settings::WindowMode::fullscreen ? 1.0 : 0.0,
                    settings.windowMode == settings::WindowMode::fullscreen,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingUltrawide,
                    settings.widescreenSupport ? 1.0 : 0.0,
                    settings.widescreenSupport,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingRenderScale,
                    renderScale,
                    false,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingUiScale,
                    uiScale,
                    false,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingOpaqueUi,
                    settings.disableTransparency ? 1.0 : 0.0,
                    settings.disableTransparency,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingBenchmark,
                    0.0,
                    false,
                    false)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingLanguage,
                    settings.language == settings::Language::english ? 1.0 : 0.0,
                    settings.language == settings::Language::english,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingTheme,
                    settings.theme == settings::Theme::dark ? 1.0 : 0.0,
                    settings.theme == settings::Theme::dark,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingTooltipDelay,
                    static_cast<double>(settings.tooltipDelayTenths)
                        / static_cast<double>(settings::maximum_tooltip_delay_tenths),
                    false,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingBgm,
                    static_cast<double>(settings.bgmVolumePercent)
                        / static_cast<double>(settings::maximum_volume_percent),
                    false,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::settingSfx,
                    static_cast<double>(settings.sfxVolumePercent)
                        / static_cast<double>(settings::maximum_volume_percent),
                    false,
                    controlsEnabled)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::cancel,
                    0.0,
                    false,
                    true)
                || !append(overlay.sequence,
                    ui::TitleOverlayControlId::confirm,
                    0.0,
                    false,
                    controlsEnabled)) {
                return false;
            }
        } else if (overlay.kind == ui::OverlayKind::debug) {
            const debug::DebugRuntimeSnapshot debug = debugRuntime_.snapshot();
            constexpr std::array ids{
                ui::TitleOverlayControlId::debugFrameTime,
                ui::TitleOverlayControlId::debugPoolInfo,
                ui::TitleOverlayControlId::debugHitboxes,
                ui::TitleOverlayControlId::debugAnimation
            };
            for (std::size_t optionIndex = 0U;
                 optionIndex < ids.size();
                 ++optionIndex) {
                const bool selected = debug.displayOptions[optionIndex];
                if (!append(
                        overlay.sequence,
                        ids[optionIndex],
                        selected ? 1.0 : 0.0,
                        selected,
                        debug.debugModeEnabled)) {
                    return false;
                }
            }
        }
    }
    output = candidate;
    return true;
}

bool Application::applyRuntimeSettings(
    const settings::GameSettings& candidate,
    const settings::SettingsOverlayFieldMask changedFields,
    const bool applyWindow
) noexcept {
    if (includesSettingsField(changedFields, settings::SettingsOverlayField::theme)
        || includesSettingsField(
            changedFields,
            settings::SettingsOverlayField::disableTransparency)) {
        titleTheme_ = ui::layout::themeMetrics(
            candidate.theme == settings::Theme::dark
                ? ui::layout::ThemeVariant::dark
                : ui::layout::ThemeVariant::light
        );
    }

    const settings::SettingsOverlayFieldMask textFields =
        static_cast<settings::SettingsOverlayFieldMask>(
            allSettingsOverlayFields
            & ~settings::settingsOverlayFieldBit(
                settings::SettingsOverlayField::widescreenSupport)
            & ~settings::settingsOverlayFieldBit(
                settings::SettingsOverlayField::disableTransparency)
        );
    if (sceneMode_ == SceneMode::title
        && !titleFontBytes_.empty()
        && (changedFields & textFields) != 0U
        && !prepareTitleTextResources(candidate)) {
        return false;
    }
    if (sceneMode_ == SceneMode::title
        && titleLayout_.hasSnapshot()
        && (changedFields != 0U)
        && !refreshTitleLayout(candidate)) {
        return false;
    }
    if (applyWindow
        && includesSettingsField(
            changedFields,
            settings::SettingsOverlayField::windowMode)
        && !applyWindowSettings(candidate)) {
        return false;
    }
    redrawPending_ = true;
    return true;
}

bool Application::applyWindowSettings(
    const settings::GameSettings& candidate
) noexcept {
    const platform::sdl::WindowDisplayConfiguration display{
        .fullscreen = candidate.windowMode == settings::WindowMode::fullscreen,
        .width = candidate.width,
        .height = candidate.height
    };
    return applyWindowDisplayConfiguration(display);
}

bool Application::applyWindowDisplayConfiguration(
    const platform::sdl::WindowDisplayConfiguration& display
) noexcept {
    if (display == window_.displayConfiguration()) {
        return true;
    }
    if (!window_.applyDisplayConfiguration(display)) {
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Runtime window-mode preview failed and the previous mode was retained: %s",
            SDL_GetError()
        );
        return false;
    }
    rendererSizeDirty_ = true;
    redrawPending_ = true;
    return true;
}

bool Application::synchronizeSettingsOverlaySession() noexcept {
    const ui::UiStateSnapshot state = titleUiState_.snapshot();
    const ui::OverlaySnapshot* const setting = findLatestOverlay(
        state,
        ui::OverlayKind::setting
    );
    settings::SettingsOverlaySessionSnapshot session =
        settingsOverlaySession_.snapshot();

    if (settingsDismissedSequence_ != 0U
        && (setting == nullptr || setting->sequence != settingsDismissedSequence_)) {
        settingsDismissedSequence_ = 0U;
    }

    if (session.active
        && (setting == nullptr || setting->sequence != session.overlaySequence)) {
        if (settingsWindowPreviewSequence_ == session.overlaySequence
            && !smokeTest_
            && !(settingsWindowBaselineSequence_ == session.overlaySequence
                ? applyWindowDisplayConfiguration(settingsWindowBaseline_)
                : applyWindowSettings(session.baseline))) {
            // 같은 창 handle의 SDL rollback이 실패한 동안 draft authority를
            // 유지하고 다음 frame에 다시 시도한다.
            return true;
        }
        settings::GameSettings baseline{};
        settings::SettingsOverlayFieldMask changedFields = 0U;
        if (!settingsOverlaySession_.discard(
                session.overlaySequence,
                baseline,
                changedFields)) {
            return false;
        }
        if (changedFields != 0U
            && !applyRuntimeSettings(baseline, changedFields, false)) {
            return false;
        }
        settingsWindowBaselineSequence_ = 0U;
        settingsWindowPreviewSequence_ = 0U;
        incrementTitleControlStateRevision();
        session = settingsOverlaySession_.snapshot();
    }

    if (!session.active
        && setting != nullptr
        && setting->phase != ui::OverlayPhase::closing
        && setting->sequence != settingsDismissedSequence_
        && settingsBootState_ == SettingsBootState::loaded) {
        if (!settingsOverlaySession_.begin(
                setting->sequence,
                settingsRepository_.current())) {
            return false;
        }
        settingsWindowBaseline_ = window_.displayConfiguration();
        settingsWindowBaselineSequence_ = setting->sequence;
        settingsWindowPreviewSequence_ = 0U;
        incrementTitleControlStateRevision();
    }
    return true;
}

bool Application::persistDebugMode(const bool enabled) noexcept {
    if (settingsBootState_ == SettingsBootState::unavailable) {
        debugPersistencePending_ = false;
        debugPersistenceAttemptCount_ = 0U;
        debugPersistenceRetryAtMilliseconds_ = 0U;
        return true;
    }
    if (settingsBootState_ != SettingsBootState::loaded) {
        pendingDebugMode_ = enabled;
        debugPersistencePending_ = true;
        debugPersistenceAttemptCount_ = 0U;
        debugPersistenceRetryAtMilliseconds_ = 0U;
        return false;
    }
    settings::GameSettings candidate = settingsRepository_.current();
    candidate.debugMode = enabled;
    if (candidate == settingsRepository_.current()) {
        debugPersistencePending_ = false;
        debugPersistenceAttemptCount_ = 0U;
        debugPersistenceRetryAtMilliseconds_ = 0U;
        return true;
    }
    const settings::SettingsSaveResult saved = settingsRepository_.save(candidate);
    if (!saved.succeeded()) {
        pendingDebugMode_ = enabled;
        debugPersistencePending_ = true;
        debugPersistenceAttemptCount_ = 0U;
        debugPersistenceRetryAtMilliseconds_ =
            SDL_GetTicks() + debugPersistenceRetryDelayMilliseconds;
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Debug-mode persistence failed with save error %u; runtime state retained for retry.",
            static_cast<unsigned int>(saved.error)
        );
        return false;
    }
    debugPersistencePending_ = false;
    debugPersistenceAttemptCount_ = 0U;
    debugPersistenceRetryAtMilliseconds_ = 0U;
    return true;
}

void Application::retryPendingDebugPersistence() noexcept {
    if (!debugPersistencePending_) {
        return;
    }
    if (settingsBootState_ == SettingsBootState::unavailable) {
        debugPersistencePending_ = false;
        debugPersistenceAttemptCount_ = 0U;
        debugPersistenceRetryAtMilliseconds_ = 0U;
        return;
    }
    if (settingsBootState_ != SettingsBootState::loaded) {
        return;
    }

    const std::uint64_t now = SDL_GetTicks();
    if (now < debugPersistenceRetryAtMilliseconds_
        || debugPersistenceAttemptCount_
            >= maximumDebugPersistenceRetryCount) {
        return;
    }

    settings::GameSettings candidate = settingsRepository_.current();
    candidate.debugMode = pendingDebugMode_;
    if (candidate == settingsRepository_.current()) {
        debugPersistencePending_ = false;
        debugPersistenceAttemptCount_ = 0U;
        debugPersistenceRetryAtMilliseconds_ = 0U;
        return;
    }

    const settings::SettingsSaveResult saved = settingsRepository_.save(candidate);
    if (saved.succeeded()) {
        debugPersistencePending_ = false;
        debugPersistenceAttemptCount_ = 0U;
        debugPersistenceRetryAtMilliseconds_ = 0U;
        SDL_LogInfo(
            SDL_LOG_CATEGORY_APPLICATION,
            "Debug-mode persistence recovered on retry."
        );
        return;
    }

    ++debugPersistenceAttemptCount_;
    if (debugPersistenceAttemptCount_
        < maximumDebugPersistenceRetryCount) {
        debugPersistenceRetryAtMilliseconds_ =
            now + debugPersistenceRetryDelayMilliseconds;
        return;
    }
    debugPersistenceRetryAtMilliseconds_ =
        std::numeric_limits<std::uint64_t>::max();
    SDL_LogWarn(
        SDL_LOG_CATEGORY_APPLICATION,
        "Debug-mode persistence retry limit reached with save error %u; runtime state remains active and the next explicit settings save can reconcile it.",
        static_cast<unsigned int>(saved.error)
    );
}

void Application::handleDebugEffect(
    const debug::DebugRuntimeEffect& effect
) noexcept {
    if (effect.persistDebugMode) {
        static_cast<void>(persistDebugMode(effect.debugModeEnabled));
    }
    if (sceneMode_ != SceneMode::title) {
        return;
    }
    ui::UiActionOutcome outcome{};
    switch (effect.overlayIntent) {
    case debug::DebugOverlayIntent::open:
        outcome = titleUiState_.apply(
            ui::UiAction::openDebug(),
            currentUiFrameContext()
        );
        break;
    case debug::DebugOverlayIntent::close:
        outcome = titleUiState_.apply(
            ui::UiAction::closeDebug(),
            currentUiFrameContext()
        );
        break;
    case debug::DebugOverlayIntent::none:
        break;
    }
    redrawPending_ = redrawPending_ || outcome.accepted();
    if (effect.stateRevision != 0U || outcome.accepted()) {
        incrementTitleControlStateRevision();
    }
}

bool Application::handleApplicationControl(
    const ui::UiInputResult& result
) noexcept {
    if (!result.applicationControlActivated() || result.overlaySequence == 0U) {
        return true;
    }
    const ui::UiStateSnapshot state = titleUiState_.snapshot();
    const ui::OverlaySnapshot* setting = findLatestOverlay(
        state,
        ui::OverlayKind::setting
    );
    if (setting != nullptr && setting->sequence == result.overlaySequence) {
        if (result.overlayControlId == ui::TitleOverlayControlId::cancel) {
            const ui::UiActionOutcome closed = titleUiState_.apply(
                ui::UiAction::cancelTop(),
                currentUiFrameContext()
            );
            redrawPending_ = redrawPending_ || closed.accepted();
            return true;
        }
        if (result.overlayControlId == ui::TitleOverlayControlId::confirm) {
            const settings::SettingsOverlaySessionSnapshot session =
                settingsOverlaySession_.snapshot();
            if (settingsBootState_ != SettingsBootState::loaded
                || !session.active
                || session.overlaySequence != result.overlaySequence) {
                return true;
            }
            settings::GameSettings candidate{};
            if (!settingsOverlaySession_.tryBuildSaveCandidate(
                    result.overlaySequence,
                    settingsRepository_.current(),
                    candidate)) {
                return false;
            }
            candidate.debugMode = debugRuntime_.snapshot().debugModeEnabled;
            const platform::sdl::WindowDisplayConfiguration& windowAuthority =
                candidate.windowMode == settings::WindowMode::fullscreen
                    && settingsWindowBaselineSequence_
                        == result.overlaySequence
                ? settingsWindowBaseline_
                : window_.displayConfiguration();
            if (windowAuthority.width >= settings::minimum_window_width
                && windowAuthority.height >= settings::minimum_window_height) {
                candidate.width = windowAuthority.width;
                candidate.height = windowAuthority.height;
            }
            if (candidate != settingsRepository_.current()) {
                const settings::SettingsSaveResult saved =
                    settingsRepository_.save(candidate);
                if (!saved.succeeded()) {
                    SDL_LogWarn(
                        SDL_LOG_CATEGORY_APPLICATION,
                        "Settings save failed with error %u; draft remains open.",
                        static_cast<unsigned int>(saved.error)
                    );
                    return true;
                }
            }
            debugPersistencePending_ = false;
            debugPersistenceAttemptCount_ = 0U;
            debugPersistenceRetryAtMilliseconds_ = 0U;
            if (!settingsOverlaySession_.acceptSaved(
                    result.overlaySequence,
                    settingsRepository_.current())) {
                return false;
            }
            settingsWindowBaselineSequence_ = 0U;
            settingsWindowPreviewSequence_ = 0U;
            settingsDismissedSequence_ = result.overlaySequence;
            incrementTitleControlStateRevision();
            const ui::UiActionOutcome closed = titleUiState_.apply(
                ui::UiAction::cancelTop(),
                currentUiFrameContext()
            );
            redrawPending_ = redrawPending_ || closed.accepted();
            return true;
        }

        settings::SettingsOverlayField field{};
        if (!result.normalizedValueValid
            || !settingsFieldForControl(result.overlayControlId, field)) {
            return true;
        }
        const settings::GameSettings previousDraft =
            settingsOverlaySession_.draft();
        const settings::SettingsOverlayUpdate update =
            settingsOverlaySession_.activate(
                result.overlaySequence,
                field,
                result.normalizedValue
            );
        if (!update.accepted() || !update.changed) {
            return true;
        }
        if (!applyRuntimeSettings(
                settingsOverlaySession_.draft(),
                settings::settingsOverlayFieldBit(field),
                !smokeTest_)) {
            if (field == settings::SettingsOverlayField::windowMode) {
                const settings::SettingsOverlayUpdate restored =
                    settingsOverlaySession_.activate(
                        result.overlaySequence,
                        field,
                        previousDraft.windowMode == settings::WindowMode::fullscreen
                            ? 1.0
                            : 0.0
                    );
                if (!restored.accepted()
                    || !applyRuntimeSettings(
                        previousDraft,
                        settings::settingsOverlayFieldBit(field),
                        false)) {
                    return false;
                }
                incrementTitleControlStateRevision();
                return true;
            }
            return false;
        }
        if (field == settings::SettingsOverlayField::windowMode) {
            settingsWindowPreviewSequence_ = result.overlaySequence;
        }
        incrementTitleControlStateRevision();
        return true;
    }

    const ui::OverlaySnapshot* const debugOverlay = findLatestOverlay(
        state,
        ui::OverlayKind::debug
    );
    if (debugOverlay == nullptr
        || debugOverlay->sequence != result.overlaySequence
        || !debugRuntime_.snapshot().debugModeEnabled) {
        return true;
    }
    debug::DebugDisplayOption option{};
    if (debugOptionForControl(result.overlayControlId, option)
        && debugRuntime_.toggleDisplayOption(option)) {
        incrementTitleControlStateRevision();
        redrawPending_ = true;
    }
    return true;
}

void Application::incrementTitleControlStateRevision() noexcept {
    titleControlStateRevision_ = titleControlStateRevision_
            == std::numeric_limits<std::uint64_t>::max()
        ? 1U
        : titleControlStateRevision_ + 1U;
}

std::uint64_t Application::refreshTitleBackdropRevision(
    const ui::UiStateSnapshot& state,
    const ui::TitleUiControllerSnapshot& interaction,
    const std::uint64_t controlStateRevision
) noexcept {
    const std::size_t overlayCount = std::min<std::size_t>(
        state.overlayCount,
        state.overlays.size()
    );
    const bool overlaysChanged = overlayCount != titleBackdropOverlayCount_
        || !std::equal(
            state.overlays.begin(),
            state.overlays.begin() + overlayCount,
            titleBackdropOverlays_.begin()
        );
    const bool changed = !titleBackdropSnapshotValid_
        || titleBackdropProjectionRevision_ != projectionRevision_
        || titleBackdropControlStateRevision_ != controlStateRevision
        || titleBackdropLayout_ != titleLayout_.snapshot()
        || titleBackdropEntrance_ != titleEntrance_
        || titleBackdropInteraction_ != interaction
        || overlaysChanged;
    if (!changed) {
        return titleBackdropRevision_;
    }

    if (titleBackdropSnapshotValid_
        && titleBackdropRevision_ < std::numeric_limits<std::uint64_t>::max()) {
        ++titleBackdropRevision_;
    }
    titleBackdropProjectionRevision_ = projectionRevision_;
    titleBackdropControlStateRevision_ = controlStateRevision;
    titleBackdropLayout_ = titleLayout_.snapshot();
    titleBackdropEntrance_ = titleEntrance_;
    titleBackdropInteraction_ = interaction;
    titleBackdropOverlays_.fill({});
    std::copy_n(
        state.overlays.begin(),
        overlayCount,
        titleBackdropOverlays_.begin()
    );
    titleBackdropOverlayCount_ = static_cast<std::uint8_t>(overlayCount);
    titleBackdropSnapshotValid_ = true;
    return titleBackdropRevision_;
}

bool Application::buildSyntheticFrame(const engine::FrameSchedule& schedule) noexcept {
    const platform::sdl::WindowMetrics& metrics = window_.metrics();
    render::frontend::SyntheticSceneConfig config;
    config.physicalDisplaySize = {metrics.pixelWidth, metrics.pixelHeight};
    config.physicalWindowBounds = {0, 0, metrics.pixelWidth, metrics.pixelHeight};
    config.drawableSize = {metrics.pixelWidth, metrics.pixelHeight};
    config.safeArea = drawableSafeArea(metrics);
    config.dpiScale = metrics.pixelDensity;
    config.uiScale = static_cast<float>(activeSettings().uiScalePercent) / 100.0F;
    config.worldRenderScale =
        static_cast<float>(activeSettings().renderScalePercent) / 100.0F;
    config.projectionRevision = projectionRevision_;
    config.frameId = renderedFrameCount_ + 1U;
    config.simulationTick = simulationTick_;
    const double alpha = std::isfinite(schedule.fixedAlpha)
        ? std::clamp(schedule.fixedAlpha, 0.0, 1.0)
        : 0.0;
    const auto alphaStep = static_cast<std::uint32_t>(alpha * 59.0);
    config.phaseStep = static_cast<std::uint32_t>(
        (simulationTick_ % 120U + alphaStep) % 120U
    );
    config.effectQuality = renderer_.selectedBackend()
            == render::backend::RenderBackendKind::software
        ? render::EffectQuality::softwareReplacement
        : render::EffectQuality::full;

    try {
        const render::frontend::SyntheticSceneResult result =
            render::frontend::buildSyntheticTestScene(
                framePacket_,
                config,
                render::frontend::PacketCapacityPolicy::fixedCapacity
            );
        if (!result.success) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Synthetic FramePacket build failed with code %u.",
                static_cast<unsigned int>(result.error)
            );
        }
        return result.success;
    } catch (const std::exception& error) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Synthetic FramePacket build raised an exception: %s",
            error.what()
        );
    } catch (...) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Synthetic FramePacket build raised a non-standard exception."
        );
    }
    return false;
}

bool Application::buildPlayableFrame(const engine::FrameSchedule& schedule) noexcept {
    if (gameSystem_ == nullptr) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Playable scene has no authoritative GameSystem session."
        );
        return false;
    }
    const platform::sdl::WindowMetrics& metrics = window_.metrics();
    render::frontend::PlayableGameSceneConfig config;
    config.physicalDisplaySize = {metrics.pixelWidth, metrics.pixelHeight};
    config.physicalWindowBounds = {0, 0, metrics.pixelWidth, metrics.pixelHeight};
    config.drawableSize = {metrics.pixelWidth, metrics.pixelHeight};
    config.safeArea = drawableSafeArea(metrics);
    config.dpiScale = metrics.pixelDensity;
    config.uiScale = static_cast<float>(activeSettings().uiScalePercent) / 100.0F;
    config.worldRenderScale =
        static_cast<float>(activeSettings().renderScalePercent) / 100.0F;
    config.widescreenSupport = activeSettings().widescreenSupport;
    config.projectionRevision = projectionRevision_;
    config.frameId = renderedFrameCount_ + 1U;
    config.simulationTick = simulationTick_;
    const double alpha = std::isfinite(schedule.fixedAlpha)
        ? std::clamp(schedule.fixedAlpha, 0.0, 1.0)
        : 0.0;
    config.interpolationAlpha = static_cast<float>(alpha);
    config.presentationTimeSeconds = (
        static_cast<double>(simulationTick_) + alpha
    ) * game::GameSystem::fixed_delta_seconds;

    try {
        const render::frontend::PlayableGameSceneResult result =
            render::frontend::buildPlayableGameScene(
                framePacket_,
                *gameSystem_,
                config,
                render::frontend::PacketCapacityPolicy::fixedCapacity
            );
        if (!result.success) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Playable FramePacket build failed with code %u.",
                static_cast<unsigned int>(result.error)
            );
        }
        return result.success;
    } catch (const std::exception& error) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Playable FramePacket build raised an exception: %s",
            error.what()
        );
    } catch (...) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Playable FramePacket build raised a non-standard exception."
        );
    }
    return false;
}

bool Application::buildTitleFrame(const engine::FrameSchedule& schedule) noexcept {
    if (!titleLayout_.hasSnapshot()) {
        return false;
    }
    const ui::UiStateSnapshot state = titleUiState_.snapshot();
    if (!ui::layout::trySampleTitleEntrance(
            titleLayout_.snapshot(),
            titleEntranceElapsedSeconds(state.title),
            titleEntrance_
        )) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Native title entrance sampling failed."
        );
        return false;
    }

    const platform::sdl::WindowMetrics& metrics = window_.metrics();
    const ui::TitleUiControllerSnapshot interaction = titleUiController_.snapshot();
    ui::TitleOverlayControlStateOverrides controlOverrides{};
    if (!buildTitleControlStateOverrides(state, controlOverrides)) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Native title control-state override capacity was exhausted."
        );
        return false;
    }
    if (!ui::tryBuildTitleOverlayPresentationSet(
            state,
            titleLayout_.snapshot(),
            titleOverlayPresentations_,
            &controlOverrides)) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Native title overlay presentation refresh failed."
        );
        return false;
    }
    const std::uint64_t backdropRevision = refreshTitleBackdropRevision(
        state,
        interaction,
        controlOverrides.revision
    );
    const render::frontend::TitleSceneInput input{
        state,
        interaction,
        titleLayout_.snapshot(),
        titleEntrance_,
        titleTheme_,
        titleTextCache_ == nullptr
            ? render::PreShapedTextResourcesView{}
            : titleTextCache_->textResources(),
        activeTitleLocale(),
        &titleOverlayPresentations_,
        activeSettings().disableTransparency
    };
    render::frontend::TitleSceneConfig config{};
    config.physicalDisplaySize = {metrics.pixelWidth, metrics.pixelHeight};
    config.physicalWindowBounds = {0, 0, metrics.pixelWidth, metrics.pixelHeight};
    config.drawableSize = {metrics.pixelWidth, metrics.pixelHeight};
    config.drawableSafeArea = drawableSafeArea(metrics);
    config.dpiScale = metrics.pixelDensity;
    config.projectionRevision = projectionRevision_;
    config.backdropRevision = backdropRevision;
    config.frameId = renderedFrameCount_ + 1U;
    config.simulationTick = simulationTick_;
    config.presentationTimeSeconds = state.title.elapsedSeconds;
    config.interpolationAlpha = static_cast<float>(std::clamp(
        schedule.fixedAlpha,
        0.0,
        1.0
    ));

    try {
        const render::frontend::TitleSceneResult result =
            render::frontend::buildTitleScene(framePacket_, input, config);
        if (!result.success) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Title FramePacket build failed with code %u.",
                static_cast<unsigned int>(result.error)
            );
            return false;
        }
        if (!titleMissingCapabilitiesReported_
            && result.missingCapabilities != 0U) {
            SDL_LogInfo(
                SDL_LOG_CATEGORY_APPLICATION,
                "Native title shell active; pending capability mask: 0x%08x.",
                static_cast<unsigned int>(result.missingCapabilities)
            );
            titleMissingCapabilitiesReported_ = true;
        }
        return true;
    } catch (const std::exception& error) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Title FramePacket build raised an exception: %s",
            error.what()
        );
    } catch (...) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Title FramePacket build raised a non-standard exception."
        );
    }
    return false;
}

bool Application::initialize(const int argc, char* argv[]) noexcept {
    if (initialized_) {
        return false;
    }
    lifecycle_.reset();
    smokeTest_ = false;
    titleToPlayableSmoke_ = false;
    sceneMode_ = SceneMode::title;
    gameSystem_.reset();
    titleUiState_ = {};
    titleUiController_ = {};
    settingsOverlaySession_ = {};
    debugRuntime_ = debug::DebugRuntimeController{};
    titleLayout_ = {};
    titleDisplayArea_ = {};
    titleTheme_ = ui::layout::darkThemeMetrics();
    titleEntrance_ = {};
    titleOverlayPresentations_ = {};
    titleBackdropLayout_ = {};
    titleBackdropEntrance_ = {};
    titleBackdropInteraction_ = {};
    titleBackdropOverlays_.fill({});
    titleBackdropOverlayCount_ = 0U;
    titleBackdropRevision_ = 1U;
    titleBackdropProjectionRevision_ = 0U;
    titleBackdropControlStateRevision_ = 0U;
    titleControlStateRevision_ = 1U;
    titleBackdropSnapshotValid_ = false;
    settingsDismissedSequence_ = 0U;
    settingsWindowBaseline_ = {};
    settingsWindowBaselineSequence_ = 0U;
    settingsWindowPreviewSequence_ = 0U;
    settingsBootState_ = SettingsBootState::waiting;
    debugPersistenceRetryAtMilliseconds_ = 0U;
    debugPersistenceAttemptCount_ = 0U;
    debugPersistencePending_ = false;
    pendingDebugMode_ = false;
    clearMovementActions();
    storageReadyReported_ = false;
    storageSmokeComplete_ = false;
    audioSmokeComplete_ = false;
    renderedFrameCount_ = 0;
    simulationTick_ = 0;
    projectionRevision_ = 1;
    renderRecoverySmokeStage_ = 0;
    titleToPlayableSmokeStage_ = 0;
    rendererPreference_ = render::backend::RendererPreference::automatic;
    framePacket_.clear();
    redrawPending_ = true;
    rendererSizeDirty_ = true;
    drawableReady_ = false;
    renderTargetsResetPending_ = false;
    renderDeviceRecoveryPending_ = false;
    titleMissingCapabilitiesReported_ = false;
    titleFontBytes_.clear();
    titleTextCache_.reset();
    titleTextGeneration_ = 0U;
    // Scene choice follows the existing last-option-wins CLI convention.
    // A smoke flag remains sticky for service/one-frame validation, while a
    // staged scene driver belongs only to the most recently selected scene.
    const auto selectSceneOption = [this](const SceneMode mode) noexcept {
        sceneMode_ = mode;
        renderRecoverySmokeStage_ = 0U;
        titleToPlayableSmoke_ = false;
        titleToPlayableSmokeStage_ = 0U;
    };
    for (int argumentIndex = 1; argumentIndex < argc; ++argumentIndex) {
        if (argv[argumentIndex] == nullptr) {
            continue;
        }
        const std::string_view argument(argv[argumentIndex]);
        if (argument == "--smoke-test") {
            smokeTest_ = true;
            selectSceneOption(SceneMode::diagnostic);
            continue;
        }
        if (argument == "--smoke-test-title") {
            smokeTest_ = true;
            selectSceneOption(SceneMode::title);
            continue;
        }
        if (argument == "--smoke-test-title-to-playable") {
            smokeTest_ = true;
            selectSceneOption(SceneMode::title);
            titleToPlayableSmoke_ = true;
            titleToPlayableSmokeStage_ = titleToPlayableSmokeTitleStage;
            continue;
        }
        if (argument == "--smoke-test-render-recovery") {
            smokeTest_ = true;
            selectSceneOption(SceneMode::diagnostic);
            renderRecoverySmokeStage_ = renderRecoverySmokeLifecycleStage;
            continue;
        }
        if (argument == "--diagnostic-scene") {
            selectSceneOption(SceneMode::diagnostic);
            continue;
        }
        if (argument == "--playable-scene") {
            selectSceneOption(SceneMode::playable);
            continue;
        }

        std::string_view rendererValue;
        if (argument.starts_with("--renderer=")) {
            rendererValue = argument.substr(std::string_view("--renderer=").size());
        } else if (argument == "--renderer") {
            ++argumentIndex;
            if (argumentIndex >= argc || argv[argumentIndex] == nullptr) {
                SDL_LogError(
                    SDL_LOG_CATEGORY_APPLICATION,
                    "--renderer requires auto, sdl-gpu, gles, or software."
                );
                return false;
            }
            rendererValue = argv[argumentIndex];
        } else {
            continue;
        }
        if (!parseRendererPreference(rendererValue, rendererPreference_)) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Unknown renderer preference: %.*s",
                static_cast<int>(rendererValue.size()),
                rendererValue.data()
            );
            return false;
        }
    }
    if (sceneMode_ == SceneMode::playable) {
        try {
            gameSystem_ = std::make_unique<game::GameSystem>();
        } catch (const std::exception& error) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Initial playable session creation failed: %s",
                error.what()
            );
            return false;
        } catch (...) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Initial playable session creation raised a non-standard exception."
            );
            return false;
        }
    }
    if (!SDL_SetAppMetadata("Lonely Tower", "0.4", "io.github.queridofue.cirvivor")) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Application metadata setup failed: %s",
            SDL_GetError()
        );
        return false;
    }
    if (!SDL_Init(SDL_INIT_AUDIO | SDL_INIT_VIDEO | SDL_INIT_EVENTS)) {
        SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "SDL initialization failed: %s", SDL_GetError());
        return false;
    }
    if (sceneMode_ == SceneMode::title && !loadTitleTextAssets()) {
        shutdown();
        return false;
    }
    if (!initializeRenderer(rendererPreference_)) {
        shutdown();
        return false;
    }

    const platform::sdl::StorageResult storageOpen = storage_.open(
        smokeTest_ ? "CirVivorTests" : "io.github.queridofue",
        smokeTest_ ? "CirVivorNativeSmoke" : "cirvivor"
    );
    if (storageOpen != platform::sdl::StorageResult::success) {
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "User storage is unavailable: %s",
            storageResultName(storageOpen)
        );
        if (smokeTest_) {
            shutdown();
            return false;
        }
    }

    const platform::sdl::AudioDeviceResult audioOpen = audio_.openDefault();
    if (audioOpen != platform::sdl::AudioDeviceResult::success) {
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Audio playback is unavailable: %s",
            audioResultName(audioOpen)
        );
        if (smokeTest_) {
            shutdown();
            return false;
        }
    } else if (smokeTest_) {
        const platform::sdl::AudioDeviceResult pauseResult = audio_.pause();
        const platform::sdl::AudioDeviceResult resumeResult = audio_.resume();
        audioSmokeComplete_ = pauseResult == platform::sdl::AudioDeviceResult::success
            && resumeResult == platform::sdl::AudioDeviceResult::success;
        if (!audioSmokeComplete_) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Audio lifecycle smoke failed: pause=%s, resume=%s",
                audioResultName(pauseResult),
                audioResultName(resumeResult)
            );
            shutdown();
            return false;
        }
    }

    lifecycle_.synchronize(window_.isFocused(), window_.isVisible());
    initialized_ = true;
    if (!setExecutionActive(lifecycle_.isActive())) {
        shutdown();
        return false;
    }

    const platform::sdl::WindowMetrics& metrics = window_.metrics();
    const char* sceneName = "title";
    if (sceneMode_ == SceneMode::playable) {
        sceneName = "playable";
    } else if (sceneMode_ == SceneMode::diagnostic) {
        sceneName = "diagnostic";
    }
    SDL_LogInfo(
        SDL_LOG_CATEGORY_APPLICATION,
        "SDL shell ready: %dx%d pixels, scale %.3f, scene %s",
        metrics.pixelWidth,
        metrics.pixelHeight,
        static_cast<double>(metrics.displayScale),
        sceneName
    );
    return true;
}

ApplicationResult Application::handleEvent(
    const platform::sdl::PlatformEvent& platformEvent
) noexcept {
    if (platformEvent.kind == platform::sdl::PlatformEventKind::none) {
        return ApplicationResult::continueRunning;
    }
    if (platformEvent.windowId != 0 && platformEvent.windowId != window_.id()) {
        return ApplicationResult::continueRunning;
    }

    if (platformEvent.kind == platform::sdl::PlatformEventKind::focusLost
        || platformEvent.clearInputStateRequested) {
        static_cast<void>(debugRuntime_.handleFocusLost());
    }

    if (settingsBootState_ != SettingsBootState::waiting
        && platformEvent.kind
            == platform::sdl::PlatformEventKind::pointerChanged
        && platformEvent.pointer.device
            == platform::sdl::PlatformPointerDevice::mouse) {
        debug::DebugPointerPhase phase{};
        bool debugPointer = false;
        if (platformEvent.pointer.button
                == platform::sdl::PlatformPointerButton::middle
            && platformEvent.pointer.phase
                == platform::sdl::PlatformPointerPhase::pressed) {
            phase = debug::DebugPointerPhase::middlePressed;
            debugPointer = true;
        } else if (platformEvent.pointer.button
                == platform::sdl::PlatformPointerButton::middle
            && platformEvent.pointer.phase
                == platform::sdl::PlatformPointerPhase::released) {
            phase = debug::DebugPointerPhase::middleReleased;
            debugPointer = true;
        } else if (platformEvent.pointer.phase
                == platform::sdl::PlatformPointerPhase::canceled
            && debugRuntime_.snapshot().middlePressCaptured) {
            phase = debug::DebugPointerPhase::cancelled;
            debugPointer = true;
        }
        if (debugPointer) {
            const debug::DebugPointerResult result =
                debugRuntime_.handleMiddlePointer(
                    phase,
                    platformEvent.pointer.pointerId,
                    platformEvent.timestampMilliseconds
                );
            handleDebugEffect(result.effect);
            return ApplicationResult::continueRunning;
        }
    }

    if (platformEvent.kind == platform::sdl::PlatformEventKind::actionChanged
        && (platformEvent.action == platform::sdl::PlatformAction::debugPause
            || platformEvent.action
                == platform::sdl::PlatformAction::debugStep)) {
        if (settingsBootState_ != SettingsBootState::waiting) {
            const debug::DebugKeyResult result = debugRuntime_.handleKey(
                platformEvent.action == platform::sdl::PlatformAction::debugPause
                    ? debug::DebugKey::pauseSlash
                    : debug::DebugKey::stepPeriod,
                platformEvent.pressed
                    ? debug::DebugKeyPhase::pressed
                    : debug::DebugKeyPhase::released,
                platformEvent.repeated
            );
            redrawPending_ = redrawPending_ || result.stateChanged;
            if (result.stateChanged) {
                incrementTitleControlStateRevision();
            }
        }
        return ApplicationResult::continueRunning;
    }

    if (platformEvent.kind == platform::sdl::PlatformEventKind::pointerChanged
        && sceneMode_ == SceneMode::title) {
        return handleTitlePointer(platformEvent);
    }

    if (platformEvent.kind == platform::sdl::PlatformEventKind::actionChanged) {
        if (sceneMode_ == SceneMode::playable) {
            applyMovementAction(platformEvent);
        }
        return ApplicationResult::continueRunning;
    }

    if (platformEvent.kind == platform::sdl::PlatformEventKind::focusLost
        && sceneMode_ == SceneMode::title) {
        static_cast<void>(titleUiController_.handleFocusLost());
        redrawPending_ = true;
    }

    if (platformEvent.kind == platform::sdl::PlatformEventKind::windowCloseRequested
        && tryConsumeWindowCloseRequest()) {
        return ApplicationResult::continueRunning;
    }
    if (platformEvent.kind == platform::sdl::PlatformEventKind::quitRequested
        || platformEvent.kind == platform::sdl::PlatformEventKind::terminating
        || platformEvent.kind
            == platform::sdl::PlatformEventKind::windowCloseRequested) {
        scheduler_.suspend();
        return ApplicationResult::success;
    }
    if (platformEvent.kind == platform::sdl::PlatformEventKind::lowMemory) {
        SDL_LogWarn(SDL_LOG_CATEGORY_APPLICATION, "SDL reported a low-memory condition.");
        if (!renderer_.purgeTransientResources()) {
            SDL_LogWarn(
                SDL_LOG_CATEGORY_APPLICATION,
                "Renderer transient resource purge failed after low-memory notification."
            );
        }
        return ApplicationResult::continueRunning;
    }
    if (platformEvent.kind == platform::sdl::PlatformEventKind::renderTargetsReset) {
        redrawPending_ = true;
        rendererSizeDirty_ = true;
        renderTargetsResetPending_ = true;
        if (lifecycle_.isActive() && !prepareRendererForForeground()) {
            return ApplicationResult::failure;
        }
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "SDL render targets reset; backend targets will be refreshed before redraw."
        );
        return ApplicationResult::continueRunning;
    }
    if (platformEvent.kind == platform::sdl::PlatformEventKind::renderDeviceReset
        || platformEvent.kind == platform::sdl::PlatformEventKind::renderDeviceLost) {
        redrawPending_ = true;
        rendererSizeDirty_ = true;
        drawableReady_ = false;
        renderTargetsResetPending_ = false;
        renderDeviceRecoveryPending_ = true;
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            platformEvent.kind == platform::sdl::PlatformEventKind::renderDeviceLost
                ? "SDL renderer device was lost; rebuilding with runtime fallback."
                : "SDL renderer device reset; rebuilding every backend resource."
        );
        if (lifecycle_.isActive() && !prepareRendererForForeground()) {
            return ApplicationResult::failure;
        }
        return ApplicationResult::continueRunning;
    }

    const platform::sdl::LifecycleUpdate update = lifecycle_.apply(platformEvent.kind);
    redrawPending_ = redrawPending_ || update.requestRedraw;
    const bool metricsChanged = platformEvent.kind
        == platform::sdl::PlatformEventKind::windowMetricsChanged;
    rendererSizeDirty_ = rendererSizeDirty_ || metricsChanged;
    if (update.becameInactive) {
        clearMovementActions();
        static_cast<void>(debugRuntime_.handleFocusLost());
        if (sceneMode_ == SceneMode::title) {
            static_cast<void>(titleUiController_.handleFocusLost());
        }
        static_cast<void>(setExecutionActive(false));
    }

    if (update.becameActive) {
        if (!setExecutionActive(true)) {
            return ApplicationResult::failure;
        }
    } else if (metricsChanged && lifecycle_.isActive()) {
        if (!refreshRendererSize()) {
            if (!rebuildRenderer(true) || !prepareRendererForForeground()) {
                return ApplicationResult::failure;
            }
        }
    }
    return ApplicationResult::continueRunning;
}

ApplicationResult Application::handleTitlePointer(
    const platform::sdl::PlatformEvent& event
) noexcept {
    if (!lifecycle_.isActive()) {
        return ApplicationResult::continueRunning;
    }
    if (!titleLayout_.hasSnapshot() && !refreshTitleLayout()) {
        return ApplicationResult::failure;
    }

    ui::UiPointerEvent pointer{};
    if (!tryTranslateTitlePointer(
            event,
            window_.metrics(),
            titleDisplayArea_,
            pointer)) {
        return ApplicationResult::continueRunning;
    }
    const ui::UiStateSnapshot state = titleUiState_.snapshot();
    ui::TitleOverlayControlStateOverrides controlOverrides{};
    if (!buildTitleControlStateOverrides(state, controlOverrides)) {
        return ApplicationResult::failure;
    }
    if (!ui::tryBuildTitleOverlayPresentationSet(
            state,
            titleLayout_.snapshot(),
            titleOverlayPresentations_,
            &controlOverrides)) {
        return ApplicationResult::failure;
    }
    const ui::UiInputResult result = titleUiController_.handlePointer(
        pointer,
        titleLayout_.snapshot(),
        titleEntrance_,
        state,
        titleOverlayPresentations_,
        titleUiState_,
        currentUiFrameContext()
    );
    if (!handleApplicationControl(result)) {
        return ApplicationResult::failure;
    }
    const SceneMode sceneBeforeEffect = sceneMode_;
    handleUiEffect(result.actionOutcome);
    if (!synchronizeSettingsOverlaySession()) {
        return ApplicationResult::failure;
    }
    redrawPending_ = redrawPending_
        || result.controllerStateChanged
        || result.actionAccepted()
        || result.applicationControlActivated();
    if (sceneMode_ != sceneBeforeEffect) {
        return ApplicationResult::continueRunning;
    }
    if (titleUiState_.tryConsumeApplicationExitRequest()) {
        scheduler_.suspend();
        return ApplicationResult::success;
    }
    return ApplicationResult::continueRunning;
}

void Application::handleUiEffect(const ui::UiActionOutcome& outcome) noexcept {
    if (outcome.effect == ui::UiEffect::startPlayableSession) {
        if (!startPlayableSession(
                outcome.playableSession,
                outcome.overlaySequence
            )) {
            const ui::UiActionOutcome acknowledged =
                titleUiState_.acknowledgePlayableSession(
                    outcome.overlaySequence,
                    false
                );
            SDL_LogWarn(
                SDL_LOG_CATEGORY_APPLICATION,
                "Playable session handoff failed%s.",
                acknowledged.accepted() ? "" : " after its request became stale"
            );
        }
        return;
    }
    if (outcome.effect != ui::UiEffect::openExternalUrl
        || outcome.effectText.empty()) {
        return;
    }

    const bool opened = SDL_OpenURL(outcome.effectText.bytes.data());
    if (outcome.overlaySequence == 0U) {
        if (!opened) {
            SDL_LogWarn(
                SDL_LOG_CATEGORY_APPLICATION,
                "Direct external URL handoff failed: %s",
                SDL_GetError()
            );
        }
        return;
    }
    const ui::UiActionOutcome acknowledged = titleUiState_.acknowledgeExternalUrl(
        outcome.overlaySequence,
        opened
    );
    if (!opened || !acknowledged.accepted()) {
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "External URL handoff failed or became stale: %s",
            SDL_GetError()
        );
    }
}

bool Application::startPlayableSession(
    const ui::StartPlayableSession& request,
    const std::uint32_t overlaySequence
) noexcept {
    if (sceneMode_ != SceneMode::title
        || overlaySequence == 0U
        || request.mapId.empty()
        || !::cirvivor::data::isKnownGameMapId(request.mapId.view())
        || request.mapId.view() != game::GameSystem::map_id
        || !framePacket_.hasCapacityFor(
            render::frontend::maximumPlayableGameSceneCapacity()
        )) {
        return false;
    }

    const ui::UiStateSnapshot state = titleUiState_.snapshot();
    const ui::OverlaySnapshot* requestedOverlay = nullptr;
    for (std::size_t index = 0U; index < state.overlayCount; ++index) {
        const ui::OverlaySnapshot& overlay = state.overlays[index];
        if (overlay.sequence == overlaySequence) {
            requestedOverlay = &overlay;
            break;
        }
    }
    if (requestedOverlay == nullptr
        || requestedOverlay->kind != ui::OverlayKind::mapSelect
        || !requestedOverlay->playableStartPending
        || requestedOverlay->selectedMapId != request.mapId) {
        return false;
    }

    std::unique_ptr<game::GameSystem> candidate;
    try {
        candidate = std::make_unique<game::GameSystem>();
    } catch (const std::exception& error) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Playable session preparation failed: %s",
            error.what()
        );
        return false;
    } catch (...) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Playable session preparation raised a non-standard exception."
        );
        return false;
    }

    const settings::SettingsOverlaySessionSnapshot settingsSession =
        settingsOverlaySession_.snapshot();
    if (settingsSession.active) {
        if (settingsWindowPreviewSequence_ == settingsSession.overlaySequence
            && !smokeTest_
            && !(settingsWindowBaselineSequence_
                    == settingsSession.overlaySequence
                ? applyWindowDisplayConfiguration(settingsWindowBaseline_)
                : applyWindowSettings(settingsSession.baseline))) {
            return false;
        }
        settings::GameSettings baseline{};
        settings::SettingsOverlayFieldMask changedFields = 0U;
        if (!settingsOverlaySession_.discard(
                settingsSession.overlaySequence,
                baseline,
                changedFields)
            || !applyRuntimeSettings(baseline, changedFields, false)) {
            return false;
        }
        settingsWindowBaselineSequence_ = 0U;
        settingsWindowPreviewSequence_ = 0U;
        incrementTitleControlStateRevision();
    }
    settingsDismissedSequence_ = 0U;

    clearMovementActions();
    static_cast<void>(titleUiController_.handleFocusLost());
    scheduler_.reset();
    resetFrameClock();
    renderedFrameCount_ = 0U;
    simulationTick_ = 0U;
    previousFrameCpuSeconds_ = 0.0;
    framePacket_.clear();
    titleUiState_ = {};
    titleUiController_ = {};
    titleLayout_ = {};
    titleDisplayArea_ = {};
    titleEntrance_ = {};
    titleOverlayPresentations_ = {};
    titleBackdropLayout_ = {};
    titleBackdropEntrance_ = {};
    titleBackdropInteraction_ = {};
    titleBackdropOverlays_.fill({});
    titleBackdropOverlayCount_ = 0U;
    titleBackdropRevision_ = 1U;
    titleBackdropProjectionRevision_ = 0U;
    titleBackdropSnapshotValid_ = false;
    titleMissingCapabilitiesReported_ = false;
    projectionRevision_ = projectionRevision_
            == std::numeric_limits<std::uint64_t>::max()
        ? 1U
        : projectionRevision_ + 1U;
    redrawPending_ = true;
    gameSystem_ = std::move(candidate);
    sceneMode_ = SceneMode::playable;
    return true;
}

ApplicationResult Application::iterate() noexcept {
    if (!initialized_) {
        return ApplicationResult::failure;
    }
    if (!updatePlatformServices()) {
        return ApplicationResult::failure;
    }
    const bool executionActive = lifecycle_.isActive();
    if (!executionActive) {
        return ApplicationResult::continueRunning;
    }
    if (rendererSizeDirty_ && !refreshRendererSize()) {
        if (!rebuildRenderer(true) || !prepareRendererForForeground()) {
            return ApplicationResult::failure;
        }
    }
    if (renderRecoverySmokeStage_ == renderRecoverySmokeLifecycleStage) {
        constexpr std::array lifecycleEvents{
            platform::sdl::PlatformEventKind::didEnterBackground,
            platform::sdl::PlatformEventKind::windowMetricsChanged,
            platform::sdl::PlatformEventKind::didEnterForeground
        };
        for (const platform::sdl::PlatformEventKind kind : lifecycleEvents) {
            const ApplicationResult lifecycleResult = handleEvent({kind, window_.id()});
            if (lifecycleResult != ApplicationResult::continueRunning) {
                return lifecycleResult;
            }
        }
        ++renderRecoverySmokeStage_;
        return ApplicationResult::continueRunning;
    }
    if (renderRecoverySmokeStage_ == renderRecoverySmokeTargetsStage
        || renderRecoverySmokeStage_ == renderRecoverySmokeDeviceStage) {
        const platform::sdl::PlatformEvent recoveryEvent{
            renderRecoverySmokeStage_ == renderRecoverySmokeTargetsStage
                ? platform::sdl::PlatformEventKind::renderTargetsReset
                : platform::sdl::PlatformEventKind::renderDeviceReset,
            window_.id()
        };
        const ApplicationResult recoveryResult = handleEvent(recoveryEvent);
        if (recoveryResult != ApplicationResult::continueRunning) {
            return recoveryResult;
        }
        ++renderRecoverySmokeStage_;
        if (renderRecoverySmokeStage_ == renderRecoverySmokeCompleteStage) {
            SDL_LogInfo(
                SDL_LOG_CATEGORY_APPLICATION,
                "Renderer lifecycle and target/device recovery smoke completed."
            );
        }
        return ApplicationResult::continueRunning;
    }

    const std::uint64_t frameStart = SDL_GetTicksNS();
    if (previousFrameTicks_ == 0) {
        previousFrameTicks_ = frameStart;
    }
    const std::uint64_t elapsedTicks = frameStart - previousFrameTicks_;
    previousFrameTicks_ = frameStart;

    if (!drawableReady_) {
        const std::uint64_t frameCpuEnd = SDL_GetTicksNS();
        previousFrameCpuSeconds_ = static_cast<double>(frameCpuEnd - frameStart)
            / nanosecondsPerSecond;
        redrawPending_ = true;
        return ApplicationResult::continueRunning;
    }

    const debug::DebugFrameEffect debugFrame = debugRuntime_.prepareFrame();
    engine::FixedStepMode fixedStepMode = engine::FixedStepMode::scheduled;
    if (sceneMode_ == SceneMode::title
        || debugFrame.mode == debug::DebugFrameMode::paused) {
        fixedStepMode = engine::FixedStepMode::disabled;
    } else if (debugFrame.mode == debug::DebugFrameMode::singleStep) {
        fixedStepMode = engine::FixedStepMode::singleStep;
    }
    const engine::FrameSample frameSample = {
        static_cast<double>(elapsedTicks) / nanosecondsPerSecond,
        previousFrameCpuSeconds_,
        fixedStepMode
    };
    engine::FrameSchedule schedule = scheduler_.advance(frameSample);
    if (debugFrame.mode != debug::DebugFrameMode::running) {
        schedule.fixedAlpha = 1.0;
    }
    if (sceneMode_ == SceneMode::title) {
        double uiDeltaSeconds = schedule.frameDeltaSeconds;
        if (debugFrame.mode == debug::DebugFrameMode::paused) {
            uiDeltaSeconds = 0.0;
        } else if (debugFrame.mode == debug::DebugFrameMode::singleStep) {
            uiDeltaSeconds = game::GameSystem::fixed_delta_seconds;
        }
        titleUiState_.advance(uiDeltaSeconds);
        if (!synchronizeSettingsOverlaySession()) {
            return ApplicationResult::failure;
        }
    }
    const bool playableSessionActive = sceneMode_ == SceneMode::playable;
    for (std::uint32_t step = 0; step < schedule.fixedStepCount; ++step) {
        if (playableSessionActive && gameSystem_ != nullptr) {
            static_cast<void>(gameSystem_->fixedUpdate(
                movementInput_.consumeFixedStep()
            ));
        }
        ++simulationTick_;
    }

    bool frameBuilt = false;
    switch (sceneMode_) {
    case SceneMode::title:
        frameBuilt = buildTitleFrame(schedule);
        break;
    case SceneMode::playable:
        frameBuilt = buildPlayableFrame(schedule);
        break;
    case SceneMode::diagnostic:
        frameBuilt = buildSyntheticFrame(schedule);
        break;
    }
    if (!frameBuilt) {
        return ApplicationResult::failure;
    }

    const std::uint64_t frameCpuEnd = SDL_GetTicksNS();
    previousFrameCpuSeconds_ = debugFrame.mode == debug::DebugFrameMode::running
        ? static_cast<double>(frameCpuEnd - frameStart) / nanosecondsPerSecond
        : 0.0;
    const render::RenderResourcesView resources =
        sceneMode_ == SceneMode::title && titleTextCache_ != nullptr
        ? titleTextCache_->renderResources()
        : render::RenderResourcesView{};
    if (!renderer_.render(framePacket_, resources)) {
        SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "Renderer frame submission failed.");
        return ApplicationResult::failure;
    }
    ++renderedFrameCount_;
    redrawPending_ = false;
    if (titleToPlayableSmoke_) {
        if (titleToPlayableSmokeStage_ == titleToPlayableSmokeTitleStage) {
            constexpr double titleIntroSeconds =
                ui::TitleOverlayStateMachine::intro_delay_seconds
                + ui::TitleOverlayStateMachine::logo_playback_seconds
                + ui::TitleOverlayStateMachine::scene_transition_seconds;
            advanceUiStateForSmoke(titleUiState_, titleIntroSeconds);
            const ui::UiActionOutcome opened = titleUiState_.apply(
                ui::UiAction::openTitle(ui::OverlayKind::mapSelect)
            );
            if (!opened.accepted()) {
                SDL_LogError(
                    SDL_LOG_CATEGORY_APPLICATION,
                    "Title-to-playable smoke could not open map select."
                );
                return ApplicationResult::failure;
            }
            advanceUiStateForSmoke(
                titleUiState_,
                ui::TitleOverlayStateMachine::overlay_transition_seconds
            );
            titleToPlayableSmokeStage_ = titleToPlayableSmokeMapStage;
            redrawPending_ = true;
            return ApplicationResult::continueRunning;
        }
        if (titleToPlayableSmokeStage_ == titleToPlayableSmokeMapStage) {
            const ui::UiStateSnapshot beforePress = titleUiState_.snapshot();
            if (!ui::tryBuildTitleOverlayPresentationSet(
                    beforePress,
                    titleLayout_.snapshot(),
                    titleOverlayPresentations_)) {
                return ApplicationResult::failure;
            }
            const ui::OverlaySnapshot* mapOverlay = nullptr;
            for (std::size_t index = 0U; index < beforePress.overlayCount; ++index) {
                if (beforePress.overlays[index].kind == ui::OverlayKind::mapSelect) {
                    mapOverlay = &beforePress.overlays[index];
                    break;
                }
            }
            const ui::TitleOverlayPresentation* mapPresentation =
                mapOverlay == nullptr
                ? nullptr
                : ui::findTitleOverlayPresentation(
                    titleOverlayPresentations_,
                    mapOverlay->sequence
                );
            const ui::TitleOverlayControl* startControl = nullptr;
            if (mapPresentation != nullptr) {
                for (std::size_t index = 0U;
                     index < mapPresentation->controlCount;
                     ++index) {
                    if (mapPresentation->controls[index].id
                            == ui::TitleOverlayControlId::confirm) {
                        startControl = &mapPresentation->controls[index];
                        break;
                    }
                }
            }
            if (mapOverlay == nullptr
                || mapPresentation == nullptr
                || startControl == nullptr) {
                SDL_LogError(
                    SDL_LOG_CATEGORY_APPLICATION,
                    "Title-to-playable smoke could not resolve the start button."
                );
                return ApplicationResult::failure;
            }
            const ui::layout::PointD startButtonCenter{
                startControl->rect.x + (startControl->rect.width * 0.5),
                startControl->rect.y + (startControl->rect.height * 0.5)
            };
            const ui::UiInputResult pressed = titleUiController_.handlePointer(
                {
                    ui::UiPointerEventType::down,
                    ui::UiPointerDevice::mouse,
                    ui::UiPointerButton::left,
                    0U,
                    startButtonCenter
                },
                titleLayout_.snapshot(),
                titleEntrance_,
                beforePress,
                titleOverlayPresentations_,
                titleUiState_
            );
            const ui::TitleUiControllerSnapshot captured =
                titleUiController_.snapshot();
            if (pressed.status != ui::UiInputStatus::captured
                || pressed.target != ui::TitleUiTarget::overlayConfirm
                || pressed.overlaySequence != mapOverlay->sequence
                || !captured.capture.active
                || captured.capture.target != ui::TitleUiTarget::overlayConfirm
                || captured.capture.overlaySequence != mapOverlay->sequence) {
                SDL_LogError(
                    SDL_LOG_CATEGORY_APPLICATION,
                    "Title-to-playable smoke did not capture the start button."
                );
                return ApplicationResult::failure;
            }
            const ui::UiInputResult released = titleUiController_.handlePointer(
                {
                    ui::UiPointerEventType::up,
                    ui::UiPointerDevice::mouse,
                    ui::UiPointerButton::left,
                    0U,
                    startButtonCenter
                },
                titleLayout_.snapshot(),
                titleEntrance_,
                titleUiState_.snapshot(),
                titleOverlayPresentations_,
                titleUiState_
            );
            if (released.status != ui::UiInputStatus::actionApplied
                || !released.actionAccepted()
                || released.target != ui::TitleUiTarget::overlayConfirm
                || released.overlaySequence != mapOverlay->sequence
                || released.actionOutcome.effect
                    != ui::UiEffect::startPlayableSession
                || titleUiController_.snapshot().capture.active) {
                SDL_LogError(
                    SDL_LOG_CATEGORY_APPLICATION,
                    "Title-to-playable smoke did not release the start request."
                );
                return ApplicationResult::failure;
            }
            handleUiEffect(released.actionOutcome);
            if (sceneMode_ != SceneMode::playable || gameSystem_ == nullptr) {
                return ApplicationResult::failure;
            }
            titleToPlayableSmokeStage_ = titleToPlayableSmokePlayableStage;
            return ApplicationResult::continueRunning;
        }
        if (titleToPlayableSmokeStage_ == titleToPlayableSmokePlayableStage) {
            titleToPlayableSmokeStage_ = titleToPlayableSmokeCompleteStage;
            SDL_LogInfo(
                SDL_LOG_CATEGORY_APPLICATION,
                "Title, map-select shell, and playable frames rendered successfully."
            );
        }
        return titleToPlayableSmokeStage_ == titleToPlayableSmokeCompleteStage
                && storageSmokeComplete_
                && audioSmokeComplete_
            ? ApplicationResult::success
            : ApplicationResult::continueRunning;
    }
    return smokeTest_ && storageSmokeComplete_ && audioSmokeComplete_
            && renderedFrameCount_ > 0U
        ? ApplicationResult::success
        : ApplicationResult::continueRunning;
}

void Application::shutdown() noexcept {
    scheduler_.suspend();
    renderer_.shutdown();
    static_cast<void>(audio_.close());
    static_cast<void>(storage_.close());
    window_.shutdown();
    lifecycle_.reset();
    gameSystem_.reset();
    framePacket_.clear();
    previousFrameTicks_ = 0;
    renderedFrameCount_ = 0;
    simulationTick_ = 0;
    projectionRevision_ = 1;
    renderRecoverySmokeStage_ = 0;
    titleToPlayableSmokeStage_ = 0;
    previousFrameCpuSeconds_ = 0;
    initialized_ = false;
    smokeTest_ = false;
    titleToPlayableSmoke_ = false;
    sceneMode_ = SceneMode::title;
    titleUiState_ = {};
    titleUiController_ = {};
    settingsOverlaySession_ = {};
    debugRuntime_ = debug::DebugRuntimeController{};
    titleLayout_ = {};
    titleDisplayArea_ = {};
    titleTheme_ = ui::layout::darkThemeMetrics();
    titleEntrance_ = {};
    titleOverlayPresentations_ = {};
    titleBackdropLayout_ = {};
    titleBackdropEntrance_ = {};
    titleBackdropInteraction_ = {};
    titleBackdropOverlays_.fill({});
    titleBackdropOverlayCount_ = 0U;
    titleBackdropRevision_ = 1U;
    titleBackdropProjectionRevision_ = 0U;
    titleBackdropControlStateRevision_ = 0U;
    titleControlStateRevision_ = 1U;
    titleBackdropSnapshotValid_ = false;
    settingsDismissedSequence_ = 0U;
    settingsWindowBaseline_ = {};
    settingsWindowBaselineSequence_ = 0U;
    settingsWindowPreviewSequence_ = 0U;
    settingsBootState_ = SettingsBootState::waiting;
    debugPersistenceRetryAtMilliseconds_ = 0U;
    debugPersistenceAttemptCount_ = 0U;
    debugPersistencePending_ = false;
    pendingDebugMode_ = false;
    clearMovementActions();
    rendererPreference_ = render::backend::RendererPreference::automatic;
    storageReadyReported_ = false;
    storageSmokeComplete_ = false;
    audioSmokeComplete_ = false;
    redrawPending_ = false;
    rendererSizeDirty_ = true;
    drawableReady_ = false;
    renderTargetsResetPending_ = false;
    renderDeviceRecoveryPending_ = false;
    titleMissingCapabilitiesReported_ = false;
    titleTextCache_.reset();
    titleFontBytes_.clear();
    titleTextGeneration_ = 0U;
}

bool Application::updatePlatformServices() noexcept {
    const auto applyCurrentSettingsAuthority = [this]() noexcept {
        if (applyRuntimeSettings(
                settingsRepository_.current(),
                allSettingsOverlayFields,
                !smokeTest_)) {
            return true;
        }
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Requested settings window mode could not be applied; continuing with the current OS mode."
        );
        return applyRuntimeSettings(
            settingsRepository_.current(),
            allSettingsOverlayFields,
            false
        );
    };

    if (!storage_.isOpen()) {
        if (settingsBootState_ == SettingsBootState::waiting) {
            settingsBootState_ = SettingsBootState::unavailable;
            debugPersistencePending_ = false;
            debugPersistenceAttemptCount_ = 0U;
            debugPersistenceRetryAtMilliseconds_ = 0U;
            incrementTitleControlStateRevision();
            if (!applyCurrentSettingsAuthority()) {
                return false;
            }
        }
        return !smokeTest_;
    }
    if (storage_.readyState() != platform::sdl::StorageReadyState::ready) {
        return true;
    }
    if (!storageReadyReported_) {
        SDL_LogInfo(SDL_LOG_CATEGORY_APPLICATION, "SDL user storage is ready.");
        storageReadyReported_ = true;
    }
    if (settingsBootState_ == SettingsBootState::waiting) {
        settingsBootState_ = SettingsBootState::unavailable;
        const settings::SettingsLoadResult loaded = settingsRepository_.load();
        if (!loaded.succeeded()) {
            SDL_LogWarn(
                SDL_LOG_CATEGORY_APPLICATION,
                "Native settings load failed with storage status %u; saving is disabled.",
                static_cast<unsigned int>(loaded.storageStatus)
            );
            if (!applyCurrentSettingsAuthority()) {
                return false;
            }
        } else {
            settingsBootState_ = SettingsBootState::loaded;
            static_cast<void>(debugRuntime_.applyDebugMode(
                debugPersistencePending_
                    ? pendingDebugMode_
                    : settingsRepository_.current().debugMode
            ));
            if (!applyCurrentSettingsAuthority()) {
                return false;
            }
            SDL_LogInfo(
                SDL_LOG_CATEGORY_APPLICATION,
                "Native settings authority loaded with status %u.",
                static_cast<unsigned int>(loaded.status)
            );
        }
        incrementTitleControlStateRevision();
        if (!synchronizeSettingsOverlaySession()) {
            return false;
        }
    }
    retryPendingDebugPersistence();
    return !smokeTest_ || storageSmokeComplete_ || runStorageSmokeTest();
}

bool Application::runStorageSmokeTest() noexcept {
    constexpr std::array<std::byte, 8> payload{
        std::byte{0x43},
        std::byte{0x69},
        std::byte{0x72},
        std::byte{0x56},
        std::byte{0x69},
        std::byte{0x76},
        std::byte{0x6f},
        std::byte{0x72}
    };
    const platform::sdl::StorageResult writeResult = storage_.write(
        smokeStoragePath.data(),
        payload
    );
    if (writeResult != platform::sdl::StorageResult::success) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "User storage smoke write failed: %s",
            storageResultName(writeResult)
        );
        return false;
    }

    const platform::sdl::StorageReadResult limitedRead = storage_.read(
        smokeStoragePath.data(),
        payload.size() - 1U
    );
    const platform::sdl::StorageReadResult readResult = storage_.read(
        smokeStoragePath.data(),
        payload.size()
    );
    const platform::sdl::StorageResult removeResult = storage_.remove(
        smokeStoragePath.data()
    );
    const bool bytesMatch = readResult.bytes.size() == payload.size()
        && std::equal(readResult.bytes.begin(), readResult.bytes.end(), payload.begin());
    storageSmokeComplete_ = limitedRead.status
            == platform::sdl::StorageResult::readLimitExceeded
        && readResult.succeeded()
        && bytesMatch
        && removeResult == platform::sdl::StorageResult::success;
    if (!storageSmokeComplete_) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "User storage smoke failed: cap=%s, read=%s, bytes=%s, remove=%s",
            storageResultName(limitedRead.status),
            storageResultName(readResult.status),
            bytesMatch ? "match" : "mismatch",
            storageResultName(removeResult)
        );
    }
    return storageSmokeComplete_;
}

bool Application::setExecutionActive(const bool active) noexcept {
    if (active) {
        if (!prepareRendererForForeground()) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "Renderer foreground transition and fallback recovery failed."
            );
            return false;
        }
    } else if (!renderer_.onBackground()) {
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Renderer background transition failed."
        );
    }
    if (audio_.isOpen()) {
        const platform::sdl::AudioDeviceResult audioResult = active
            ? audio_.resume()
            : audio_.pause();
        if (audioResult != platform::sdl::AudioDeviceResult::success) {
            SDL_LogWarn(
                SDL_LOG_CATEGORY_APPLICATION,
                "Audio lifecycle transition failed: %s",
                audioResultName(audioResult)
            );
        }
    }
    if (active) {
        scheduler_.resume();
        resetFrameClock();
        configureActiveCallbackRate();
        return true;
    }

    scheduler_.suspend();
    resetFrameClock();
    if (!SDL_SetHintWithPriority(
            SDL_HINT_MAIN_CALLBACK_RATE,
            "waitevent",
            SDL_HINT_OVERRIDE)) {
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Inactive callback wait mode could not be enabled: %s",
            SDL_GetError()
        );
    }
    return true;
}

bool Application::tryConsumeWindowCloseRequest() noexcept {
    if (sceneMode_ != SceneMode::title) {
        return false;
    }
    const ui::UiInputResult result = titleUiController_.handleWindowClose(
        titleUiState_,
        currentUiFrameContext()
    );
    redrawPending_ = redrawPending_
        || result.controllerStateChanged
        || result.actionAccepted();
    return result.actionAccepted();
}

void Application::applyMovementAction(
    const platform::sdl::PlatformEvent& event
) noexcept {
    if (event.kind != platform::sdl::PlatformEventKind::actionChanged
        || event.sourceMask == 0U) {
        return;
    }

    switch (event.action) {
    case platform::sdl::PlatformAction::moveUp:
        movementInput_.apply(
            MovementInputChannel::up,
            event.sourceMask,
            event.pressed
        );
        break;
    case platform::sdl::PlatformAction::moveDown:
        movementInput_.apply(
            MovementInputChannel::down,
            event.sourceMask,
            event.pressed
        );
        break;
    case platform::sdl::PlatformAction::moveLeft:
        movementInput_.apply(
            MovementInputChannel::left,
            event.sourceMask,
            event.pressed
        );
        break;
    case platform::sdl::PlatformAction::moveRight:
        movementInput_.apply(
            MovementInputChannel::right,
            event.sourceMask,
            event.pressed
        );
        break;
    case platform::sdl::PlatformAction::none:
    default:
        return;
    }

    redrawPending_ = true;
}

void Application::clearMovementActions() noexcept {
    movementInput_.clear();
}

void Application::configureActiveCallbackRate() noexcept {
    constexpr std::uint16_t safeDefaultRateHz = 60;
    const render::backend::RenderCapabilities* const capabilities =
        renderer_.capabilities();
    const std::uint16_t rateHz = capabilities == nullptr
        ? safeDefaultRateHz
        : capabilities->mainCallbackRateLimitHz;
    std::array<char, 6> rateText{};
    static_cast<void>(SDL_snprintf(
        rateText.data(),
        rateText.size(),
        "%u",
        static_cast<unsigned int>(rateHz)
    ));
    if (!SDL_SetHintWithPriority(
            SDL_HINT_MAIN_CALLBACK_RATE,
            rateText.data(),
            SDL_HINT_OVERRIDE)) {
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Active callback rate %s Hz could not be applied: %s",
            rateText.data(),
            SDL_GetError()
        );
    }
}

void Application::resetFrameClock() noexcept {
    previousFrameTicks_ = SDL_GetTicksNS();
    previousFrameCpuSeconds_ = 0;
}

} // namespace cirvivor::app
