#include "app/application.h"

#include "platform/sdl/sdl_platform_event.h"
#include "render/frontend/playable_game_scene.h"
#include "render/frontend/synthetic_test_scene.h"
#include "render/gles/gles_backend.h"
#include "render/sdl_gpu/sdl_gpu_backend.h"
#include "render/software/software_backend.h"

#include <SDL3/SDL.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
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

[[nodiscard]] render::FramePacketCapacity maximumFramePacketCapacity(
    const render::FramePacketCapacity first,
    const render::FramePacketCapacity second
) noexcept {
    return {
        std::max(first.commandCount, second.commandCount),
        std::max(first.spriteCount, second.spriteCount),
        std::max(first.shapeCount, second.shapeCount),
        std::max(first.lineCount, second.lineCount),
        std::max(first.textCount, second.textCount),
        std::max(first.effectCount, second.effectCount),
        std::max(first.uiCount, second.uiCount),
        std::max(first.overlayCount, second.overlayCount),
        std::max(first.utf8ByteCount, second.utf8ByteCount)
    };
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

    [[nodiscard]] bool render(const render::FramePacket& frame) noexcept override {
        return active_ != nullptr && active_->render(frame);
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
      framePacket_(maximumFramePacketCapacity(
          render::frontend::syntheticTestSceneCapacity(),
          render::frontend::playableGameSceneCapacity(gameSystem_)
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
        true
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

bool Application::buildSyntheticFrame(const engine::FrameSchedule& schedule) noexcept {
    const platform::sdl::WindowMetrics& metrics = window_.metrics();
    render::frontend::SyntheticSceneConfig config;
    config.physicalDisplaySize = {metrics.pixelWidth, metrics.pixelHeight};
    config.physicalWindowBounds = {0, 0, metrics.pixelWidth, metrics.pixelHeight};
    config.drawableSize = {metrics.pixelWidth, metrics.pixelHeight};
    config.safeArea = drawableSafeArea(metrics);
    config.dpiScale = metrics.pixelDensity;
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
    const platform::sdl::WindowMetrics& metrics = window_.metrics();
    render::frontend::PlayableGameSceneConfig config;
    config.physicalDisplaySize = {metrics.pixelWidth, metrics.pixelHeight};
    config.physicalWindowBounds = {0, 0, metrics.pixelWidth, metrics.pixelHeight};
    config.drawableSize = {metrics.pixelWidth, metrics.pixelHeight};
    config.safeArea = drawableSafeArea(metrics);
    config.dpiScale = metrics.pixelDensity;
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
                gameSystem_,
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

bool Application::initialize(const int argc, char* argv[]) noexcept {
    if (initialized_) {
        return false;
    }
    lifecycle_.reset();
    smokeTest_ = false;
    diagnosticScene_ = false;
    clearMovementActions();
    storageReadyReported_ = false;
    storageSmokeComplete_ = false;
    audioSmokeComplete_ = false;
    renderedFrameCount_ = 0;
    simulationTick_ = 0;
    projectionRevision_ = 1;
    renderRecoverySmokeStage_ = 0;
    rendererPreference_ = render::backend::RendererPreference::automatic;
    framePacket_.clear();
    redrawPending_ = true;
    rendererSizeDirty_ = true;
    drawableReady_ = false;
    renderTargetsResetPending_ = false;
    renderDeviceRecoveryPending_ = false;
    for (int argumentIndex = 1; argumentIndex < argc; ++argumentIndex) {
        if (argv[argumentIndex] == nullptr) {
            continue;
        }
        const std::string_view argument(argv[argumentIndex]);
        if (argument == "--smoke-test") {
            smokeTest_ = true;
            continue;
        }
        if (argument == "--smoke-test-render-recovery") {
            smokeTest_ = true;
            renderRecoverySmokeStage_ = renderRecoverySmokeLifecycleStage;
            continue;
        }
        if (argument == "--diagnostic-scene") {
            diagnosticScene_ = true;
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
    if (!initializeRenderer(rendererPreference_)) {
        shutdown();
        return false;
    }

    const platform::sdl::StorageResult storageOpen = storage_.open(
        "io.github.queridofue",
        "cirvivor"
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
    SDL_LogInfo(
        SDL_LOG_CATEGORY_APPLICATION,
        "SDL shell ready: %dx%d pixels, scale %.3f, scene %s",
        metrics.pixelWidth,
        metrics.pixelHeight,
        static_cast<double>(metrics.displayScale),
        smokeTest_ || diagnosticScene_ ? "diagnostic" : "playable"
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

    if (platformEvent.kind == platform::sdl::PlatformEventKind::actionChanged) {
        applyMovementAction(platformEvent);
        return ApplicationResult::continueRunning;
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

    const engine::FrameSample frameSample = {
        static_cast<double>(elapsedTicks) / nanosecondsPerSecond,
        previousFrameCpuSeconds_,
        true
    };
    const engine::FrameSchedule schedule = scheduler_.advance(frameSample);
    const bool playableSessionActive = !smokeTest_ && !diagnosticScene_;
    for (std::uint32_t step = 0; step < schedule.fixedStepCount; ++step) {
        if (playableSessionActive) {
            static_cast<void>(gameSystem_.fixedUpdate(
                movementInput_.consumeFixedStep()
            ));
        }
        ++simulationTick_;
    }

    if (!drawableReady_) {
        const std::uint64_t frameCpuEnd = SDL_GetTicksNS();
        previousFrameCpuSeconds_ = static_cast<double>(frameCpuEnd - frameStart)
            / nanosecondsPerSecond;
        redrawPending_ = true;
        return ApplicationResult::continueRunning;
    }

    const bool frameBuilt = smokeTest_ || diagnosticScene_
        ? buildSyntheticFrame(schedule)
        : buildPlayableFrame(schedule);
    if (!frameBuilt) {
        return ApplicationResult::failure;
    }

    const std::uint64_t frameCpuEnd = SDL_GetTicksNS();
    previousFrameCpuSeconds_ = static_cast<double>(frameCpuEnd - frameStart)
        / nanosecondsPerSecond;
    if (!renderer_.render(framePacket_)) {
        SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "Renderer frame submission failed.");
        return ApplicationResult::failure;
    }
    ++renderedFrameCount_;
    redrawPending_ = false;
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
    framePacket_.clear();
    previousFrameTicks_ = 0;
    renderedFrameCount_ = 0;
    simulationTick_ = 0;
    projectionRevision_ = 1;
    renderRecoverySmokeStage_ = 0;
    previousFrameCpuSeconds_ = 0;
    initialized_ = false;
    smokeTest_ = false;
    diagnosticScene_ = false;
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
}

bool Application::updatePlatformServices() noexcept {
    if (!storage_.isOpen()) {
        return !smokeTest_;
    }
    if (storage_.readyState() != platform::sdl::StorageReadyState::ready) {
        return true;
    }
    if (!storageReadyReported_) {
        SDL_LogInfo(SDL_LOG_CATEGORY_APPLICATION, "SDL user storage is ready.");
        storageReadyReported_ = true;
    }
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
    // The native UI state machine will open its dismissible exit overlay here.
    // Until that consumer exists, handleEvent preserves the legacy quit fallback.
    return false;
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
