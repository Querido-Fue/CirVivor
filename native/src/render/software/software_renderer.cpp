#include "render/software/software_renderer.h"

#include "render/software/software_rasterizer.h"

#include <SDL3/SDL_pixels.h>

#include <chrono>
#include <utility>

namespace cirvivor::render::software {

namespace {

constexpr int maximum_surface_dimension = 8'192;
constexpr std::uint64_t maximum_surface_pixels = 64ULL * 1'024ULL * 1'024ULL;

[[nodiscard]] bool dimensionsAreValid(const int width, const int height) noexcept {
    return width > 0
        && height > 0
        && width <= maximum_surface_dimension
        && height <= maximum_surface_dimension
        && static_cast<std::uint64_t>(width) * static_cast<std::uint64_t>(height)
            <= maximum_surface_pixels;
}

[[nodiscard]] SoftwareRenderError mapRasterError(const detail::RasterError error) noexcept {
    switch (error) {
        case detail::RasterError::none:
            return SoftwareRenderError::none;
        case detail::RasterError::invalidSurface:
            return SoftwareRenderError::invalidSurfaceFormat;
        case detail::RasterError::surfaceLockFailed:
            return SoftwareRenderError::surfaceLockFailed;
        case detail::RasterError::invalidViewport:
            return SoftwareRenderError::invalidViewport;
    }
    return SoftwareRenderError::invalidSurfaceFormat;
}

} // namespace

void SdlSurfaceDeleter::operator()(SDL_Surface* const surface) const noexcept {
    SDL_DestroySurface(surface);
}

SoftwareRenderer::SoftwareRenderer() noexcept {
    (void)resize(default_internal_size);
}

SoftwareRenderer::SoftwareRenderer(const SizeI internalSize) noexcept {
    (void)resize(internalSize);
}

bool SoftwareRenderer::resize(const int width, const int height) noexcept {
    return resize(SizeI{width, height});
}

bool SoftwareRenderer::resize(const SizeI internalSize) noexcept {
    if (!dimensionsAreValid(internalSize.width, internalSize.height)) {
        lastError_ = SoftwareRenderError::invalidDimensions;
        return false;
    }
    if (surface_ != nullptr
        && surface_->w == internalSize.width
        && surface_->h == internalSize.height
        && surface_->format == SDL_PIXELFORMAT_ARGB8888) {
        lastError_ = SoftwareRenderError::none;
        return true;
    }

    SurfacePointer replacement(
        SDL_CreateSurface(
            internalSize.width,
            internalSize.height,
            SDL_PIXELFORMAT_ARGB8888
        )
    );
    if (replacement == nullptr) {
        lastError_ = SoftwareRenderError::surfaceCreationFailed;
        return false;
    }
    if (replacement->format != SDL_PIXELFORMAT_ARGB8888
        || replacement->pixels == nullptr
        || replacement->pitch < internalSize.width * static_cast<int>(sizeof(std::uint32_t))) {
        lastError_ = SoftwareRenderError::invalidSurfaceFormat;
        return false;
    }

    surface_ = std::move(replacement);
    lastStats_ = {};
    lastError_ = SoftwareRenderError::none;
    return true;
}

bool SoftwareRenderer::clear(const PremultipliedRgba color) noexcept {
    if (surface_ == nullptr) {
        lastError_ = SoftwareRenderError::invalidSurfaceFormat;
        return false;
    }
    const detail::RasterError result = detail::clearSurface(*surface_, color);
    lastError_ = mapRasterError(result);
    return result == detail::RasterError::none;
}

bool SoftwareRenderer::render(const FramePacket& frame) noexcept {
    lastStats_ = {};
    lastStats_.submittedCommands = frame.commandStream().size();
    if (surface_ == nullptr) {
        lastError_ = SoftwareRenderError::invalidSurfaceFormat;
        return false;
    }
    if (!frame.isRenderOrderValid()) {
        lastError_ = SoftwareRenderError::invalidFramePacket;
        return false;
    }

    const auto start = std::chrono::steady_clock::now();
    const detail::RasterResult result = detail::rasterFrame(*surface_, frame);
    const auto end = std::chrono::steady_clock::now();

    lastStats_.renderedCommands = result.renderedCommands;
    lastStats_.placeholderCommands = result.placeholderCommands;
    lastStats_.skippedCommands = result.skippedCommands;
    lastStats_.wallClockMilliseconds = std::chrono::duration<double, std::milli>(end - start).count();
    lastError_ = mapRasterError(result.error);
    return result.error == detail::RasterError::none;
}

bool SoftwareRenderer::isValid() const noexcept {
    return surface_ != nullptr
        && surface_->format == SDL_PIXELFORMAT_ARGB8888
        && surface_->pixels != nullptr
        && surface_->w > 0
        && surface_->h > 0;
}

SizeI SoftwareRenderer::internalSize() const noexcept {
    return surface_ == nullptr ? SizeI{} : SizeI{surface_->w, surface_->h};
}

const SDL_Surface* SoftwareRenderer::surface() const noexcept {
    return surface_.get();
}

std::uint64_t SoftwareRenderer::pixelHash() const noexcept {
    return surface_ == nullptr ? 0U : detail::hashSurface(*surface_);
}

SoftwareRenderError SoftwareRenderer::lastError() const noexcept {
    return lastError_;
}

const SoftwareRenderStats& SoftwareRenderer::lastStats() const noexcept {
    return lastStats_;
}

} // namespace cirvivor::render::software
