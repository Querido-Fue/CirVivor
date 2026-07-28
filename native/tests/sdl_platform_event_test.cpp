#include "platform/sdl/sdl_platform_event.h"

#include <SDL3/SDL_events.h>
#include <SDL3/SDL_scancode.h>

#include <array>
#include <bit>
#include <cstdint>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>

namespace {

using cirvivor::platform::sdl::PlatformEvent;
using cirvivor::platform::sdl::PlatformEventKind;
using cirvivor::platform::sdl::PlatformPointerButton;
using cirvivor::platform::sdl::PlatformPointerDevice;
using cirvivor::platform::sdl::PlatformPointerPhase;
using cirvivor::platform::sdl::PlatformTextData;
using cirvivor::platform::sdl::platformPointerButtonMask;
using cirvivor::platform::sdl::translateEvent;

static_assert(std::is_trivially_copyable_v<PlatformEvent>);
static_assert(PlatformTextData::storageCapacity == 256U);

class TestFailure final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void require(
    const bool condition,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!condition) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)

[[nodiscard]] SDL_Event keyEvent(
    const SDL_EventType type,
    const SDL_Scancode scancode,
    const std::uint32_t windowId,
    const bool repeat = false,
    const std::uint64_t timestampNanoseconds = 0U
) noexcept {
    SDL_Event event{};
    event.type = type;
    event.key.timestamp = timestampNanoseconds;
    event.key.windowID = windowId;
    event.key.scancode = scancode;
    event.key.down = type == SDL_EVENT_KEY_DOWN;
    event.key.repeat = repeat;
    return event;
}

void testKeyboardKeysTranslateToDomStyleRawCodes() {
    struct KeyCase final {
        SDL_Scancode scancode;
        std::string_view code;
    };
    constexpr std::array cases{
        KeyCase{SDL_SCANCODE_A, "KeyA"},
        KeyCase{SDL_SCANCODE_Z, "KeyZ"},
        KeyCase{SDL_SCANCODE_W, "KeyW"},
        KeyCase{SDL_SCANCODE_L, "KeyL"},
        KeyCase{SDL_SCANCODE_1, "Digit1"},
        KeyCase{SDL_SCANCODE_0, "Digit0"},
        KeyCase{SDL_SCANCODE_UP, "ArrowUp"},
        KeyCase{SDL_SCANCODE_SPACE, "Space"},
        KeyCase{SDL_SCANCODE_SLASH, "Slash"},
        KeyCase{SDL_SCANCODE_PERIOD, "Period"},
        KeyCase{SDL_SCANCODE_LEFTBRACKET, "BracketLeft"},
        KeyCase{SDL_SCANCODE_NONUSHASH, "Backslash"},
        KeyCase{SDL_SCANCODE_F1, "F1"},
        KeyCase{SDL_SCANCODE_F12, "F12"},
        KeyCase{SDL_SCANCODE_F13, "F13"},
        KeyCase{SDL_SCANCODE_F24, "F24"},
        KeyCase{SDL_SCANCODE_KP_1, "Numpad1"},
        KeyCase{SDL_SCANCODE_KP_0, "Numpad0"},
        KeyCase{SDL_SCANCODE_KP_7, "Numpad7"},
        KeyCase{SDL_SCANCODE_KP_EQUALSAS400, "NumpadEqual"},
        KeyCase{SDL_SCANCODE_KP_BACKSPACE, "NumpadBackspace"},
        KeyCase{SDL_SCANCODE_KP_CLEAR, "NumpadClear"},
        KeyCase{SDL_SCANCODE_KP_CLEARENTRY, "NumpadClearEntry"},
        KeyCase{SDL_SCANCODE_KP_HASH, "NumpadHash"},
        KeyCase{SDL_SCANCODE_KP_MEMADD, "NumpadMemoryAdd"},
        KeyCase{SDL_SCANCODE_KP_MEMSUBTRACT, "NumpadMemorySubtract"},
        KeyCase{SDL_SCANCODE_LCTRL, "ControlLeft"},
        KeyCase{SDL_SCANCODE_MEDIA_NEXT_TRACK, "MediaTrackNext"},
        KeyCase{SDL_SCANCODE_MEDIA_PLAY, "MediaPlayPause"},
        KeyCase{SDL_SCANCODE_MEDIA_PAUSE, "MediaPlayPause"},
        KeyCase{SDL_SCANCODE_MEDIA_SELECT, "MediaSelect"}
    };

    constexpr std::uint32_t windowId = 73;
    for (const KeyCase& testCase : cases) {
        const PlatformEvent pressed = translateEvent(
            keyEvent(SDL_EVENT_KEY_DOWN, testCase.scancode, windowId)
        );
        REQUIRE(pressed.kind == PlatformEventKind::keyboardChanged);
        REQUIRE(pressed.windowId == windowId);
        REQUIRE(pressed.keyboard.view() == testCase.code);
        REQUIRE(pressed.keyboard.pressed);
        REQUIRE(!pressed.keyboard.repeated);

        const PlatformEvent released = translateEvent(
            keyEvent(SDL_EVENT_KEY_UP, testCase.scancode, windowId)
        );
        REQUIRE(released.kind == PlatformEventKind::keyboardChanged);
        REQUIRE(released.windowId == windowId);
        REQUIRE(released.keyboard.view() == pressed.keyboard.view());
        REQUIRE(!released.keyboard.pressed);
        REQUIRE(!released.keyboard.repeated);
    }
}

