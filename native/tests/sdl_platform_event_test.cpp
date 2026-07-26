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

using cirvivor::platform::sdl::PlatformAction;
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
    const bool repeat = false
) noexcept {
    SDL_Event event{};
    event.type = type;
    event.key.windowID = windowId;
    event.key.scancode = scancode;
    event.key.down = type == SDL_EVENT_KEY_DOWN;
    event.key.repeat = repeat;
    return event;
}

void testMovementKeysTranslateToSemanticActions() {
    struct KeyCase final {
        SDL_Scancode scancode;
        PlatformAction action;
    };
    constexpr std::array cases{
        KeyCase{SDL_SCANCODE_W, PlatformAction::moveUp},
        KeyCase{SDL_SCANCODE_UP, PlatformAction::moveUp},
        KeyCase{SDL_SCANCODE_S, PlatformAction::moveDown},
        KeyCase{SDL_SCANCODE_DOWN, PlatformAction::moveDown},
        KeyCase{SDL_SCANCODE_A, PlatformAction::moveLeft},
        KeyCase{SDL_SCANCODE_LEFT, PlatformAction::moveLeft},
        KeyCase{SDL_SCANCODE_D, PlatformAction::moveRight},
        KeyCase{SDL_SCANCODE_RIGHT, PlatformAction::moveRight}
    };

    constexpr std::uint32_t windowId = 73;
    for (const KeyCase& testCase : cases) {
        const PlatformEvent pressed = translateEvent(
            keyEvent(SDL_EVENT_KEY_DOWN, testCase.scancode, windowId)
        );
        REQUIRE(pressed.kind == PlatformEventKind::actionChanged);
        REQUIRE(pressed.windowId == windowId);
        REQUIRE(pressed.action == testCase.action);
        REQUIRE(pressed.pressed);
        REQUIRE(std::has_single_bit(pressed.sourceMask));

        const PlatformEvent released = translateEvent(
            keyEvent(SDL_EVENT_KEY_UP, testCase.scancode, windowId)
        );
        REQUIRE(released.kind == PlatformEventKind::actionChanged);
        REQUIRE(released.windowId == windowId);
        REQUIRE(released.action == testCase.action);
        REQUIRE(!released.pressed);
        REQUIRE(released.sourceMask == pressed.sourceMask);
    }
}

void testAliasesUseDistinctSourcesForTheSameAction() {
    struct AliasCase final {
        SDL_Scancode first;
        SDL_Scancode second;
        PlatformAction action;
    };
    constexpr std::array aliases{
        AliasCase{SDL_SCANCODE_W, SDL_SCANCODE_UP, PlatformAction::moveUp},
        AliasCase{SDL_SCANCODE_S, SDL_SCANCODE_DOWN, PlatformAction::moveDown},
        AliasCase{SDL_SCANCODE_A, SDL_SCANCODE_LEFT, PlatformAction::moveLeft},
        AliasCase{SDL_SCANCODE_D, SDL_SCANCODE_RIGHT, PlatformAction::moveRight}
    };

    for (const AliasCase& alias : aliases) {
        const PlatformEvent first = translateEvent(
            keyEvent(SDL_EVENT_KEY_DOWN, alias.first, 1)
        );
        const PlatformEvent second = translateEvent(
            keyEvent(SDL_EVENT_KEY_DOWN, alias.second, 1)
        );
        REQUIRE(first.action == alias.action);
        REQUIRE(second.action == alias.action);
        REQUIRE(first.sourceMask != 0U);
        REQUIRE(second.sourceMask != 0U);
        REQUIRE(first.sourceMask != second.sourceMask);
        REQUIRE((first.sourceMask & second.sourceMask) == 0U);
    }
}

void testRepeatedKeyDownRemainsAnIdempotentStateEvent() {
    constexpr std::uint32_t windowId = 91;
    const PlatformEvent initial = translateEvent(
        keyEvent(SDL_EVENT_KEY_DOWN, SDL_SCANCODE_W, windowId)
    );
    const PlatformEvent event = translateEvent(
        keyEvent(SDL_EVENT_KEY_DOWN, SDL_SCANCODE_W, windowId, true)
    );
    REQUIRE(event.kind == PlatformEventKind::actionChanged);
    REQUIRE(event.windowId == windowId);
    REQUIRE(event.action == PlatformAction::moveUp);
    REQUIRE(event.pressed);
    REQUIRE(event.sourceMask == initial.sourceMask);
}

void testUnboundKeyboardInputIsIgnored() {
    const PlatformEvent event = translateEvent(
        keyEvent(SDL_EVENT_KEY_DOWN, SDL_SCANCODE_SPACE, 11)
    );
    REQUIRE(event.kind == PlatformEventKind::none);
    REQUIRE(event.windowId == 0U);
    REQUIRE(event.action == PlatformAction::none);
    REQUIRE(!event.pressed);
    REQUIRE(event.sourceMask == 0U);
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
    REQUIRE(close.action == PlatformAction::none);
    REQUIRE(!close.pressed);
    REQUIRE(close.sourceMask == 0U);

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
    REQUIRE(reset.action == PlatformAction::none);
    REQUIRE(!reset.pressed);
    REQUIRE(reset.sourceMask == 0U);

    SDL_Event orientationEvent{};
    orientationEvent.type = SDL_EVENT_DISPLAY_ORIENTATION;
    const PlatformEvent orientation = translateEvent(orientationEvent);
    REQUIRE(orientation.kind == PlatformEventKind::windowMetricsChanged);
    REQUIRE(orientation.windowId == 0U);
    REQUIRE(orientation.action == PlatformAction::none);
    REQUIRE(!orientation.pressed);
    REQUIRE(orientation.sourceMask == 0U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"movement key translation", testMovementKeysTranslateToSemanticActions},
        TestCase{"distinct alias sources", testAliasesUseDistinctSourcesForTheSameAction},
        TestCase{"repeat keydown state", testRepeatedKeyDownRemainsAnIdempotentStateEvent},
        TestCase{"unbound key filtering", testUnboundKeyboardInputIsIgnored},
        TestCase{"mouse motion payload", testMouseMotionUsesNeutralPointerPayload},
        TestCase{"mouse button payload", testMouseButtonsPreservePhasePositionAndClickCount},
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
