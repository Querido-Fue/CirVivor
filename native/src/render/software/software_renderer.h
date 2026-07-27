#pragma once

#include "render/common/frame_packet.h"
#include "render/common/render_resources.h"

#include <SDL3/SDL_surface.h>

#include <cstdint>
#include <memory>

namespace cirvivor::render::software {

enum class SoftwareRenderError : std::uint8_t {
    none = 0,
    invalidDimensions,
    surfaceCreationFailed,
    invalidSurfaceFormat,
    surfaceLockFailed,
    invalidFramePacket,
    invalidViewport,
    invalidResources,
    missingGlyphAtlas,
    invalidGlyphAtlasReference
};

/** placeholderCommands는 rendered/skipped 합계와 겹치는 진단 축입니다. */
struct SoftwareRenderStats final {
    std::uint64_t submittedCommands = 0;
    std::uint64_t renderedCommands = 0;
    std::uint64_t placeholderCommands = 0;
    std::uint64_t skippedCommands = 0;
    double wallClockMilliseconds = 0.0;
};

struct SdlSurfaceDeleter final {
    void operator()(SDL_Surface* surface) const noexcept;
};

/**
 * SDL_PIXELFORMAT_ARGB8888 표면을 소유하는 CPU renderer입니다. 출력은 FramePacket의
 * 값에만 의존하며 wallClockMilliseconds는 진단 정보로만 기록합니다.
 */
class SoftwareRenderer final {
public:
    static constexpr SizeI default_internal_size{960, 540};
    static constexpr SizeI reduced_internal_size{640, 360};

    SoftwareRenderer() noexcept;
    explicit SoftwareRenderer(SizeI internalSize) noexcept;
    ~SoftwareRenderer() = default;

    SoftwareRenderer(const SoftwareRenderer&) = delete;
    SoftwareRenderer& operator=(const SoftwareRenderer&) = delete;
    SoftwareRenderer(SoftwareRenderer&&) noexcept = default;
    SoftwareRenderer& operator=(SoftwareRenderer&&) noexcept = default;

    [[nodiscard]] bool resize(int width, int height) noexcept;
    [[nodiscard]] bool resize(SizeI internalSize) noexcept;
    [[nodiscard]] bool clear(PremultipliedRgba color) noexcept;
    [[nodiscard]] bool render(
        const FramePacket& frame,
        RenderResourcesView resources = {}
    ) noexcept;

    [[nodiscard]] bool isValid() const noexcept;
    [[nodiscard]] SizeI internalSize() const noexcept;
    [[nodiscard]] const SDL_Surface* surface() const noexcept;
    [[nodiscard]] std::uint64_t pixelHash() const noexcept;
    [[nodiscard]] SoftwareRenderError lastError() const noexcept;
    [[nodiscard]] const SoftwareRenderStats& lastStats() const noexcept;

private:
    using SurfacePointer = std::unique_ptr<SDL_Surface, SdlSurfaceDeleter>;

    SurfacePointer surface_;
    SoftwareRenderError lastError_ = SoftwareRenderError::none;
    SoftwareRenderStats lastStats_;
};

} // namespace cirvivor::render::software