void testPhysicalAliasesRemainDistinctAtPlatformBoundary() {
    const PlatformEvent keyW = translateEvent(
        keyEvent(SDL_EVENT_KEY_DOWN, SDL_SCANCODE_W, 1U)
    );
    const PlatformEvent arrowUp = translateEvent(
        keyEvent(SDL_EVENT_KEY_DOWN, SDL_SCANCODE_UP, 1U)
    );
    REQUIRE(keyW.kind == PlatformEventKind::keyboardChanged);
    REQUIRE(arrowUp.kind == PlatformEventKind::keyboardChanged);
    REQUIRE(keyW.keyboard.view() == "KeyW");
    REQUIRE(arrowUp.keyboard.view() == "ArrowUp");
    REQUIRE(keyW.keyboard.view() != arrowUp.keyboard.view());
}

void testRepeatedKeyDownRemainsAnIdempotentStateEvent() {
    constexpr std::uint32_t windowId = 91;
    const PlatformEvent initial = translateEvent(
        keyEvent(SDL_EVENT_KEY_DOWN, SDL_SCANCODE_W, windowId)
    );
    const PlatformEvent event = translateEvent(
        keyEvent(SDL_EVENT_KEY_DOWN, SDL_SCANCODE_W, windowId, true)
    );
    REQUIRE(event.kind == PlatformEventKind::keyboardChanged);
    REQUIRE(event.windowId == windowId);
    REQUIRE(event.keyboard.view() == "KeyW");
    REQUIRE(event.keyboard.pressed);
    REQUIRE(initial.keyboard.view() == event.keyboard.view());
    REQUIRE(!initial.keyboard.repeated);
    REQUIRE(event.keyboard.repeated);
}

