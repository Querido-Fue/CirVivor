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
    [[nodiscard]] bool updatePlatformServices() noexcept;
    [[nodiscard]] bool runStorageSmokeTest() noexcept;
    [[nodiscard]] bool setExecutionActive(bool active) noexcept;
    [[nodiscard]] bool tryConsumeWindowCloseRequest() noexcept;
    void applyMovementAction(const platform::sdl::PlatformEvent& event) noexcept;
    void clearMovementActions() noexcept;
    void configureActiveCallbackRate() noexcept;
    void resetFrameClock() noexcept;

    engine::FrameScheduler scheduler_;
    game::GameSystem gameSystem_;
    platform::sdl::SdlLifecycle lifecycle_;
    platform::sdl::SdlWindow window_;
    render::backend::RendererRouter renderer_;
    platform::sdl::SdlUserStorage storage_;
    platform::sdl::SdlPlaybackDevice audio_;
    render::FramePacket framePacket_;
    render::backend::RendererPreference rendererPreference_ =
        render::backend::RendererPreference::automatic;
    std::uint64_t previousFrameTicks_ = 0;
    std::uint64_t renderedFrameCount_ = 0;
    std::uint64_t simulationTick_ = 0;
    std::uint64_t projectionRevision_ = 1;
    MovementInputBuffer movementInput_;
    std::uint8_t renderRecoverySmokeStage_ = 0;
    double previousFrameCpuSeconds_ = 0;
    bool initialized_ = false;
    bool smokeTest_ = false;
    bool diagnosticScene_ = false;
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
