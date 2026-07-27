#pragma once

#include <cstdint>

struct SDL_Window;

namespace cirvivor::platform::sdl {

enum class WindowGraphicsProfile : std::uint8_t {
    neutral = 0,
    gles3 = 1,
    gles2 = 2
};

struct WindowDisplayConfiguration final {
    bool fullscreen = false;
    int width = 1'280;
    int height = 720;

    constexpr bool operator==(
        const WindowDisplayConfiguration&
    ) const noexcept = default;
};

struct WindowMetrics final {
    int windowWidth = 0;
    int windowHeight = 0;
    int pixelWidth = 0;
    int pixelHeight = 0;
    // SDL safe area는 drawable pixel이 아니라 window coordinate 단위다.
    int safeAreaX = 0;
    int safeAreaY = 0;
    int safeAreaWidth = 0;
    int safeAreaHeight = 0;
    float pixelDensity = 1.0F;
    float displayScale = 1.0F;
};

class SdlWindow final {
public:
    SdlWindow() = default;
    ~SdlWindow();

    SdlWindow(const SdlWindow&) = delete;
    SdlWindow& operator=(const SdlWindow&) = delete;
    SdlWindow(SdlWindow&&) = delete;
    SdlWindow& operator=(SdlWindow&&) = delete;

    [[nodiscard]] bool initialize(
        WindowGraphicsProfile profile = WindowGraphicsProfile::neutral,
        bool hidden = false
    ) noexcept;
    [[nodiscard]] bool recreate(
        WindowGraphicsProfile profile,
        bool hidden = true
    ) noexcept;
    void shutdown() noexcept;

    [[nodiscard]] bool applyDisplayConfiguration(
        const WindowDisplayConfiguration& configuration
    ) noexcept;
    [[nodiscard]] bool refreshMetrics() noexcept;
    [[nodiscard]] bool show() noexcept;

    [[nodiscard]] SDL_Window* nativeHandle() const noexcept;
    [[nodiscard]] std::uint32_t id() const noexcept;
    [[nodiscard]] bool isFocused() const noexcept;
    [[nodiscard]] bool isVisible() const noexcept;
    [[nodiscard]] WindowGraphicsProfile graphicsProfile() const noexcept;
    [[nodiscard]] const WindowDisplayConfiguration& displayConfiguration()
        const noexcept;
    [[nodiscard]] const WindowMetrics& metrics() const noexcept;

private:
    void destroyNativeWindow() noexcept;

    SDL_Window* window_ = nullptr;
    WindowGraphicsProfile graphicsProfile_ = WindowGraphicsProfile::neutral;
    WindowDisplayConfiguration displayConfiguration_{};
    WindowMetrics metrics_;
};

} // namespace cirvivor::platform::sdl
