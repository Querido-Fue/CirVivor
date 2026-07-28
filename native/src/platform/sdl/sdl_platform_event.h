#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

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
    keyboardChanged,
    windowCloseRequested,
    pointerChanged,
    wheelChanged,
    textCommitted,
    textComposing
};

enum class PlatformPointerDevice : std::uint8_t {
    none,
    mouse,
    touch
};

enum class PlatformPointerPhase : std::uint8_t {
    none,
    moved,
    pressed,
    released,
    canceled
};

enum class PlatformPointerButton : std::uint8_t {
    none,
    primary,
    middle,
    secondary,
    auxiliary1,
    auxiliary2,
    other
};

[[nodiscard]] constexpr std::uint32_t platformPointerButtonMask(
    const PlatformPointerButton button
) noexcept {
    switch (button) {
    case PlatformPointerButton::primary:
        return 1U << 0U;
    case PlatformPointerButton::middle:
        return 1U << 1U;
    case PlatformPointerButton::secondary:
        return 1U << 2U;
    case PlatformPointerButton::auxiliary1:
        return 1U << 3U;
    case PlatformPointerButton::auxiliary2:
        return 1U << 4U;
    case PlatformPointerButton::none:
    case PlatformPointerButton::other:
    default:
        return 0U;
    }
}

struct PlatformPointerData final {
    PlatformPointerDevice device = PlatformPointerDevice::none;
    PlatformPointerPhase phase = PlatformPointerPhase::none;
    PlatformPointerButton button = PlatformPointerButton::none;
    std::uint8_t clickCount = 0;
    std::uint64_t deviceId = 0;
    std::uint64_t pointerId = 0;
    float x = 0.0F;
    float y = 0.0F;
    float deltaX = 0.0F;
    float deltaY = 0.0F;
    float pressure = 0.0F;
    std::uint32_t buttons = 0;
    bool coordinatesNormalized = false;
};

struct PlatformWheelData final {
    std::uint64_t pointerId = 0;
    float deltaX = 0.0F;
    float deltaY = 0.0F;
    float pointerX = 0.0F;
    float pointerY = 0.0F;
};

struct PlatformTextData final {
    static constexpr std::size_t storageCapacity = 256;

    std::array<char, storageCapacity> utf8{};
    std::uint16_t byteCount = 0;
    std::int32_t selectionStart = -1;
    std::int32_t selectionLength = -1;
    bool truncated = false;
    bool sourceValidUtf8 = true;

    [[nodiscard]] constexpr std::string_view view() const noexcept {
        return {utf8.data(), byteCount};
    }
};

struct PlatformKeyboardData final {
    static constexpr std::size_t storageCapacity = 64U;

    std::array<char, storageCapacity> code{};
    std::uint8_t byteCount = 0U;
    bool pressed = false;
    bool repeated = false;

    [[nodiscard]] constexpr std::string_view view() const noexcept {
        const std::size_t boundedSize = byteCount <= code.size()
            ? static_cast<std::size_t>(byteCount)
            : code.size();
        return {code.data(), boundedSize};
    }
};

struct PlatformEvent final {
    PlatformEventKind kind = PlatformEventKind::none;
    std::uint32_t windowId = 0;
    PlatformKeyboardData keyboard;
    PlatformPointerData pointer;
    PlatformWheelData wheel;
    PlatformTextData text;
    bool clearInputStateRequested = false;
    std::uint64_t timestampMilliseconds = 0U;
};

[[nodiscard]] PlatformEvent translateEvent(const SDL_Event& event) noexcept;

} // namespace cirvivor::platform::sdl
