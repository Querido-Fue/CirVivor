#pragma once

#include "render/backend/render_backend.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string_view>

struct SDL_GPUCommandBuffer;
struct SDL_GPUDevice;
struct SDL_Window;

namespace cirvivor::render::sdl_gpu {

namespace detail {
struct SdlGpuDrawState;
}

enum class SdlGpuError : std::uint8_t {
    none = 0,
    alreadyInitialized,
    videoSubsystemNotInitialized,
    nullWindow,
    invalidWindow,
    propertiesCreationFailed,
    propertiesConfigurationFailed,
    deviceCreationFailed,
    deviceDriverQueryFailed,
    shaderFormatQueryFailed,
    windowClaimFailed,
    swapchainFormatQueryFailed,
    invalidDrawCapacity,
    shaderAssetUnavailable,
    shaderCreationFailed,
    pipelineCreationFailed,
    vertexBufferCreationFailed,
    transferBufferCreationFailed,
    notInitialized,
    invalidDimensions,
    invalidFramePacket,
    geometryBuildFailed,
    transferBufferMapFailed,
    copyPassBeginFailed,
    deviceLost,
    commandBufferAcquireFailed,
    swapchainAcquireFailed,
    commandBufferCancelFailed,
    renderPassBeginFailed,
    commandBufferSubmitFailed,
    gpuIdleWaitFailed
};

[[nodiscard]] constexpr std::string_view sdlGpuErrorName(
    const SdlGpuError error
) noexcept {
    switch (error) {
    case SdlGpuError::none:
        return "none";
    case SdlGpuError::alreadyInitialized:
        return "already initialized";
    case SdlGpuError::videoSubsystemNotInitialized:
        return "SDL video subsystem is not initialized";
    case SdlGpuError::nullWindow:
        return "SDL window is null";
    case SdlGpuError::invalidWindow:
        return "SDL window is invalid";
    case SdlGpuError::propertiesCreationFailed:
        return "GPU device properties creation failed";
    case SdlGpuError::propertiesConfigurationFailed:
        return "GPU device properties configuration failed";
    case SdlGpuError::deviceCreationFailed:
        return "GPU device creation failed";
    case SdlGpuError::deviceDriverQueryFailed:
        return "GPU device driver query failed";
    case SdlGpuError::shaderFormatQueryFailed:
        return "GPU shader format query failed";
    case SdlGpuError::windowClaimFailed:
        return "GPU window claim failed";
    case SdlGpuError::swapchainFormatQueryFailed:
        return "GPU swapchain format query failed";
    case SdlGpuError::invalidDrawCapacity:
        return "GPU draw capacity is invalid";
    case SdlGpuError::shaderAssetUnavailable:
        return "no embedded shader matches the selected GPU format";
    case SdlGpuError::shaderCreationFailed:
        return "GPU shader creation failed";
    case SdlGpuError::pipelineCreationFailed:
        return "GPU graphics pipeline creation failed";
    case SdlGpuError::vertexBufferCreationFailed:
        return "GPU vertex buffer creation failed";
    case SdlGpuError::transferBufferCreationFailed:
        return "GPU transfer buffer creation failed";
    case SdlGpuError::notInitialized:
        return "GPU backend is not initialized";
    case SdlGpuError::invalidDimensions:
        return "drawable dimensions must be positive";
    case SdlGpuError::invalidFramePacket:
        return "FramePacket structure, order, or premultiplied color is invalid";
    case SdlGpuError::geometryBuildFailed:
        return "FramePacket geometry generation failed";
    case SdlGpuError::transferBufferMapFailed:
        return "GPU transfer buffer mapping failed";
    case SdlGpuError::copyPassBeginFailed:
        return "GPU copy pass creation failed";
    case SdlGpuError::deviceLost:
        return "GPU device was lost";
    case SdlGpuError::commandBufferAcquireFailed:
        return "GPU command buffer acquisition failed";
    case SdlGpuError::swapchainAcquireFailed:
        return "GPU swapchain texture acquisition failed";
    case SdlGpuError::commandBufferCancelFailed:
        return "GPU command buffer cancellation failed";
    case SdlGpuError::renderPassBeginFailed:
        return "GPU render pass creation failed";
    case SdlGpuError::commandBufferSubmitFailed:
        return "GPU command buffer submission failed";
    case SdlGpuError::gpuIdleWaitFailed:
        return "GPU idle wait failed";
    }
    return "unknown SDL_GPU error";
}

struct SdlGpuBackendOptions final {
    bool debugMode = false;
    bool preferLowPower = false;
    bool verboseDiagnostics = false;
    bool enableClipDistance = false;
    bool enableDepthClamping = false;
    bool enableIndirectFirstInstance = false;
    bool enableAnisotropy = false;
    bool requireVulkanHardwareAcceleration = true;
    std::uint32_t maximumVertices = 131'072U;
    std::uint32_t maximumDrawBatches = 16'384U;

