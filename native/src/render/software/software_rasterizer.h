#pragma once

#include "render/common/frame_packet.h"
#include "render/common/render_resources.h"

#include <SDL3/SDL_surface.h>

#include <cstdint>

namespace cirvivor::render::software::detail {

enum class RasterError : std::uint8_t {
    none = 0,
    invalidSurface,
    surfaceLockFailed,
    invalidViewport,
    invalidResources,
    missingGlyphAtlas,
    invalidGlyphAtlasReference
};

struct RasterResult final {
    RasterError error = RasterError::none;
    std::uint64_t renderedCommands = 0;
    std::uint64_t placeholderCommands = 0;
    std::uint64_t skippedCommands = 0;
};

[[nodiscard]] RasterError clearSurface(
    SDL_Surface& surface,
    PremultipliedRgba color
) noexcept;

[[nodiscard]] RasterResult rasterFrame(
    SDL_Surface& surface,
    const FramePacket& frame,
    RenderResourcesView resources = {}
) noexcept;

[[nodiscard]] std::uint64_t hashSurface(SDL_Surface& surface) noexcept;

} // namespace cirvivor::render::software::detail
