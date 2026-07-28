#include "platform/sdl/sdl_platform_event.h"

#include <SDL3/SDL_events.h>

#include <algorithm>
#include <array>
#include <string_view>

namespace cirvivor::platform::sdl {
namespace {

constexpr std::uint64_t nanoseconds_per_millisecond = 1'000'000U;

[[nodiscard]] constexpr std::string_view keyboardCode(
    const SDL_Scancode scancode
) noexcept {
    constexpr std::array letterCodes{
        std::string_view{"KeyA"}, std::string_view{"KeyB"},
        std::string_view{"KeyC"}, std::string_view{"KeyD"},
        std::string_view{"KeyE"}, std::string_view{"KeyF"},
        std::string_view{"KeyG"}, std::string_view{"KeyH"},
        std::string_view{"KeyI"}, std::string_view{"KeyJ"},
        std::string_view{"KeyK"}, std::string_view{"KeyL"},
        std::string_view{"KeyM"}, std::string_view{"KeyN"},
        std::string_view{"KeyO"}, std::string_view{"KeyP"},
        std::string_view{"KeyQ"}, std::string_view{"KeyR"},
        std::string_view{"KeyS"}, std::string_view{"KeyT"},
        std::string_view{"KeyU"}, std::string_view{"KeyV"},
        std::string_view{"KeyW"}, std::string_view{"KeyX"},
        std::string_view{"KeyY"}, std::string_view{"KeyZ"}
    };
    constexpr std::array digitCodes{
        std::string_view{"Digit1"}, std::string_view{"Digit2"},
        std::string_view{"Digit3"}, std::string_view{"Digit4"},
        std::string_view{"Digit5"}, std::string_view{"Digit6"},
        std::string_view{"Digit7"}, std::string_view{"Digit8"},
        std::string_view{"Digit9"}, std::string_view{"Digit0"}
    };
    constexpr std::array functionCodes1To12{
        std::string_view{"F1"}, std::string_view{"F2"},
        std::string_view{"F3"}, std::string_view{"F4"},
        std::string_view{"F5"}, std::string_view{"F6"},
        std::string_view{"F7"}, std::string_view{"F8"},
        std::string_view{"F9"}, std::string_view{"F10"},
        std::string_view{"F11"}, std::string_view{"F12"}
    };
    constexpr std::array functionCodes13To24{
        std::string_view{"F13"}, std::string_view{"F14"},
        std::string_view{"F15"}, std::string_view{"F16"},
        std::string_view{"F17"}, std::string_view{"F18"},
        std::string_view{"F19"}, std::string_view{"F20"},
        std::string_view{"F21"}, std::string_view{"F22"},
        std::string_view{"F23"}, std::string_view{"F24"}
    };
    constexpr std::array numpadDigitCodes{
        std::string_view{"Numpad1"}, std::string_view{"Numpad2"},
        std::string_view{"Numpad3"}, std::string_view{"Numpad4"},
        std::string_view{"Numpad5"}, std::string_view{"Numpad6"},
        std::string_view{"Numpad7"}, std::string_view{"Numpad8"},
        std::string_view{"Numpad9"}, std::string_view{"Numpad0"}
    };

    const int value = static_cast<int>(scancode);
    if (value >= static_cast<int>(SDL_SCANCODE_A)
        && value <= static_cast<int>(SDL_SCANCODE_Z)) {
        return letterCodes[static_cast<std::size_t>(
            value - static_cast<int>(SDL_SCANCODE_A)
        )];
    }
    if (value >= static_cast<int>(SDL_SCANCODE_1)
        && value <= static_cast<int>(SDL_SCANCODE_0)) {
        return digitCodes[static_cast<std::size_t>(
            value - static_cast<int>(SDL_SCANCODE_1)
        )];
    }
    if (value >= static_cast<int>(SDL_SCANCODE_F1)
        && value <= static_cast<int>(SDL_SCANCODE_F12)) {
        return functionCodes1To12[static_cast<std::size_t>(
            value - static_cast<int>(SDL_SCANCODE_F1)
        )];
    }
    if (value >= static_cast<int>(SDL_SCANCODE_F13)
        && value <= static_cast<int>(SDL_SCANCODE_F24)) {
        return functionCodes13To24[static_cast<std::size_t>(
            value - static_cast<int>(SDL_SCANCODE_F13)
        )];
    }
    if (value >= static_cast<int>(SDL_SCANCODE_KP_1)
        && value <= static_cast<int>(SDL_SCANCODE_KP_0)) {
        return numpadDigitCodes[static_cast<std::size_t>(
            value - static_cast<int>(SDL_SCANCODE_KP_1)
        )];
    }

    switch (scancode) {
    case SDL_SCANCODE_RETURN: return "Enter";
    case SDL_SCANCODE_ESCAPE: return "Escape";
    case SDL_SCANCODE_BACKSPACE: return "Backspace";
    case SDL_SCANCODE_TAB: return "Tab";
    case SDL_SCANCODE_SPACE: return "Space";
    case SDL_SCANCODE_MINUS: return "Minus";
    case SDL_SCANCODE_EQUALS: return "Equal";
    case SDL_SCANCODE_LEFTBRACKET: return "BracketLeft";
    case SDL_SCANCODE_RIGHTBRACKET: return "BracketRight";
    case SDL_SCANCODE_BACKSLASH: return "Backslash";
    // UI Events code uses Backslash for both the ANSI \\| key and the ISO #~
    // key because the two physical positions do not coexist on standard layouts.
    case SDL_SCANCODE_NONUSHASH: return "Backslash";
    case SDL_SCANCODE_SEMICOLON: return "Semicolon";
    case SDL_SCANCODE_APOSTROPHE: return "Quote";
    case SDL_SCANCODE_GRAVE: return "Backquote";
    case SDL_SCANCODE_COMMA: return "Comma";
    case SDL_SCANCODE_PERIOD: return "Period";
    case SDL_SCANCODE_SLASH: return "Slash";
    case SDL_SCANCODE_CAPSLOCK: return "CapsLock";
    case SDL_SCANCODE_PRINTSCREEN: return "PrintScreen";
    case SDL_SCANCODE_SCROLLLOCK: return "ScrollLock";
    case SDL_SCANCODE_PAUSE: return "Pause";
    case SDL_SCANCODE_INSERT: return "Insert";
    case SDL_SCANCODE_HOME: return "Home";
    case SDL_SCANCODE_PAGEUP: return "PageUp";
    case SDL_SCANCODE_DELETE: return "Delete";
    case SDL_SCANCODE_END: return "End";
    case SDL_SCANCODE_PAGEDOWN: return "PageDown";
    case SDL_SCANCODE_RIGHT: return "ArrowRight";
    case SDL_SCANCODE_LEFT: return "ArrowLeft";
    case SDL_SCANCODE_DOWN: return "ArrowDown";
    case SDL_SCANCODE_UP: return "ArrowUp";
    case SDL_SCANCODE_NUMLOCKCLEAR: return "NumLock";
    case SDL_SCANCODE_KP_DIVIDE: return "NumpadDivide";
    case SDL_SCANCODE_KP_MULTIPLY: return "NumpadMultiply";
    case SDL_SCANCODE_KP_MINUS: return "NumpadSubtract";
    case SDL_SCANCODE_KP_PLUS: return "NumpadAdd";
    case SDL_SCANCODE_KP_ENTER: return "NumpadEnter";
    case SDL_SCANCODE_KP_PERIOD: return "NumpadDecimal";
    case SDL_SCANCODE_NONUSBACKSLASH: return "IntlBackslash";
    case SDL_SCANCODE_APPLICATION: return "ContextMenu";
    case SDL_SCANCODE_POWER: return "Power";
    case SDL_SCANCODE_KP_EQUALS: return "NumpadEqual";
    case SDL_SCANCODE_HELP: return "Help";
    case SDL_SCANCODE_SELECT: return "Select";
    case SDL_SCANCODE_MENU: return "ContextMenu";
    case SDL_SCANCODE_STOP: return "BrowserStop";
    case SDL_SCANCODE_AGAIN: return "Again";
    case SDL_SCANCODE_UNDO: return "Undo";
    case SDL_SCANCODE_CUT: return "Cut";
    case SDL_SCANCODE_COPY: return "Copy";
    case SDL_SCANCODE_PASTE: return "Paste";
    case SDL_SCANCODE_FIND: return "Find";
    case SDL_SCANCODE_MUTE: return "AudioVolumeMute";
    case SDL_SCANCODE_VOLUMEUP: return "AudioVolumeUp";
    case SDL_SCANCODE_VOLUMEDOWN: return "AudioVolumeDown";
    case SDL_SCANCODE_KP_COMMA: return "NumpadComma";
    case SDL_SCANCODE_KP_EQUALSAS400: return "NumpadEqual";
    case SDL_SCANCODE_INTERNATIONAL1: return "IntlRo";
    case SDL_SCANCODE_INTERNATIONAL2: return "KanaMode";
    case SDL_SCANCODE_INTERNATIONAL3: return "IntlYen";
    case SDL_SCANCODE_INTERNATIONAL4: return "Convert";
    case SDL_SCANCODE_INTERNATIONAL5: return "NonConvert";
    case SDL_SCANCODE_LANG1: return "Lang1";
    case SDL_SCANCODE_LANG2: return "Lang2";
    case SDL_SCANCODE_LANG3: return "Lang3";
    case SDL_SCANCODE_LANG4: return "Lang4";
    case SDL_SCANCODE_LANG5: return "Lang5";
    case SDL_SCANCODE_KP_LEFTPAREN: return "NumpadParenLeft";
    case SDL_SCANCODE_KP_RIGHTPAREN: return "NumpadParenRight";
    case SDL_SCANCODE_KP_BACKSPACE: return "NumpadBackspace";
    case SDL_SCANCODE_KP_HASH: return "NumpadHash";
    case SDL_SCANCODE_KP_MEMSTORE: return "NumpadMemoryStore";
    case SDL_SCANCODE_KP_MEMRECALL: return "NumpadMemoryRecall";
    case SDL_SCANCODE_KP_MEMCLEAR: return "NumpadMemoryClear";
    case SDL_SCANCODE_KP_MEMADD: return "NumpadMemoryAdd";
    case SDL_SCANCODE_KP_MEMSUBTRACT: return "NumpadMemorySubtract";
    case SDL_SCANCODE_KP_MEMMULTIPLY: return "NumpadMemoryMultiply";
    case SDL_SCANCODE_KP_MEMDIVIDE: return "NumpadMemoryDivide";
    case SDL_SCANCODE_KP_PLUSMINUS: return "NumpadSignChange";
    case SDL_SCANCODE_KP_CLEAR: return "NumpadClear";
    case SDL_SCANCODE_KP_CLEARENTRY: return "NumpadClearEntry";
    case SDL_SCANCODE_LCTRL: return "ControlLeft";
    case SDL_SCANCODE_LSHIFT: return "ShiftLeft";
    case SDL_SCANCODE_LALT: return "AltLeft";
    case SDL_SCANCODE_LGUI: return "MetaLeft";
    case SDL_SCANCODE_RCTRL: return "ControlRight";
    case SDL_SCANCODE_RSHIFT: return "ShiftRight";
    case SDL_SCANCODE_RALT: return "AltRight";
    case SDL_SCANCODE_RGUI: return "MetaRight";
    case SDL_SCANCODE_SLEEP: return "Sleep";
    case SDL_SCANCODE_WAKE: return "WakeUp";
    // UI Events code has one physical media toggle identifier. Dedicated
    // record/seek controls only have KeyboardEvent.key names, so they remain
    // unidentified at this DOM-style code boundary.
    case SDL_SCANCODE_MEDIA_PLAY:
    case SDL_SCANCODE_MEDIA_PAUSE:
        return "MediaPlayPause";
    case SDL_SCANCODE_MEDIA_NEXT_TRACK: return "MediaTrackNext";
    case SDL_SCANCODE_MEDIA_PREVIOUS_TRACK: return "MediaTrackPrevious";
    case SDL_SCANCODE_MEDIA_STOP: return "MediaStop";
    case SDL_SCANCODE_MEDIA_EJECT: return "Eject";
    case SDL_SCANCODE_MEDIA_PLAY_PAUSE: return "MediaPlayPause";
    case SDL_SCANCODE_MEDIA_SELECT: return "MediaSelect";
    case SDL_SCANCODE_AC_SEARCH: return "BrowserSearch";
    case SDL_SCANCODE_AC_HOME: return "BrowserHome";
    case SDL_SCANCODE_AC_BACK: return "BrowserBack";
    case SDL_SCANCODE_AC_FORWARD: return "BrowserForward";
    case SDL_SCANCODE_AC_STOP: return "BrowserStop";
    case SDL_SCANCODE_AC_REFRESH: return "BrowserRefresh";
    case SDL_SCANCODE_AC_BOOKMARKS: return "BrowserFavorites";
    default:
        return std::string_view{};
    }
}

[[nodiscard]] bool copyKeyboardCode(
    PlatformKeyboardData& destination,
    const std::string_view source
) noexcept {
    if (source.empty() || source.size() > destination.code.size()) {
        return false;
    }
    std::copy(source.begin(), source.end(), destination.code.begin());
    destination.byteCount = static_cast<std::uint8_t>(source.size());
    return true;
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
        const std::string_view code = keyboardCode(event.key.scancode);
        if (code.empty()) {
            return {};
        }
        PlatformEvent translated = makePlatformEvent(
            PlatformEventKind::keyboardChanged,
            event.key.windowID,
            event
        );
        if (!copyKeyboardCode(translated.keyboard, code)) {
            return {};
        }
        translated.keyboard.pressed = event.type == SDL_EVENT_KEY_DOWN;
        translated.keyboard.repeated = event.key.repeat;
        return translated;
    }
    default:
        return {};
    }
}

} // namespace cirvivor::platform::sdl