    constexpr bool operator==(const SdlGpuBackendOptions&) const noexcept = default;
};

struct SdlGpuDiagnostics final {
    std::uint32_t shaderFormatMask = 0;
    std::uint32_t swapchainTextureFormat = 0;
    std::int32_t drawableWidth = 0;
    std::int32_t drawableHeight = 0;
    std::uint64_t submittedFrames = 0;
    std::uint64_t skippedFrames = 0;
    std::uint64_t lastRenderedCommands = 0;
    std::uint64_t lastPlaceholderCommands = 0;
    std::uint64_t lastGeneratedVertices = 0;
    std::uint64_t lastDrawCalls = 0;

    constexpr bool operator==(const SdlGpuDiagnostics&) const noexcept = default;
};

/**
 * 외부 소유 SDL_Window을 SDL_GPU device에 claim하고 FramePacket의 solid geometry를
 * swapchain에 제출합니다. texture, glyph, effect, overlay 합성은 결정적인 placeholder로
 * 표시합니다. window는 backend보다 오래 살아야 하며 생성 thread에서
 * initialize/runtime/shutdown을 호출해야 합니다.
 */
class SdlGpuBackend final : public backend::IRenderBackend {
public:
    explicit SdlGpuBackend(
        SDL_Window* window,
        SdlGpuBackendOptions options = {}
    ) noexcept;
    ~SdlGpuBackend() noexcept override;

    SdlGpuBackend(const SdlGpuBackend&) = delete;
    SdlGpuBackend& operator=(const SdlGpuBackend&) = delete;
    SdlGpuBackend(SdlGpuBackend&&) = delete;
    SdlGpuBackend& operator=(SdlGpuBackend&&) = delete;

    [[nodiscard]] backend::RenderBackendKind kind() const noexcept override;
    [[nodiscard]] const backend::RenderCapabilities& capabilities() const noexcept override;
    [[nodiscard]] backend::BackendInitializeResult initialize() override;
    void shutdown() noexcept override;

    [[nodiscard]] bool resize(
        std::int32_t drawableWidth,
        std::int32_t drawableHeight
    ) noexcept override;
    [[nodiscard]] bool render(const FramePacket& frame) noexcept override;
    [[nodiscard]] bool onBackground() noexcept override;
    [[nodiscard]] bool onForeground() noexcept override;
    [[nodiscard]] bool purgeTransientResources() noexcept override;

    void notifyDeviceLost(std::string_view reason = {}) noexcept;

    [[nodiscard]] bool isInitialized() const noexcept;
    [[nodiscard]] bool isBackgrounded() const noexcept;
    [[nodiscard]] bool isDeviceLost() const noexcept;
    [[nodiscard]] SdlGpuError lastError() const noexcept;
    [[nodiscard]] std::string_view lastErrorMessage() const noexcept;
    [[nodiscard]] const SdlGpuDiagnostics& diagnostics() const noexcept;

private:
    static constexpr std::size_t error_message_capacity = 512;

    void clearError() noexcept;
    void setError(SdlGpuError error, std::string_view message) noexcept;
    void setSdlError(SdlGpuError fallback) noexcept;
    [[nodiscard]] bool requireReady() noexcept;
    [[nodiscard]] bool cancelCommandBuffer(SDL_GPUCommandBuffer* commandBuffer) noexcept;
    [[nodiscard]] bool initializeDrawResources(std::uint32_t swapchainFormat);
    void releaseDrawResources() noexcept;
    void releaseDevice() noexcept;

    SDL_Window* window_ = nullptr;
    SDL_GPUDevice* device_ = nullptr;
    SdlGpuBackendOptions options_;
    std::unique_ptr<detail::SdlGpuDrawState> drawState_;
    backend::RenderCapabilities capabilities_;
    SdlGpuDiagnostics diagnostics_;
    SdlGpuError lastError_ = SdlGpuError::none;
    std::array<char, error_message_capacity> lastErrorMessage_{};
    std::size_t lastErrorMessageSize_ = 0;
    bool windowClaimed_ = false;
    bool backgrounded_ = false;
    bool deviceLost_ = false;
};

} // namespace cirvivor::render::sdl_gpu
