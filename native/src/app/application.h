#pragma once

#include "app/movement_input_buffer.h"
#include "app/title_display_policy.h"
#include "debug/debug_runtime_controller.h"
#include "engine/frame_scheduler.h"
#include "game/game_system.h"
#include "platform/sdl/audio/sdl_playback_device.h"
#include "platform/sdl/sdl_lifecycle.h"
#include "platform/sdl/storage/sdl_settings_storage.h"
#include "platform/sdl/storage/sdl_user_storage.h"
#include "platform/sdl/sdl_window.h"
#include "render/backend/renderer_router.h"
#include "render/common/frame_packet.h"
#include "render/text/shaped_text_cache.h"
#include "settings/settings_overlay_session.h"
#include "settings/settings_repository.h"
#include "ui/layout/ui_layout_metrics.h"
#include "ui/title_overlay_state_machine.h"
#include "ui/title_ui_controller.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

namespace cirvivor::platform::sdl {
struct PlatformEvent;
}

namespace cirvivor::app {

enum class ApplicationResult : std::uint8_t {
    continueRunning,
    success,
    failure
};

class Application final {
public:
    Application();

    [[nodiscard]] bool initialize(int argc, char* argv[]) noexcept;
    [[nodiscard]] ApplicationResult handleEvent(
        const platform::sdl::PlatformEvent& event
    ) noexcept;
    [[nodiscard]] ApplicationResult iterate() noexcept;
    /** Software smoke와 향후 Debug 계측이 읽는 backend 중립 진단 hash입니다. */
    [[nodiscard]] std::uint64_t lastRenderedFrameContentHash() const noexcept;
    void shutdown() noexcept;

private:
    enum class SceneMode : std::uint8_t {
        title,
        playable,
        diagnostic
    };

    enum class SettingsBootState : std::uint8_t {
        waiting,
        loaded,
        unavailable
    };

    [[nodiscard]] std::unique_ptr<render::backend::IRenderBackend> makeRenderBackend(
        render::backend::RenderBackendKind kind
    );
    [[nodiscard]] bool initializeRenderer(
        render::backend::RendererPreference preference
    ) noexcept;
    [[nodiscard]] bool rebuildRenderer(bool skipCurrentBackend) noexcept;
    [[nodiscard]] bool prepareRendererForForeground() noexcept;
    [[nodiscard]] bool refreshRendererSize() noexcept;
    [[nodiscard]] bool buildSyntheticFrame(const engine::FrameSchedule& schedule) noexcept;
    [[nodiscard]] bool buildPlayableFrame(const engine::FrameSchedule& schedule) noexcept;
    [[nodiscard]] bool buildTitleFrame(const engine::FrameSchedule& schedule) noexcept;
    [[nodiscard]] bool refreshTitleLayout() noexcept;
    [[nodiscard]] bool refreshTitleLayout(
        const settings::GameSettings& settings
    ) noexcept;
    [[nodiscard]] bool refreshGlobalDebugLayout() noexcept;
    [[nodiscard]] bool refreshGlobalDebugLayout(
        const settings::GameSettings& settings
    ) noexcept;
    [[nodiscard]] bool tryResolveGlobalDebugViewport(
        const settings::GameSettings& settings,
        render::ViewportState& output
    ) const noexcept;
    [[nodiscard]] bool loadTitleTextAssets() noexcept;
    [[nodiscard]] bool prepareTitleTextResources() noexcept;
    [[nodiscard]] bool prepareTitleTextResources(
        const settings::GameSettings& settings
    ) noexcept;
    [[nodiscard]] std::uint64_t refreshTitleBackdropRevision(
        const ui::UiStateSnapshot& state,
        const ui::TitleUiControllerSnapshot& interaction,
        std::uint64_t controlStateRevision
    ) noexcept;
    [[nodiscard]] const settings::GameSettings& activeSettings() const noexcept;
    [[nodiscard]] render::UiTextLocale activeTitleLocale() const noexcept;
    [[nodiscard]] ui::UiFrameContext currentUiFrameContext() const noexcept;
    [[nodiscard]] bool buildTitleControlStateOverrides(
        const ui::UiStateSnapshot& state,
        ui::TitleOverlayControlStateOverrides& output
    ) const noexcept;
    [[nodiscard]] bool prepareGlobalDebugOverlayPresentation(
        const ui::UiStateSnapshot& state
    ) noexcept;
    [[nodiscard]] bool synchronizeSettingsOverlaySession() noexcept;
    [[nodiscard]] bool applyRuntimeSettings(
        const settings::GameSettings& settings,
        settings::SettingsOverlayFieldMask changedFields,
        bool applyWindow
    ) noexcept;
    [[nodiscard]] bool applyWindowSettings(
        const settings::GameSettings& settings
    ) noexcept;
    [[nodiscard]] bool applyWindowDisplayConfiguration(
        const platform::sdl::WindowDisplayConfiguration& configuration
    ) noexcept;
    [[nodiscard]] bool handleApplicationControl(
        const ui::UiInputResult& result
    ) noexcept;
    void handleDebugEffect(const debug::DebugRuntimeEffect& effect) noexcept;
    [[nodiscard]] bool persistDebugMode(bool enabled) noexcept;
    void retryPendingDebugPersistence() noexcept;
    void incrementTitleControlStateRevision() noexcept;
    [[nodiscard]] ApplicationResult handleTitlePointer(
        const platform::sdl::PlatformEvent& event
    ) noexcept;
    [[nodiscard]] ApplicationResult handleGlobalDebugPointer(
        const platform::sdl::PlatformEvent& event
    ) noexcept;
    void handleUiEffect(const ui::UiActionOutcome& outcome) noexcept;
    [[nodiscard]] bool startPlayableSession(
        const ui::StartPlayableSession& request,
        std::uint32_t overlaySequence
    ) noexcept;
    [[nodiscard]] bool updatePlatformServices() noexcept;
    [[nodiscard]] bool runStorageSmokeTest() noexcept;
    [[nodiscard]] bool setExecutionActive(bool active) noexcept;
    [[nodiscard]] bool tryConsumeWindowCloseRequest() noexcept;
    void applyMovementAction(const platform::sdl::PlatformEvent& event) noexcept;
    void clearMovementActions() noexcept;
    void configureActiveCallbackRate() noexcept;
    void resetFrameClock() noexcept;

