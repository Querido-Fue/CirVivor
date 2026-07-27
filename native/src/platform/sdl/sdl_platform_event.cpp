#include "platform/sdl/sdl_platform_event.h"

#include <SDL3/SDL_events.h>

namespace cirvivor::platform::sdl {
namespace {

constexpr std::uint64_t nanoseconds_per_millisecond = 1'000'000U;

struct ActionBinding final {
    PlatformAction action = PlatformAction::none;
    std::uint32_t sourceMask = 0;
};

[[nodiscard]] constexpr ActionBinding actionBinding(
    const SDL_Scancode scancode
) noexcept {
    switch (scancode) {
    case SDL_SCANCODE_W:
        return {PlatformAction::moveUp, 1U << 0U};
    case SDL_SCANCODE_UP:
        return {PlatformAction::moveUp, 1U << 1U};
    case SDL_SCANCODE_S:
        return {PlatformAction::moveDown, 1U << 2U};
    case SDL_SCANCODE_DOWN:
        return {PlatformAction::moveDown, 1U << 3U};
    case SDL_SCANCODE_A:
        return {PlatformAction::moveLeft, 1U << 4U};
    case SDL_SCANCODE_LEFT:
        return {PlatformAction::moveLeft, 1U << 5U};
    case SDL_SCANCODE_D:
        return {PlatformAction::moveRight, 1U << 6U};
    case SDL_SCANCODE_RIGHT:
        return {PlatformAction::moveRight, 1U << 7U};
    case SDL_SCANCODE_SLASH:
        return {PlatformAction::debugPause, 1U << 8U};
    case SDL_SCANCODE_PERIOD:
        return {PlatformAction::debugStep, 1U << 9U};
    default:
        return {};
    }
}

[[nodiscard]] constexpr std::uint64_t eventTimestampMilliseconds(
    const SDL_Event& event
) noexcept {
    return event.common.timestamp / nanoseconds_per_millisecond;
}

[[nodiscard]] constexpr PlatformEvent makePlatformEvent(
    const PlatformEventKind kind,
    const std::uint32_t windowId,
    const SDL_Event& event
) noexcept {
    PlatformEvent translated;
    translated.kind = kind;
    translated.windowId = windowId;
    translated.timestampMilliseconds = eventTimestampMilliseconds(event);
    return translated;
}

[[nodiscard]] constexpr PlatformPointerButton pointerButton(
    const std::uint8_t button
) noexcept {
    switch (button) {
    case SDL_BUTTON_LEFT:
        return PlatformPointerButton::primary;
    case SDL_BUTTON_MIDDLE:
        return PlatformPointerButton::middle;
    case SDL_BUTTON_RIGHT:
        return PlatformPointerButton::secondary;
    case SDL_BUTTON_X1:
        return PlatformPointerButton::auxiliary1;
    case SDL_BUTTON_X2:
        return PlatformPointerButton::auxiliary2;
    default:
        return PlatformPointerButton::other;
    }
}

[[nodiscard]] constexpr std::uint32_t pointerButtonState(
    const SDL_MouseButtonFlags state
) noexcept {
    std::uint32_t translated = 0;
    if ((state & SDL_BUTTON_LMASK) != 0U) {
        translated |= platformPointerButtonMask(PlatformPointerButton::primary);
    }
    if ((state & SDL_BUTTON_MMASK) != 0U) {
        translated |= platformPointerButtonMask(PlatformPointerButton::middle);
    }
    if ((state & SDL_BUTTON_RMASK) != 0U) {
        translated |= platformPointerButtonMask(PlatformPointerButton::secondary);
    }
    if ((state & SDL_BUTTON_X1MASK) != 0U) {
        translated |= platformPointerButtonMask(PlatformPointerButton::auxiliary1);
    }
    if ((state & SDL_BUTTON_X2MASK) != 0U) {
        translated |= platformPointerButtonMask(PlatformPointerButton::auxiliary2);
    }
    return translated;
}

[[nodiscard]] constexpr bool isUtf8Continuation(const char value) noexcept {
    const auto byte = static_cast<unsigned char>(value);
    return byte >= 0x80U && byte <= 0xBFU;
}

[[nodiscard]] constexpr std::size_t validUtf8SequenceLength(
    const char* const text
) noexcept {
    const auto first = static_cast<unsigned char>(text[0]);
    if (first <= 0x7FU) {
        return 1;
    }
    if (first >= 0xC2U && first <= 0xDFU) {
        return isUtf8Continuation(text[1]) ? 2U : 0U;
    }
    if (first == 0xE0U) {
        const auto second = static_cast<unsigned char>(text[1]);
        return second >= 0xA0U && second <= 0xBFU
                && isUtf8Continuation(text[2])
            ? 3U
            : 0U;
    }
    if ((first >= 0xE1U && first <= 0xECU)
        || (first >= 0xEEU && first <= 0xEFU)) {
        return isUtf8Continuation(text[1]) && isUtf8Continuation(text[2])
            ? 3U
            : 0U;
    }
    if (first == 0xEDU) {
        const auto second = static_cast<unsigned char>(text[1]);
        return second >= 0x80U && second <= 0x9FU
                && isUtf8Continuation(text[2])
            ? 3U
            : 0U;
    }
    if (first == 0xF0U) {
        const auto second = static_cast<unsigned char>(text[1]);
        return second >= 0x90U && second <= 0xBFU
                && isUtf8Continuation(text[2])
                && isUtf8Continuation(text[3])
            ? 4U
            : 0U;
    }
    if (first >= 0xF1U && first <= 0xF3U) {
        return isUtf8Continuation(text[1])
                && isUtf8Continuation(text[2])
                && isUtf8Continuation(text[3])
            ? 4U
            : 0U;
    }
    if (first == 0xF4U) {
        const auto second = static_cast<unsigned char>(text[1]);
        return second >= 0x80U && second <= 0x8FU
                && isUtf8Continuation(text[2])
                && isUtf8Continuation(text[3])
            ? 4U
            : 0U;
    }
    return 0;
}

[[nodiscard]] PlatformTextData copyUtf8Text(
    const char* const source,
    const std::int32_t selectionStart = -1,
    const std::int32_t selectionLength = -1
) noexcept {
    PlatformTextData translated;
    translated.selectionStart = selectionStart;
    translated.selectionLength = selectionLength;
    if (source == nullptr) {
        return translated;
    }

    std::size_t inputBytes = 0;
    std::size_t outputBytes = 0;
    while (source[inputBytes] != '\0') {
        const std::size_t sequenceBytes = validUtf8SequenceLength(source + inputBytes);
        if (sequenceBytes == 0U) {
            translated.sourceValidUtf8 = false;
            break;
        }
        if (outputBytes + sequenceBytes >= PlatformTextData::storageCapacity) {
            translated.truncated = true;
            break;
        }
        for (std::size_t offset = 0; offset < sequenceBytes; ++offset) {
            translated.utf8[outputBytes + offset] = source[inputBytes + offset];
        }
        inputBytes += sequenceBytes;
        outputBytes += sequenceBytes;
    }
    translated.utf8[outputBytes] = '\0';
    translated.byteCount = static_cast<std::uint16_t>(outputBytes);
    return translated;
}

} // namespace

PlatformEvent translateEvent(const SDL_Event& event) noexcept {
    switch (event.type) {
    case SDL_EVENT_QUIT:
        return makePlatformEvent(PlatformEventKind::quitRequested, 0U, event);
    case SDL_EVENT_TERMINATING:
        return makePlatformEvent(PlatformEventKind::terminating, 0U, event);
    case SDL_EVENT_LOW_MEMORY:
        return makePlatformEvent(PlatformEventKind::lowMemory, 0U, event);
    case SDL_EVENT_WILL_ENTER_BACKGROUND:
        return makePlatformEvent(
            PlatformEventKind::willEnterBackground,
            0U,
            event
        );
    case SDL_EVENT_DID_ENTER_BACKGROUND:
        return makePlatformEvent(
            PlatformEventKind::didEnterBackground,
            0U,
            event
        );
    case SDL_EVENT_WILL_ENTER_FOREGROUND:
        return makePlatformEvent(
            PlatformEventKind::willEnterForeground,
            0U,
            event
        );
    case SDL_EVENT_DID_ENTER_FOREGROUND:
        return makePlatformEvent(
            PlatformEventKind::didEnterForeground,
            0U,
            event
        );
    case SDL_EVENT_WINDOW_CLOSE_REQUESTED:
        return makePlatformEvent(
            PlatformEventKind::windowCloseRequested,
            event.window.windowID,
            event
        );
    case SDL_EVENT_WINDOW_FOCUS_GAINED:
        return makePlatformEvent(
            PlatformEventKind::focusGained,
            event.window.windowID,
            event
        );
    case SDL_EVENT_WINDOW_FOCUS_LOST: {
        PlatformEvent translated = makePlatformEvent(
            PlatformEventKind::focusLost,
            event.window.windowID,
            event
        );
        translated.clearInputStateRequested = true;
        return translated;
    }
    case SDL_EVENT_WINDOW_SHOWN:
    case SDL_EVENT_WINDOW_RESTORED:
        return makePlatformEvent(
            PlatformEventKind::windowShown,
            event.window.windowID,
            event
        );
    case SDL_EVENT_WINDOW_HIDDEN:
    case SDL_EVENT_WINDOW_MINIMIZED:
        return makePlatformEvent(
            PlatformEventKind::windowHidden,
            event.window.windowID,
            event
        );
    case SDL_EVENT_WINDOW_EXPOSED:
        return makePlatformEvent(
            PlatformEventKind::windowExposed,
            event.window.windowID,
            event
        );
    case SDL_EVENT_WINDOW_RESIZED:
    case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
    case SDL_EVENT_WINDOW_DISPLAY_CHANGED:
    case SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED:
    case SDL_EVENT_WINDOW_SAFE_AREA_CHANGED:
        return makePlatformEvent(
            PlatformEventKind::windowMetricsChanged,
            event.window.windowID,
            event
        );
    case SDL_EVENT_DISPLAY_ORIENTATION:
    case SDL_EVENT_DISPLAY_CONTENT_SCALE_CHANGED:
    case SDL_EVENT_DISPLAY_USABLE_BOUNDS_CHANGED:
        return makePlatformEvent(
            PlatformEventKind::windowMetricsChanged,
            0U,
            event
        );
    case SDL_EVENT_RENDER_TARGETS_RESET:
        return makePlatformEvent(
            PlatformEventKind::renderTargetsReset,
            event.render.windowID,
            event
        );
    case SDL_EVENT_RENDER_DEVICE_RESET:
        return makePlatformEvent(
            PlatformEventKind::renderDeviceReset,
            event.render.windowID,
            event
        );
    case SDL_EVENT_RENDER_DEVICE_LOST:
        return makePlatformEvent(
            PlatformEventKind::renderDeviceLost,
            event.render.windowID,
            event
        );
    case SDL_EVENT_MOUSE_MOTION: {
        PlatformEvent translated;
        translated.kind = PlatformEventKind::pointerChanged;
        translated.windowId = event.motion.windowID;
        translated.pointer.device = PlatformPointerDevice::mouse;
        translated.pointer.phase = PlatformPointerPhase::moved;
        translated.pointer.deviceId = static_cast<std::uint64_t>(event.motion.which);
        translated.pointer.pointerId = static_cast<std::uint64_t>(event.motion.which);
        translated.pointer.x = event.motion.x;
        translated.pointer.y = event.motion.y;
        translated.pointer.deltaX = event.motion.xrel;
        translated.pointer.deltaY = event.motion.yrel;
        translated.pointer.buttons = pointerButtonState(event.motion.state);
        translated.timestampMilliseconds = eventTimestampMilliseconds(event);
        return translated;
    }
    case SDL_EVENT_MOUSE_BUTTON_DOWN:
    case SDL_EVENT_MOUSE_BUTTON_UP: {
        PlatformEvent translated;
        translated.kind = PlatformEventKind::pointerChanged;
        translated.windowId = event.button.windowID;
        translated.pointer.device = PlatformPointerDevice::mouse;
        translated.pointer.phase = event.type == SDL_EVENT_MOUSE_BUTTON_DOWN
            ? PlatformPointerPhase::pressed
            : PlatformPointerPhase::released;
        translated.pointer.button = pointerButton(event.button.button);
        translated.pointer.clickCount = event.button.clicks;
        translated.pointer.deviceId = static_cast<std::uint64_t>(event.button.which);
        translated.pointer.pointerId = static_cast<std::uint64_t>(event.button.which);
        translated.pointer.x = event.button.x;
        translated.pointer.y = event.button.y;
        if (translated.pointer.phase == PlatformPointerPhase::pressed) {
            translated.pointer.buttons = platformPointerButtonMask(
                translated.pointer.button
            );
        }
        translated.timestampMilliseconds = eventTimestampMilliseconds(event);
        return translated;
    }
    case SDL_EVENT_MOUSE_WHEEL: {
        PlatformEvent translated;
        translated.kind = PlatformEventKind::wheelChanged;
        translated.windowId = event.wheel.windowID;
        translated.wheel.pointerId = static_cast<std::uint64_t>(event.wheel.which);
        const float direction = event.wheel.direction == SDL_MOUSEWHEEL_FLIPPED
            ? -1.0F
            : 1.0F;
        translated.wheel.deltaX = event.wheel.x * direction;
        translated.wheel.deltaY = event.wheel.y * direction;
        translated.wheel.pointerX = event.wheel.mouse_x;
        translated.wheel.pointerY = event.wheel.mouse_y;
        translated.timestampMilliseconds = eventTimestampMilliseconds(event);
        return translated;
    }
    case SDL_EVENT_FINGER_DOWN:
    case SDL_EVENT_FINGER_MOTION:
    case SDL_EVENT_FINGER_UP:
    case SDL_EVENT_FINGER_CANCELED: {
        PlatformEvent translated;
        translated.kind = PlatformEventKind::pointerChanged;
        translated.windowId = event.tfinger.windowID;
        translated.pointer.device = PlatformPointerDevice::touch;
        if (event.type == SDL_EVENT_FINGER_DOWN) {
            translated.pointer.phase = PlatformPointerPhase::pressed;
            translated.pointer.button = PlatformPointerButton::primary;
        } else if (event.type == SDL_EVENT_FINGER_UP) {
            translated.pointer.phase = PlatformPointerPhase::released;
            translated.pointer.button = PlatformPointerButton::primary;
        } else if (event.type == SDL_EVENT_FINGER_CANCELED) {
            translated.pointer.phase = PlatformPointerPhase::canceled;
            translated.pointer.button = PlatformPointerButton::primary;
        } else {
            translated.pointer.phase = PlatformPointerPhase::moved;
        }
        translated.pointer.deviceId = static_cast<std::uint64_t>(event.tfinger.touchID);
        translated.pointer.pointerId = static_cast<std::uint64_t>(event.tfinger.fingerID);
        translated.pointer.x = event.tfinger.x;
        translated.pointer.y = event.tfinger.y;
        translated.pointer.deltaX = event.tfinger.dx;
        translated.pointer.deltaY = event.tfinger.dy;
        translated.pointer.pressure = event.tfinger.pressure;
        translated.pointer.coordinatesNormalized = true;
        if (translated.pointer.phase != PlatformPointerPhase::released
            && translated.pointer.phase != PlatformPointerPhase::canceled) {
            translated.pointer.buttons = platformPointerButtonMask(
                PlatformPointerButton::primary
            );
        }
        translated.timestampMilliseconds = eventTimestampMilliseconds(event);
        return translated;
    }
    case SDL_EVENT_TEXT_INPUT: {
        PlatformEvent translated;
        translated.kind = PlatformEventKind::textCommitted;
        translated.windowId = event.text.windowID;
        translated.text = copyUtf8Text(event.text.text);
        translated.timestampMilliseconds = eventTimestampMilliseconds(event);
        return translated;
    }
    case SDL_EVENT_TEXT_EDITING: {
        PlatformEvent translated;
        translated.kind = PlatformEventKind::textComposing;
        translated.windowId = event.edit.windowID;
        translated.text = copyUtf8Text(
            event.edit.text,
            event.edit.start,
            event.edit.length
        );
        translated.timestampMilliseconds = eventTimestampMilliseconds(event);
        return translated;
    }
    case SDL_EVENT_KEY_DOWN:
    case SDL_EVENT_KEY_UP: {
        const ActionBinding binding = actionBinding(event.key.scancode);
        if (binding.action == PlatformAction::none) {
            return {};
        }
        PlatformEvent translated = makePlatformEvent(
            PlatformEventKind::actionChanged,
            event.key.windowID,
            event
        );
        translated.action = binding.action;
        translated.pressed = event.type == SDL_EVENT_KEY_DOWN;
        translated.sourceMask = binding.sourceMask;
        translated.repeated = event.key.repeat;
        return translated;
    }
    default:
        return {};
    }
}

} // namespace cirvivor::platform::sdl