void testDebugKeysPreserveEdgesRepeatAndTimestamp() {
    struct KeyCase final {
        SDL_Scancode scancode;
        std::string_view code;
    };
    constexpr std::array cases{
        KeyCase{SDL_SCANCODE_SLASH, "Slash"},
        KeyCase{SDL_SCANCODE_PERIOD, "Period"}
    };
    constexpr std::uint64_t pressTimestampNs = 9'876'543'210ULL;
    constexpr std::uint64_t repeatTimestampNs = 9'877'543'210ULL;
    constexpr std::uint64_t releaseTimestampNs = 9'878'543'210ULL;

    for (const KeyCase& testCase : cases) {
        const PlatformEvent pressed = translateEvent(keyEvent(
            SDL_EVENT_KEY_DOWN,
            testCase.scancode,
            92U,
            false,
            pressTimestampNs
        ));
        REQUIRE(pressed.kind == PlatformEventKind::keyboardChanged);
        REQUIRE(pressed.keyboard.view() == testCase.code);
        REQUIRE(pressed.keyboard.pressed);
        REQUIRE(!pressed.keyboard.repeated);
        REQUIRE(pressed.timestampMilliseconds == 9'876U);

        const PlatformEvent repeated = translateEvent(keyEvent(
            SDL_EVENT_KEY_DOWN,
            testCase.scancode,
            92U,
            true,
            repeatTimestampNs
        ));
        REQUIRE(repeated.keyboard.view() == testCase.code);
        REQUIRE(repeated.keyboard.pressed);
        REQUIRE(repeated.keyboard.repeated);
        REQUIRE(repeated.timestampMilliseconds == 9'877U);

        const PlatformEvent released = translateEvent(keyEvent(
            SDL_EVENT_KEY_UP,
            testCase.scancode,
            92U,
            false,
            releaseTimestampNs
        ));
        REQUIRE(released.keyboard.view() == testCase.code);
        REQUIRE(!released.keyboard.pressed);
        REQUIRE(!released.keyboard.repeated);
        REQUIRE(released.timestampMilliseconds == 9'878U);
    }
}

void testUnboundKeyboardInputIsIgnored() {
    constexpr std::array ignored{
        SDL_SCANCODE_UNKNOWN,
        SDL_SCANCODE_MEDIA_RECORD,
        SDL_SCANCODE_MEDIA_FAST_FORWARD,
        SDL_SCANCODE_MEDIA_REWIND
    };
    for (const SDL_Scancode scancode : ignored) {
        const PlatformEvent event = translateEvent(
            keyEvent(SDL_EVENT_KEY_DOWN, scancode, 11)
        );
        REQUIRE(event.kind == PlatformEventKind::none);
        REQUIRE(event.windowId == 0U);
        REQUIRE(event.keyboard.view().empty());
        REQUIRE(!event.keyboard.pressed);
    }
}

void testMouseMotionUsesNeutralPointerPayload() {
    SDL_Event source{};
    source.type = SDL_EVENT_MOUSE_MOTION;
    source.motion.windowID = 31;
    source.motion.which = 7;
    source.motion.state = SDL_BUTTON_LMASK | SDL_BUTTON_RMASK;
    source.motion.x = 123.5F;
    source.motion.y = 456.25F;
    source.motion.xrel = -3.0F;
    source.motion.yrel = 8.5F;

    const PlatformEvent event = translateEvent(source);
    REQUIRE(event.kind == PlatformEventKind::pointerChanged);
    REQUIRE(event.windowId == 31U);
    REQUIRE(event.pointer.device == PlatformPointerDevice::mouse);
    REQUIRE(event.pointer.phase == PlatformPointerPhase::moved);
    REQUIRE(event.pointer.button == PlatformPointerButton::none);
    REQUIRE(event.pointer.deviceId == 7U);
    REQUIRE(event.pointer.pointerId == 7U);
    REQUIRE(event.pointer.x == 123.5F);
    REQUIRE(event.pointer.y == 456.25F);
    REQUIRE(event.pointer.deltaX == -3.0F);
    REQUIRE(event.pointer.deltaY == 8.5F);
    REQUIRE(event.pointer.buttons == (
        platformPointerButtonMask(PlatformPointerButton::primary)
        | platformPointerButtonMask(PlatformPointerButton::secondary)
    ));
    REQUIRE(!event.pointer.coordinatesNormalized);
}

void testMouseButtonsPreservePhasePositionAndClickCount() {
    SDL_Event source{};
    source.type = SDL_EVENT_MOUSE_BUTTON_DOWN;
    source.button.windowID = 41;
    source.button.which = 9;
    source.button.button = SDL_BUTTON_X2;
    source.button.down = true;
    source.button.clicks = 2;
    source.button.x = 10.25F;
    source.button.y = 20.5F;

    const PlatformEvent pressed = translateEvent(source);
    REQUIRE(pressed.kind == PlatformEventKind::pointerChanged);
    REQUIRE(pressed.pointer.device == PlatformPointerDevice::mouse);
    REQUIRE(pressed.pointer.phase == PlatformPointerPhase::pressed);
    REQUIRE(pressed.pointer.button == PlatformPointerButton::auxiliary2);
    REQUIRE(pressed.pointer.clickCount == 2U);
    REQUIRE(pressed.pointer.pointerId == 9U);
    REQUIRE(pressed.pointer.x == 10.25F);
    REQUIRE(pressed.pointer.y == 20.5F);
    REQUIRE(pressed.pointer.buttons
        == platformPointerButtonMask(PlatformPointerButton::auxiliary2));

    source.type = SDL_EVENT_MOUSE_BUTTON_UP;
    source.button.down = false;
    const PlatformEvent released = translateEvent(source);
    REQUIRE(released.kind == PlatformEventKind::pointerChanged);
    REQUIRE(released.pointer.phase == PlatformPointerPhase::released);
    REQUIRE(released.pointer.button == PlatformPointerButton::auxiliary2);
    REQUIRE(released.pointer.buttons == 0U);
}

void testMiddleButtonPreservesMatchedPointerAndTimestamp() {
    SDL_Event source{};
    source.type = SDL_EVENT_MOUSE_BUTTON_DOWN;
    source.button.timestamp = 4'567'890'123ULL;
    source.button.windowID = 42U;
    source.button.which = 19U;
    source.button.button = SDL_BUTTON_MIDDLE;
    source.button.down = true;
    source.button.clicks = 1U;
    source.button.x = 30.0F;
    source.button.y = 40.0F;

    const PlatformEvent pressed = translateEvent(source);
    REQUIRE(pressed.kind == PlatformEventKind::pointerChanged);
    REQUIRE(pressed.pointer.device == PlatformPointerDevice::mouse);
    REQUIRE(pressed.pointer.phase == PlatformPointerPhase::pressed);
    REQUIRE(pressed.pointer.button == PlatformPointerButton::middle);
    REQUIRE(pressed.pointer.pointerId == 19U);
    REQUIRE(pressed.timestampMilliseconds == 4'567U);

    source.type = SDL_EVENT_MOUSE_BUTTON_UP;
    source.button.timestamp = 6'567'999'999ULL;
    source.button.down = false;
    const PlatformEvent released = translateEvent(source);
    REQUIRE(released.pointer.phase == PlatformPointerPhase::released);
    REQUIRE(released.pointer.button == PlatformPointerButton::middle);
    REQUIRE(released.pointer.pointerId == pressed.pointer.pointerId);
    REQUIRE(released.timestampMilliseconds == 6'567U);
}

void testWheelDeltasHaveBackendNeutralDirection() {
    SDL_Event source{};
    source.type = SDL_EVENT_MOUSE_WHEEL;
    source.wheel.windowID = 51;
    source.wheel.which = 12;
    source.wheel.x = 1.5F;
    source.wheel.y = -2.25F;
    source.wheel.mouse_x = 300.0F;
    source.wheel.mouse_y = 400.0F;
    source.wheel.direction = SDL_MOUSEWHEEL_NORMAL;

    const PlatformEvent normal = translateEvent(source);
    REQUIRE(normal.kind == PlatformEventKind::wheelChanged);
    REQUIRE(normal.windowId == 51U);
    REQUIRE(normal.wheel.pointerId == 12U);
    REQUIRE(normal.wheel.deltaX == 1.5F);
    REQUIRE(normal.wheel.deltaY == -2.25F);
    REQUIRE(normal.wheel.pointerX == 300.0F);
    REQUIRE(normal.wheel.pointerY == 400.0F);

    source.wheel.direction = SDL_MOUSEWHEEL_FLIPPED;
    const PlatformEvent flipped = translateEvent(source);
    REQUIRE(flipped.wheel.deltaX == -1.5F);
    REQUIRE(flipped.wheel.deltaY == 2.25F);
    REQUIRE(flipped.wheel.pointerX == normal.wheel.pointerX);
    REQUIRE(flipped.wheel.pointerY == normal.wheel.pointerY);
}

void testTouchEventsPreserveNormalizedCoordinatesAndPointerIdentity() {
    struct TouchCase final {
        SDL_EventType type;
        PlatformPointerPhase phase;
    };
    constexpr std::array cases{
        TouchCase{SDL_EVENT_FINGER_DOWN, PlatformPointerPhase::pressed},
        TouchCase{SDL_EVENT_FINGER_MOTION, PlatformPointerPhase::moved},
        TouchCase{SDL_EVENT_FINGER_UP, PlatformPointerPhase::released},
        TouchCase{SDL_EVENT_FINGER_CANCELED, PlatformPointerPhase::canceled}
    };

    for (const TouchCase& testCase : cases) {
        SDL_Event source{};
        source.type = testCase.type;
        source.tfinger.windowID = 61;
        source.tfinger.touchID = 0x0102'0304'0506'0708ULL;
        source.tfinger.fingerID = 0x8877'6655'4433'2211ULL;
        source.tfinger.x = 0.25F;
        source.tfinger.y = 0.75F;
        source.tfinger.dx = -0.125F;
        source.tfinger.dy = 0.0625F;
        source.tfinger.pressure = 0.5F;

        const PlatformEvent event = translateEvent(source);
        REQUIRE(event.kind == PlatformEventKind::pointerChanged);
        REQUIRE(event.windowId == 61U);
        REQUIRE(event.pointer.device == PlatformPointerDevice::touch);
        REQUIRE(event.pointer.phase == testCase.phase);
        REQUIRE(event.pointer.deviceId == 0x0102'0304'0506'0708ULL);
        REQUIRE(event.pointer.pointerId == 0x8877'6655'4433'2211ULL);
        REQUIRE(event.pointer.x == 0.25F);
        REQUIRE(event.pointer.y == 0.75F);
        REQUIRE(event.pointer.deltaX == -0.125F);
        REQUIRE(event.pointer.deltaY == 0.0625F);
        REQUIRE(event.pointer.pressure == 0.5F);
        REQUIRE(event.pointer.coordinatesNormalized);
        if (testCase.phase == PlatformPointerPhase::released
            || testCase.phase == PlatformPointerPhase::canceled) {
            REQUIRE(event.pointer.buttons == 0U);
        } else {
            REQUIRE(event.pointer.buttons
                == platformPointerButtonMask(PlatformPointerButton::primary));
        }
    }
}

void testTextInputAndCompositionUseFixedUtf8Storage() {
    constexpr char committedText[] =
        "Tower " "\xED\x95\x9C" " " "\xF0\x9F\x8F\xB0";
    SDL_Event inputSource{};
    inputSource.type = SDL_EVENT_TEXT_INPUT;
    inputSource.text.windowID = 71;
    inputSource.text.text = committedText;

    const PlatformEvent committed = translateEvent(inputSource);
    REQUIRE(committed.kind == PlatformEventKind::textCommitted);
    REQUIRE(committed.windowId == 71U);
    REQUIRE(committed.text.view() == committedText);
    REQUIRE(committed.text.byteCount == sizeof(committedText) - 1U);
    REQUIRE(committed.text.utf8[committed.text.byteCount] == '\0');
    REQUIRE(!committed.text.truncated);
    REQUIRE(committed.text.sourceValidUtf8);
    REQUIRE(committed.text.selectionStart == -1);
    REQUIRE(committed.text.selectionLength == -1);

    constexpr char composingText[] = "\xED\x95\x9C\xEA\xB8\x80";
    SDL_Event editingSource{};
    editingSource.type = SDL_EVENT_TEXT_EDITING;
    editingSource.edit.windowID = 72;
    editingSource.edit.text = composingText;
    editingSource.edit.start = 1;
    editingSource.edit.length = 1;

    const PlatformEvent composing = translateEvent(editingSource);
    REQUIRE(composing.kind == PlatformEventKind::textComposing);
    REQUIRE(composing.windowId == 72U);
    REQUIRE(composing.text.view() == composingText);
    REQUIRE(composing.text.selectionStart == 1);
    REQUIRE(composing.text.selectionLength == 1);
    REQUIRE(!composing.text.truncated);
    REQUIRE(composing.text.sourceValidUtf8);
}

void testTextTruncationNeverSplitsUtf8AndInvalidInputStopsAtValidPrefix() {
    std::string oversized(254, 'a');
    oversized.append("\xED\x95\x9C");
    SDL_Event oversizedSource{};
    oversizedSource.type = SDL_EVENT_TEXT_INPUT;
    oversizedSource.text.windowID = 81;
    oversizedSource.text.text = oversized.c_str();

    const PlatformEvent truncated = translateEvent(oversizedSource);
    REQUIRE(truncated.text.byteCount == 254U);
    REQUIRE(truncated.text.view() == std::string_view(oversized.data(), 254U));
    REQUIRE(truncated.text.utf8[254] == '\0');
    REQUIRE(truncated.text.truncated);
    REQUIRE(truncated.text.sourceValidUtf8);

    constexpr std::array invalidSource{'o', 'k', static_cast<char>(0xC0), '\0'};
    SDL_Event invalidEvent{};
    invalidEvent.type = SDL_EVENT_TEXT_INPUT;
    invalidEvent.text.windowID = 82;
    invalidEvent.text.text = invalidSource.data();

    const PlatformEvent invalid = translateEvent(invalidEvent);
    REQUIRE(invalid.text.view() == "ok");
    REQUIRE(invalid.text.byteCount == 2U);
    REQUIRE(!invalid.text.truncated);
    REQUIRE(!invalid.text.sourceValidUtf8);

    invalidEvent.text.text = nullptr;
    const PlatformEvent empty = translateEvent(invalidEvent);
    REQUIRE(empty.text.view().empty());
    REQUIRE(empty.text.sourceValidUtf8);
}

void testFocusLossExplicitlyRequestsInputStateClear() {
    SDL_Event source{};
    source.type = SDL_EVENT_WINDOW_FOCUS_LOST;
    source.window.windowID = 91;
    const PlatformEvent lost = translateEvent(source);
    REQUIRE(lost.kind == PlatformEventKind::focusLost);
    REQUIRE(lost.windowId == 91U);
    REQUIRE(lost.clearInputStateRequested);

    source.type = SDL_EVENT_WINDOW_FOCUS_GAINED;
    const PlatformEvent gained = translateEvent(source);
    REQUIRE(gained.kind == PlatformEventKind::focusGained);
    REQUIRE(!gained.clearInputStateRequested);
}

void testLifecycleAndRenderTranslationRemainStable() {
    SDL_Event closeEvent{};
    closeEvent.type = SDL_EVENT_WINDOW_CLOSE_REQUESTED;
    closeEvent.window.windowID = 17;
    const PlatformEvent close = translateEvent(closeEvent);
    REQUIRE(close.kind == PlatformEventKind::windowCloseRequested);
    REQUIRE(close.windowId == 17U);
    REQUIRE(close.keyboard.view().empty());
    REQUIRE(!close.keyboard.pressed);

    SDL_Event quitEvent{};
    quitEvent.type = SDL_EVENT_QUIT;
    const PlatformEvent quit = translateEvent(quitEvent);
    REQUIRE(quit.kind == PlatformEventKind::quitRequested);
    REQUIRE(quit.windowId == 0U);

    SDL_Event resetEvent{};
    resetEvent.type = SDL_EVENT_RENDER_DEVICE_LOST;
    resetEvent.render.windowID = 29;
    const PlatformEvent reset = translateEvent(resetEvent);
    REQUIRE(reset.kind == PlatformEventKind::renderDeviceLost);
    REQUIRE(reset.windowId == 29U);
    REQUIRE(reset.keyboard.view().empty());
    REQUIRE(!reset.keyboard.pressed);

    SDL_Event orientationEvent{};
    orientationEvent.type = SDL_EVENT_DISPLAY_ORIENTATION;
    const PlatformEvent orientation = translateEvent(orientationEvent);
    REQUIRE(orientation.kind == PlatformEventKind::windowMetricsChanged);
    REQUIRE(orientation.windowId == 0U);
    REQUIRE(orientation.keyboard.view().empty());
    REQUIRE(!orientation.keyboard.pressed);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"raw keyboard code translation", testKeyboardKeysTranslateToDomStyleRawCodes},
        TestCase{"raw physical aliases", testPhysicalAliasesRemainDistinctAtPlatformBoundary},
        TestCase{"repeat keydown state", testRepeatedKeyDownRemainsAnIdempotentStateEvent},
        TestCase{"debug key edges and timestamp", testDebugKeysPreserveEdgesRepeatAndTimestamp},
        TestCase{"unbound key filtering", testUnboundKeyboardInputIsIgnored},
        TestCase{"mouse motion payload", testMouseMotionUsesNeutralPointerPayload},
        TestCase{"mouse button payload", testMouseButtonsPreservePhasePositionAndClickCount},
        TestCase{"middle button timestamp", testMiddleButtonPreservesMatchedPointerAndTimestamp},
        TestCase{"wheel direction normalization", testWheelDeltasHaveBackendNeutralDirection},
        TestCase{"touch pointer payload", testTouchEventsPreserveNormalizedCoordinatesAndPointerIdentity},
        TestCase{"fixed UTF-8 text payload", testTextInputAndCompositionUseFixedUtf8Storage},
        TestCase{"UTF-8 truncation boundary", testTextTruncationNeverSplitsUtf8AndInvalidInputStopsAtValidPrefix},
        TestCase{"focus-loss input clear", testFocusLossExplicitlyRequestsInputStateClear},
        TestCase{"lifecycle and render regression", testLifecycleAndRenderTranslationRemainStable}
    };

    std::size_t passed = 0;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }

    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
