#pragma once

#include <cstdint>

union SDL_Event;

namespace cirvivor::platform::sdl {

enum class PlatformEventKind : std::uint8_t {
    none,
    quitRequested,
    terminating,
    lowMemory,
    willEnterBackground,
    didEnterBackground,
    willEnterForeground,
    didEnterForeground,
    focusGained,
    focusLost,
    windowShown,
    windowHidden,
    windowExposed,
    windowMetricsChanged,
    renderTargetsReset,
    renderDeviceReset,
    renderDeviceLost,
    actionChanged
};

enum class PlatformAction : std::uint8_t {
    none,
    moveUp,
    moveDown,
    moveLeft,
    moveRight
};

struct PlatformEvent final {
    PlatformEventKind kind = PlatformEventKind::none;
    std::uint32_t windowId = 0;
    PlatformAction action = PlatformAction::none;
    bool pressed = false;
    std::uint32_t sourceMask = 0;
};

[[nodiscard]] PlatformEvent translateEvent(const SDL_Event& event) noexcept;

} // namespace cirvivor::platform::sdl
