#include "render/software/software_backend.h"

#include <SDL3/SDL.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>
#include <utility>

namespace cirvivor::render::software {
namespace {

[[nodiscard]] bool isSupportedInternalSize(const SizeI size) noexcept {
    return size == SoftwareRenderer::default_internal_size
        || size == SoftwareRenderer::reduced_internal_size;
}

[[nodiscard]] bool isValidDrawableSize(const SizeI size) noexcept {
    return size.width > 0 && size.height > 0;
}

[[nodiscard]] SoftwarePresentationRect makePresentationRect(
    const SizeI drawableSize,
    const SizeI internalSize
) noexcept {
    const bool widthLimited = static_cast<std::int64_t>(drawableSize.width)
            * internalSize.height
        <= static_cast<std::int64_t>(drawableSize.height) * internalSize.width;
    if (widthLimited) {
        const double height = static_cast<double>(drawableSize.width)
            * static_cast<double>(internalSize.height)
            / static_cast<double>(internalSize.width);
        return {
            0.0F,
            static_cast<float>(
                (static_cast<double>(drawableSize.height) - height) * 0.5
            ),
            static_cast<float>(drawableSize.width),
            static_cast<float>(height)
        };
    }

    const double width = static_cast<double>(drawableSize.height)
        * static_cast<double>(internalSize.width)
        / static_cast<double>(internalSize.height);
    return {
        static_cast<float>((static_cast<double>(drawableSize.width) - width) * 0.5),
        0.0F,
        static_cast<float>(width),
        static_cast<float>(drawableSize.height)
    };
}

[[nodiscard]] bool presentationRectIsValid(
    const SoftwarePresentationRect rect,
    const SizeI drawableSize
) noexcept {
    return std::isfinite(rect.x)
        && std::isfinite(rect.y)
        && std::isfinite(rect.width)
        && std::isfinite(rect.height)
        && rect.x >= 0.0F
        && rect.y >= 0.0F
        && rect.width > 0.0F
        && rect.height > 0.0F
        && rect.x + rect.width <= static_cast<float>(drawableSize.width) + 0.5F
        && rect.y + rect.height <= static_cast<float>(drawableSize.height) + 0.5F;
}

[[nodiscard]] bool surfaceIsUploadable(
    const SDL_Surface* const surface,
    const SizeI internalSize
) noexcept {
    if (surface == nullptr
        || surface->format != SDL_PIXELFORMAT_ARGB8888
        || surface->pixels == nullptr
        || surface->w != internalSize.width
        || surface->h != internalSize.height) {
        return false;
    }

    constexpr int bytesPerPixel = static_cast<int>(sizeof(std::uint32_t));
    if (surface->w > std::numeric_limits<int>::max() / bytesPerPixel) {
        return false;
    }
    return surface->pitch >= surface->w * bytesPerPixel;
}

} // namespace

std::string_view softwareBackendErrorMessage(const SoftwareBackendError error) noexcept {
    switch (error) {
    case SoftwareBackendError::none:
        return "no error";
    case SoftwareBackendError::alreadyInitialized:
        return "software backend is already initialized";
    case SoftwareBackendError::notInitialized:
        return "software backend is not initialized";
    case SoftwareBackendError::invalidWindow:
        return "software backend received an invalid SDL window";
    case SoftwareBackendError::videoSubsystemUnavailable:
        return "SDL video subsystem is not initialized";
    case SoftwareBackendError::rendererAlreadyAttached:
        return "SDL window already has a renderer attached";
    case SoftwareBackendError::rendererCreationFailed:
        return "SDL renderer creation failed";
    case SoftwareBackendError::rendererOutputQueryFailed:
        return "SDL renderer output size query failed";
    case SoftwareBackendError::invalidDrawableSize:
        return "software backend received an invalid drawable size";
    case SoftwareBackendError::unsupportedInternalSize:
        return "software backend supports only 960x540 or 640x360";
    case SoftwareBackendError::cpuSurfaceUnavailable:
        return "software renderer CPU surface is unavailable";
    case SoftwareBackendError::textureCreationFailed:
        return "ARGB8888 streaming texture creation failed";
    case SoftwareBackendError::textureBlendModeFailed:
        return "premultiplied texture blend mode setup failed";
    case SoftwareBackendError::textureScaleModeFailed:
        return "texture scale mode setup failed";
    case SoftwareBackendError::invalidFrameStructure:
        return "FramePacket structure is invalid";
    case SoftwareBackendError::invalidFrameOrder:
        return "FramePacket render order is invalid";
    case SoftwareBackendError::cpuRasterizationFailed:
        return "software renderer CPU rasterization failed";
    case SoftwareBackendError::invalidCpuSurface:
        return "software renderer produced an invalid ARGB8888 surface";
    case SoftwareBackendError::textureUploadFailed:
        return "software frame texture upload failed";
    case SoftwareBackendError::presentationClearFailed:
        return "software frame letterbox clear failed";
    case SoftwareBackendError::texturePresentationFailed:
        return "software frame texture presentation failed";
    case SoftwareBackendError::framePresentationFailed:
        return "software frame present failed";
    }
    return "unknown software backend error";
}

SoftwareBackend::SoftwareBackend(
    SDL_Window* const externalWindow,
    const SizeI internalSize
) noexcept
    : window_(externalWindow),
      requestedInternalSize_(internalSize),
      softwareRenderer_(internalSize) {
}

SoftwareBackend::~SoftwareBackend() noexcept {
    shutdown();
}

void SoftwareBackend::RendererDeleter::operator()(SDL_Renderer* const renderer) const noexcept {
    SDL_DestroyRenderer(renderer);
}

void SoftwareBackend::TextureDeleter::operator()(SDL_Texture* const texture) const noexcept {
    SDL_DestroyTexture(texture);
}

backend::RenderBackendKind SoftwareBackend::kind() const noexcept {
    return backend::RenderBackendKind::software;
}

const backend::RenderCapabilities& SoftwareBackend::capabilities() const noexcept {
    return capabilities_;
}

backend::BackendInitializeResult SoftwareBackend::initialize() {
    if (renderer_ != nullptr || texture_ != nullptr) {
        lastError_ = SoftwareBackendError::alreadyInitialized;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }

    stats_ = {};
    drawableSize_ = {};
    presentationRect_ = {};
    backgrounded_ = false;

    if (window_ == nullptr) {
        lastError_ = SoftwareBackendError::invalidWindow;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }
    if ((SDL_WasInit(SDL_INIT_VIDEO) & SDL_INIT_VIDEO) == 0U) {
        lastError_ = SoftwareBackendError::videoSubsystemUnavailable;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }

    const SDL_WindowID windowId = SDL_GetWindowID(window_);
    if (windowId == 0U || SDL_GetWindowFromID(windowId) != window_) {
        lastError_ = SoftwareBackendError::invalidWindow;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }
    if (SDL_GetRenderer(window_) != nullptr) {
        lastError_ = SoftwareBackendError::rendererAlreadyAttached;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }
    if (!isSupportedInternalSize(requestedInternalSize_)) {
        lastError_ = SoftwareBackendError::unsupportedInternalSize;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }
    if (!softwareRenderer_.resize(requestedInternalSize_)
        || !softwareRenderer_.isValid()) {
        lastError_ = SoftwareBackendError::cpuSurfaceUnavailable;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }

    capabilities_ = {
        false,
        false,
        false,
        false,
        std::max(requestedInternalSize_.width, requestedInternalSize_.height),
        1,
        "software",
        "SDL_Renderer streaming presenter"
    };
    capabilities_.mainCallbackRateLimitHz = 30;
    capabilities_.supportsGlyphRunAtlas = true;

    RendererPointer candidateRenderer(SDL_CreateRenderer(window_, nullptr));
    if (candidateRenderer == nullptr) {
        lastError_ = SoftwareBackendError::rendererCreationFailed;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }
    // CPU raster와 present 대기를 분리할 API가 생기기 전까지 실제 window에서는
    // renderer VSync가 callback busy-loop를 막는다. dummy/software driver가 이를
    // 지원하지 않는 경우에도 backend 초기화 자체는 계속할 수 있다.
    static_cast<void>(SDL_SetRenderVSync(candidateRenderer.get(), 1));

    int drawableWidth = 0;
    int drawableHeight = 0;
    if (!SDL_GetRenderOutputSize(candidateRenderer.get(), &drawableWidth, &drawableHeight)) {
        lastError_ = SoftwareBackendError::rendererOutputQueryFailed;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }
    SizeI candidateDrawableSize{drawableWidth, drawableHeight};
    if (!isValidDrawableSize(candidateDrawableSize)) {
        int windowPixelWidth = 0;
        int windowPixelHeight = 0;
        if (SDL_GetWindowSizeInPixels(window_, &windowPixelWidth, &windowPixelHeight)) {
            candidateDrawableSize = {windowPixelWidth, windowPixelHeight};
        }
    }
    if (!isValidDrawableSize(candidateDrawableSize)) {
        int windowWidth = 0;
        int windowHeight = 0;
        if (SDL_GetWindowSize(window_, &windowWidth, &windowHeight)) {
            candidateDrawableSize = {windowWidth, windowHeight};
        }
    }
    if (!isValidDrawableSize(candidateDrawableSize)) {
        const SDL_WindowFlags flags = SDL_GetWindowFlags(window_);
        if ((flags & (SDL_WINDOW_HIDDEN | SDL_WINDOW_MINIMIZED)) != 0U) {
            candidateDrawableSize = requestedInternalSize_;
        }
    }
    if (!isValidDrawableSize(candidateDrawableSize)) {
        lastError_ = SoftwareBackendError::invalidDrawableSize;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }
    const SoftwarePresentationRect candidatePresentationRect = makePresentationRect(
        candidateDrawableSize,
        requestedInternalSize_
    );
    if (!presentationRectIsValid(candidatePresentationRect, candidateDrawableSize)) {
        lastError_ = SoftwareBackendError::invalidDrawableSize;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }

    TexturePointer candidateTexture(SDL_CreateTexture(
        candidateRenderer.get(),
        SDL_PIXELFORMAT_ARGB8888,
        SDL_TEXTUREACCESS_STREAMING,
        requestedInternalSize_.width,
        requestedInternalSize_.height
    ));
    if (candidateTexture == nullptr) {
        lastError_ = SoftwareBackendError::textureCreationFailed;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }

    if (!SDL_SetTextureBlendMode(
            candidateTexture.get(),
            SDL_BLENDMODE_BLEND_PREMULTIPLIED
        )) {
        lastError_ = SoftwareBackendError::textureBlendModeFailed;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }
    if (!SDL_SetTextureScaleMode(candidateTexture.get(), SDL_SCALEMODE_LINEAR)) {
        lastError_ = SoftwareBackendError::textureScaleModeFailed;
        return backend::BackendInitializeResult::failure(
            std::string(softwareBackendErrorMessage(lastError_))
        );
    }

    const SDL_PropertiesID rendererProperties = SDL_GetRendererProperties(
        candidateRenderer.get()
    );
    if (rendererProperties != 0U) {
        const Sint64 maximumTextureSize = SDL_GetNumberProperty(
            rendererProperties,
            SDL_PROP_RENDERER_MAX_TEXTURE_SIZE_NUMBER,
            capabilities_.maximumTextureSize
        );
        if (maximumTextureSize > 0
            && maximumTextureSize <= std::numeric_limits<std::int32_t>::max()) {
            capabilities_.maximumTextureSize = static_cast<std::int32_t>(maximumTextureSize);
        }
    }
    if (const char* const rendererName = SDL_GetRendererName(candidateRenderer.get());
        rendererName != nullptr && rendererName[0] != '\0') {
        capabilities_.adapterName = rendererName;
    }

    renderer_ = std::move(candidateRenderer);
    texture_ = std::move(candidateTexture);
    drawableSize_ = candidateDrawableSize;
    presentationRect_ = candidatePresentationRect;
    succeed();
    return backend::BackendInitializeResult::success();
}

void SoftwareBackend::shutdown() noexcept {
    texture_.reset();
    renderer_.reset();
    drawableSize_ = {};
    presentationRect_ = {};
    stats_ = {};
    backgrounded_ = false;
    succeed();
}

bool SoftwareBackend::resize(
    const std::int32_t drawableWidth,
    const std::int32_t drawableHeight
) noexcept {
    if (!isInitialized()) {
        return fail(SoftwareBackendError::notInitialized);
    }

    const SizeI candidateDrawableSize{drawableWidth, drawableHeight};
    if (!isValidDrawableSize(candidateDrawableSize)) {
        return fail(SoftwareBackendError::invalidDrawableSize);
    }
    const SoftwarePresentationRect candidatePresentationRect = makePresentationRect(
        candidateDrawableSize,
        softwareRenderer_.internalSize()
    );
    if (!presentationRectIsValid(candidatePresentationRect, candidateDrawableSize)) {
        return fail(SoftwareBackendError::invalidDrawableSize);
    }

    drawableSize_ = candidateDrawableSize;
    presentationRect_ = candidatePresentationRect;
    succeed();
    return true;
}

bool SoftwareBackend::render(
    const FramePacket& frame,
    const RenderResourcesView resources
) noexcept {
    if (!isInitialized()) {
        return fail(SoftwareBackendError::notInitialized);
    }
    if (backgrounded_) {
        ++stats_.backgroundSkippedFrameCount;
        succeed();
        return true;
    }
    if (!frame.isStructurallyValid()) {
        return fail(SoftwareBackendError::invalidFrameStructure);
    }
    if (!frame.isRenderOrderValid()) {
        return fail(SoftwareBackendError::invalidFrameOrder);
    }
    if (!softwareRenderer_.render(frame, resources)) {
        stats_.raster = softwareRenderer_.lastStats();
        return fail(SoftwareBackendError::cpuRasterizationFailed);
    }

    stats_.raster = softwareRenderer_.lastStats();
    stats_.pixelHash = softwareRenderer_.pixelHash();
    const SDL_Surface* const surface = softwareRenderer_.surface();
    if (!surfaceIsUploadable(surface, softwareRenderer_.internalSize())) {
        return fail(SoftwareBackendError::invalidCpuSurface);
    }
    if (!SDL_UpdateTexture(texture_.get(), nullptr, surface->pixels, surface->pitch)) {
        return fail(SoftwareBackendError::textureUploadFailed);
    }
    if (!SDL_SetRenderDrawColor(renderer_.get(), 0U, 0U, 0U, SDL_ALPHA_OPAQUE)
        || !SDL_RenderClear(renderer_.get())) {
        return fail(SoftwareBackendError::presentationClearFailed);
    }

    const SDL_FRect destination{
        presentationRect_.x,
        presentationRect_.y,
        presentationRect_.width,
        presentationRect_.height
    };
    if (!SDL_RenderTexture(renderer_.get(), texture_.get(), nullptr, &destination)) {
        return fail(SoftwareBackendError::texturePresentationFailed);
    }
    if (!SDL_RenderPresent(renderer_.get())) {
        return fail(SoftwareBackendError::framePresentationFailed);
    }

    ++stats_.presentedFrameCount;
    succeed();
    return true;
}

bool SoftwareBackend::onBackground() noexcept {
    if (!isInitialized()) {
        return fail(SoftwareBackendError::notInitialized);
    }
    backgrounded_ = true;
    succeed();
    return true;
}

bool SoftwareBackend::onForeground() noexcept {
    if (!isInitialized()) {
        return fail(SoftwareBackendError::notInitialized);
    }
    backgrounded_ = false;
    succeed();
    return true;
}

bool SoftwareBackend::purgeTransientResources() noexcept {
    if (!isInitialized()) {
        return fail(SoftwareBackendError::notInitialized);
    }
    succeed();
    return true;
}

bool SoftwareBackend::isInitialized() const noexcept {
    return renderer_ != nullptr && texture_ != nullptr;
}

bool SoftwareBackend::isBackgrounded() const noexcept {
    return backgrounded_;
}

SizeI SoftwareBackend::internalSize() const noexcept {
    return softwareRenderer_.internalSize();
}

SizeI SoftwareBackend::drawableSize() const noexcept {
    return drawableSize_;
}

SoftwarePresentationRect SoftwareBackend::presentationRect() const noexcept {
    return presentationRect_;
}

std::uint64_t SoftwareBackend::pixelHash() const noexcept {
    return stats_.pixelHash;
}

const SoftwareBackendStats& SoftwareBackend::lastStats() const noexcept {
    return stats_;
}

SoftwareBackendError SoftwareBackend::lastError() const noexcept {
    return lastError_;
}

std::string_view SoftwareBackend::lastErrorMessage() const noexcept {
    return softwareBackendErrorMessage(lastError_);
}

bool SoftwareBackend::fail(const SoftwareBackendError error) noexcept {
    lastError_ = error;
    return false;
}

void SoftwareBackend::succeed() noexcept {
    lastError_ = SoftwareBackendError::none;
}

} // namespace cirvivor::render::software
