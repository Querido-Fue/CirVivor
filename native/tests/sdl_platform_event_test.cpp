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

namespace {

using cirvivor::platform::sdl::PlatformAction;
using cirvivor::platform::sdl::PlatformEvent;
using cirvivor::platform::sdl::PlatformEventKind;
using cirvivor::platform::sdl::translateEvent;

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

void testLifecycleAndRenderTranslationRemainStable() {
    SDL_Event closeEvent{};
    closeEvent.type = SDL_EVENT_WINDOW_CLOSE_REQUESTED;
    closeEvent.window.windowID = 17;
    const PlatformEvent close = translateEvent(closeEvent);
    REQUIRE(close.kind == PlatformEventKind::quitRequested);
    REQUIRE(close.windowId == 17U);
    REQUIRE(close.action == PlatformAction::none);
    REQUIRE(!close.pressed);
    REQUIRE(close.sourceMask == 0U);

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
