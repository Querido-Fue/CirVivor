#include "platform/sdl/sdl_window.h"

#include <SDL3/SDL.h>

#include <cmath>

namespace cirvivor::platform::sdl {
namespace {

constexpr int initialWindowWidth = 1280;
constexpr int initialWindowHeight = 720;
constexpr int minimumWindowWidth = 640;
constexpr int minimumWindowHeight = 360;

} // namespace

SdlWindow::~SdlWindow() {
    shutdown();
}

bool SdlWindow::initialize(
    const WindowGraphicsProfile profile,
    const bool hidden
) noexcept {
    if (window_ != nullptr) {
        return false;
    }

    SDL_GL_ResetAttributes();
    const bool glesProfile = profile == WindowGraphicsProfile::gles3
        || profile == WindowGraphicsProfile::gles2;
    if (glesProfile) {
        const int majorVersion = profile == WindowGraphicsProfile::gles3 ? 3 : 2;
        const bool attributesConfigured = SDL_GL_SetAttribute(
                SDL_GL_CONTEXT_PROFILE_MASK,
                SDL_GL_CONTEXT_PROFILE_ES
            )
            && SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, majorVersion)
            && SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0)
            && SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1)
            && SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 0)
            && SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 0)
            && SDL_GL_SetAttribute(SDL_GL_RED_SIZE, 8)
            && SDL_GL_SetAttribute(SDL_GL_GREEN_SIZE, 8)
            && SDL_GL_SetAttribute(SDL_GL_BLUE_SIZE, 8)
            && SDL_GL_SetAttribute(SDL_GL_ALPHA_SIZE, 8);
        if (!attributesConfigured) {
            SDL_LogError(
                SDL_LOG_CATEGORY_APPLICATION,
                "GLES window attributes failed: %s",
                SDL_GetError()
            );
            return false;
        }
    }

    SDL_WindowFlags windowFlags = SDL_WINDOW_RESIZABLE
        | SDL_WINDOW_HIGH_PIXEL_DENSITY;
    if (glesProfile) {
        windowFlags |= SDL_WINDOW_OPENGL;
    }
    if (hidden) {
        windowFlags |= SDL_WINDOW_HIDDEN;
    }
    window_ = SDL_CreateWindow(
        "Lonely Tower",
        initialWindowWidth,
        initialWindowHeight,
        windowFlags
    );
    if (window_ == nullptr) {
        SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "Window creation failed: %s", SDL_GetError());
        shutdown();
        return false;
    }

    if (!SDL_SetWindowMinimumSize(window_, minimumWindowWidth, minimumWindowHeight)) {
        SDL_LogWarn(
            SDL_LOG_CATEGORY_APPLICATION,
            "Window minimum size was not applied: %s",
            SDL_GetError()
        );
    }
    if (!refreshMetrics()) {
        shutdown();
        return false;
    }
    graphicsProfile_ = profile;
    return true;
}

bool SdlWindow::recreate(
    const WindowGraphicsProfile profile,
    const bool hidden
) noexcept {
    shutdown();
    return initialize(profile, hidden);
}

void SdlWindow::shutdown() noexcept {
    if (window_ != nullptr) {
        SDL_DestroyWindow(window_);
        window_ = nullptr;
    }
    graphicsProfile_ = WindowGraphicsProfile::neutral;
    metrics_ = {};
}

bool SdlWindow::refreshMetrics() noexcept {
    if (window_ == nullptr) {
        return false;
    }

    int windowWidth = 0;
    int windowHeight = 0;
    if (!SDL_GetWindowSize(window_, &windowWidth, &windowHeight)) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Window coordinate size query failed: %s",
            SDL_GetError()
        );
        return false;
    }

    int pixelWidth = 0;
    int pixelHeight = 0;
    if (!SDL_GetWindowSizeInPixels(window_, &pixelWidth, &pixelHeight)) {
        SDL_LogError(
            SDL_LOG_CATEGORY_APPLICATION,
            "Window pixel size query failed: %s",
            SDL_GetError()
        );
        return false;
    }

    SDL_Rect safeArea = {};
    if (!SDL_GetWindowSafeArea(window_, &safeArea)) {
        safeArea = {0, 0, windowWidth, windowHeight};
    }

    const float pixelDensity = SDL_GetWindowPixelDensity(window_);
    const float displayScale = SDL_GetWindowDisplayScale(window_);
    metrics_ = {
        windowWidth,
        windowHeight,
        pixelWidth,
        pixelHeight,
        safeArea.x,
        safeArea.y,
        safeArea.w,
        safeArea.h,
        std::isfinite(pixelDensity) && pixelDensity > 0.0F ? pixelDensity : 1.0F,
        std::isfinite(displayScale) && displayScale > 0.0F ? displayScale : 1.0F
    };
    return true;
}

bool SdlWindow::show() noexcept {
    if (window_ == nullptr || !SDL_ShowWindow(window_)) {
        SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "Window show failed: %s", SDL_GetError());
        return false;
    }
    return refreshMetrics();
}

SDL_Window* SdlWindow::nativeHandle() const noexcept {
    return window_;
}

std::uint32_t SdlWindow::id() const noexcept {
    return window_ != nullptr ? SDL_GetWindowID(window_) : 0;
}

bool SdlWindow::isFocused() const noexcept {
    return window_ != nullptr
        && (SDL_GetWindowFlags(window_) & SDL_WINDOW_INPUT_FOCUS) != 0;
}

bool SdlWindow::isVisible() const noexcept {
    if (window_ == nullptr) {
        return false;
    }
    const SDL_WindowFlags flags = SDL_GetWindowFlags(window_);
    return (flags & (SDL_WINDOW_HIDDEN | SDL_WINDOW_MINIMIZED)) == 0;
}

WindowGraphicsProfile SdlWindow::graphicsProfile() const noexcept {
    return graphicsProfile_;
}

const WindowMetrics& SdlWindow::metrics() const noexcept {
    return metrics_;
}

} // namespace cirvivor::platform::sdl