    engine::FrameScheduler scheduler_;
    std::unique_ptr<game::GameSystem> gameSystem_;
    platform::sdl::SdlLifecycle lifecycle_;
    platform::sdl::SdlWindow window_;
    render::backend::RendererRouter renderer_;
    platform::sdl::SdlUserStorage storage_;
    platform::sdl::SdlSettingsStorage settingsStorage_;
    settings::SettingsRepository settingsRepository_;
    settings::SettingsOverlaySession settingsOverlaySession_;
    debug::DebugRuntimeController debugRuntime_;
    platform::sdl::SdlPlaybackDevice audio_;
    ui::TitleOverlayStateMachine titleUiState_;
    ui::TitleUiController titleUiController_;
    ui::layout::UiLayoutMetrics titleLayout_;
    TitleDisplayArea titleDisplayArea_{};
    ui::layout::ThemeMetrics titleTheme_;
    ui::layout::TitleEntranceRenderState titleEntrance_;
    ui::TitleOverlayPresentationSet titleOverlayPresentations_{};
    render::FramePacket framePacket_;
    std::vector<std::byte> titleFontBytes_;
    std::unique_ptr<render::text::ShapedTextCache> titleTextCache_;
    render::backend::RendererPreference rendererPreference_ =
        render::backend::RendererPreference::automatic;
    std::uint64_t previousFrameTicks_ = 0;
    std::uint64_t renderedFrameCount_ = 0;
    std::uint64_t simulationTick_ = 0;
    std::uint64_t projectionRevision_ = 1;
    std::uint64_t titleBackdropRevision_ = 1;
    std::uint64_t titleBackdropProjectionRevision_ = 0;
    std::uint64_t titleBackdropControlStateRevision_ = 0;
    std::uint64_t titleControlStateRevision_ = 1;
    std::uint64_t titleTextGeneration_ = 0;
    std::uint64_t debugPersistenceRetryAtMilliseconds_ = 0;
    MovementInputBuffer movementInput_;
    platform::sdl::WindowDisplayConfiguration settingsWindowBaseline_{};
    ui::layout::UiLayoutSnapshot titleBackdropLayout_{};
    ui::layout::TitleEntranceRenderState titleBackdropEntrance_{};
    ui::TitleUiControllerSnapshot titleBackdropInteraction_{};
    std::array<ui::OverlaySnapshot, ui::maximum_overlay_count> titleBackdropOverlays_{};
    std::uint8_t titleBackdropOverlayCount_ = 0;
    std::uint32_t settingsDismissedSequence_ = 0;
    std::uint32_t settingsWindowBaselineSequence_ = 0;
    std::uint32_t settingsWindowPreviewSequence_ = 0;
    std::uint8_t renderRecoverySmokeStage_ = 0;
    std::uint8_t titleToPlayableSmokeStage_ = 0;
    std::uint8_t debugPersistenceAttemptCount_ = 0;
    double previousFrameCpuSeconds_ = 0;
    SceneMode sceneMode_ = SceneMode::title;
    SettingsBootState settingsBootState_ = SettingsBootState::waiting;
    bool initialized_ = false;
    bool smokeTest_ = false;
    bool titleToPlayableSmoke_ = false;
    bool titleMissingCapabilitiesReported_ = false;
    bool titleBackdropSnapshotValid_ = false;
    bool debugPersistencePending_ = false;
    bool pendingDebugMode_ = false;
    bool storageReadyReported_ = false;
    bool storageSmokeComplete_ = false;
    bool audioSmokeComplete_ = false;
    bool redrawPending_ = false;
    bool rendererSizeDirty_ = true;
    bool drawableReady_ = false;
    bool renderTargetsResetPending_ = false;
    bool renderDeviceRecoveryPending_ = false;
};

} // namespace cirvivor::app
