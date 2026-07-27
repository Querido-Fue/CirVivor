#pragma once

#include "app/movement_input_buffer.h"
#include "engine/frame_scheduler.h"
#include "game/game_system.h"
#include "platform/sdl/audio/sdl_playback_device.h"
#include "platform/sdl/sdl_lifecycle.h"
#include "platform/sdl/storage/sdl_user_storage.h"
#include "platform/sdl/sdl_window.h"
#include "render/backend/renderer_router.h"
#include "render/common/frame_packet.h"
#include "ui/layout/ui_layout_metrics.h"
#include "ui/title_overlay_state_machine.h"
#include "ui/title_ui_controller.h"

#include <array>
#include <cstdint>
#include <memory>

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
    void shutdown() noexcept;

private:
    enum class SceneMode : std::uint8_t {
        title,
        playable,
        diagnostic
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
    [[nodiscard]] std::uint64_t refreshTitleBackdropRevision(
        const ui::UiStateSnapshot& state,
        const ui::TitleUiControllerSnapshot& interaction
    ) noexcept;
    [[nodiscard]] ApplicationResult handleTitlePointer(
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
    platform::sdl::SdlPlaybackDevice audio_;
    ui::TitleOverlayStateMachine titleUiState_;
    ui::TitleUiController titleUiController_;
    ui::layout::UiLayoutMetrics titleLayout_;
    ui::layout::TitleEntranceRenderState titleEntrance_;
    render::FramePacket framePacket_;
    render::backend::RendererPreference rendererPreference_ =
        render::backend::RendererPreference::automatic;
    std::uint64_t previousFrameTicks_ = 0;
    std::uint64_t renderedFrameCount_ = 0;
    std::uint64_t simulationTick_ = 0;
    std::uint64_t projectionRevision_ = 1;
    std::uint64_t titleBackdropRevision_ = 1;
    std::uint64_t titleBackdropProjectionRevision_ = 0;
    MovementInputBuffer movementInput_;
    ui::layout::UiLayoutSnapshot titleBackdropLayout_{};
    ui::layout::TitleEntranceRenderState titleBackdropEntrance_{};
    ui::TitleUiControllerSnapshot titleBackdropInteraction_{};
    std::array<ui::OverlaySnapshot, ui::maximum_overlay_count> titleBackdropOverlays_{};
    std::uint8_t titleBackdropOverlayCount_ = 0;
    std::uint8_t renderRecoverySmokeStage_ = 0;
    std::uint8_t titleToPlayableSmokeStage_ = 0;
    double previousFrameCpuSeconds_ = 0;
    SceneMode sceneMode_ = SceneMode::title;
    bool initialized_ = false;
    bool smokeTest_ = false;
    bool titleToPlayableSmoke_ = false;
    bool titleMissingCapabilitiesReported_ = false;
    bool titleBackdropSnapshotValid_ = false;
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
