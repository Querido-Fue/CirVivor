#pragma once

#include "render/backend/render_backend.h"
#include "render/software/software_renderer.h"

#include <cstdint>
#include <memory>
#include <string_view>

struct SDL_Renderer;
struct SDL_Texture;
struct SDL_Window;

namespace cirvivor::render::software {

enum class SoftwareBackendError : std::uint8_t {
    none = 0,
    alreadyInitialized,
    notInitialized,
    invalidWindow,
    videoSubsystemUnavailable,
    rendererAlreadyAttached,
    rendererCreationFailed,
    rendererOutputQueryFailed,
    invalidDrawableSize,
    unsupportedInternalSize,
    cpuSurfaceUnavailable,
    textureCreationFailed,
    textureBlendModeFailed,
    textureScaleModeFailed,
    invalidFrameStructure,
    invalidFrameOrder,
    cpuRasterizationFailed,
    invalidCpuSurface,
    textureUploadFailed,
    presentationClearFailed,
    texturePresentationFailed,
    framePresentationFailed
};

[[nodiscard]] std::string_view softwareBackendErrorMessage(
    SoftwareBackendError error
) noexcept;

struct SoftwarePresentationRect final {
    float x = 0.0F;
    float y = 0.0F;
    float width = 0.0F;
    float height = 0.0F;

    constexpr bool operator==(const SoftwarePresentationRect&) const noexcept = default;
};

struct SoftwareBackendStats final {
    SoftwareRenderStats raster;
    std::uint64_t pixelHash = 0;
    std::uint64_t presentedFrameCount = 0;
    std::uint64_t backgroundSkippedFrameCount = 0;
};

/**
 * FramePacket을 고정 해상도 CPU surface에 rasterize하고 SDL_Renderer를 통해
 * 외부 SDL_Window에 표시합니다. window는 비소유이며 이 객체보다 오래 살아야 합니다.
 *
 * 이 backend가 살아 있는 동안 SDL_Renderer를 독점합니다. 같은 window에 SDL_GPU
 * device를 claim하거나 GLES context/다른 SDL_Renderer를 동시에 만들면 안 됩니다.
 * 모든 수명주기 함수는 SDL video main thread에서 호출해야 합니다.
 */
class SoftwareBackend final : public backend::IRenderBackend {
public:
    explicit SoftwareBackend(
        SDL_Window* externalWindow,
        SizeI internalSize = SoftwareRenderer::default_internal_size
    ) noexcept;
    ~SoftwareBackend() noexcept override;

    SoftwareBackend(const SoftwareBackend&) = delete;
    SoftwareBackend& operator=(const SoftwareBackend&) = delete;
    SoftwareBackend(SoftwareBackend&&) = delete;
    SoftwareBackend& operator=(SoftwareBackend&&) = delete;

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

    [[nodiscard]] bool isInitialized() const noexcept;
    [[nodiscard]] bool isBackgrounded() const noexcept;
    [[nodiscard]] SizeI internalSize() const noexcept;
    [[nodiscard]] SizeI drawableSize() const noexcept;
    [[nodiscard]] SoftwarePresentationRect presentationRect() const noexcept;
    [[nodiscard]] std::uint64_t pixelHash() const noexcept;
    [[nodiscard]] const SoftwareBackendStats& lastStats() const noexcept;
    [[nodiscard]] SoftwareBackendError lastError() const noexcept;
    [[nodiscard]] std::string_view lastErrorMessage() const noexcept;

private:
    struct RendererDeleter final {
        void operator()(SDL_Renderer* renderer) const noexcept;
    };

    struct TextureDeleter final {
        void operator()(SDL_Texture* texture) const noexcept;
    };

    using RendererPointer = std::unique_ptr<SDL_Renderer, RendererDeleter>;
    using TexturePointer = std::unique_ptr<SDL_Texture, TextureDeleter>;

    [[nodiscard]] bool fail(SoftwareBackendError error) noexcept;
    void succeed() noexcept;

    SDL_Window* window_ = nullptr;
    SizeI requestedInternalSize_{};
    SoftwareRenderer softwareRenderer_;
    RendererPointer renderer_;
    TexturePointer texture_;
    backend::RenderCapabilities capabilities_;
    SizeI drawableSize_{};
    SoftwarePresentationRect presentationRect_{};
    SoftwareBackendStats stats_{};
    SoftwareBackendError lastError_ = SoftwareBackendError::none;
    bool backgrounded_ = false;
};

} // namespace cirvivor::render::software
