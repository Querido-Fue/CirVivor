#include "input/input_binding_map.h"

#include <array>
#include <cstddef>
#include <cstdlib>
#include <exception>
#include <initializer_list>
#include <iostream>
#include <new>
#include <stdexcept>
#include <string>
#include <string_view>

namespace allocation_probe {

thread_local bool enabled = false;
thread_local std::size_t count = 0U;

} // namespace allocation_probe

void* operator new(const std::size_t size) {
    if (allocation_probe::enabled) {
        ++allocation_probe::count;
    }
    if (void* const memory = std::malloc(size == 0U ? 1U : size)) {
        return memory;
    }
    throw std::bad_alloc();
}

void* operator new[](const std::size_t size) {
    return ::operator new(size);
}

void operator delete(void* const memory) noexcept {
    std::free(memory);
}

void operator delete[](void* const memory) noexcept {
    ::operator delete(memory);
}

void operator delete(void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

void operator delete[](void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

namespace {

using cirvivor::input::InputActionTransitionBatch;
using cirvivor::input::InputBindingMap;
using cirvivor::input::InputBindingReplaceStatus;
using cirvivor::settings::InputAction;
using cirvivor::settings::InputBindings;

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

void setOverride(
    InputBindings& bindings,
    const InputAction action,
    const std::initializer_list<std::string_view> codes
) {
    auto* const overrideValue = bindings.tryForAction(action);
    REQUIRE(overrideValue != nullptr);
    REQUIRE(codes.size() <= overrideValue->codes.size());
    overrideValue->present = true;
    overrideValue->count = static_cast<std::uint8_t>(codes.size());
    std::size_t index = 0U;
    for (const std::string_view code : codes) {
        REQUIRE(cirvivor::settings::tryMakeKeyboardCode(
            code,
            overrideValue->codes[index]
        ));
        ++index;
    }
}

[[nodiscard]] bool hasTransition(
    const InputActionTransitionBatch& batch,
    const InputAction action,
    const bool pressed
) noexcept {
    for (const auto& transition : batch) {
        if (transition.action == action && transition.pressed == pressed) {
            return true;
        }
    }
    return false;
}

void testDefaultsMatchJavaScriptContract() {
    InputBindingMap map;
    struct Expected final {
        InputAction action;
        std::array<std::string_view, 2U> codes;
        std::uint8_t count;
    };
    constexpr std::array expected{
        Expected{InputAction::moveUp, {"KeyW", "ArrowUp"}, 2U},
        Expected{InputAction::moveDown, {"KeyS", "ArrowDown"}, 2U},
        Expected{InputAction::moveLeft, {"KeyA", "ArrowLeft"}, 2U},
        Expected{InputAction::moveRight, {"KeyD", "ArrowRight"}, 2U},
        Expected{InputAction::primaryAction, {"Space", {}}, 1U},
        Expected{InputAction::pause, {"KeyP", {}}, 1U},
        Expected{InputAction::reload, {"KeyR", {}}, 1U},
        Expected{InputAction::debugPause, {"Slash", {}}, 1U},
        Expected{InputAction::debugStep, {"Period", {}}, 1U}
    };

    for (const Expected& item : expected) {
        REQUIRE(map.bindingCount(item.action) == item.count);
        for (std::size_t index = 0U; index < item.count; ++index) {
            REQUIRE(map.bindingCode(item.action, index) == item.codes[index]);
        }
    }
    REQUIRE(map.bindingCount(InputAction::count) == 0U);
    REQUIRE(map.bindingCode(InputAction::count, 0U).empty());
}

void testExplicitOverrideReplacesAndEmptyUnbinds() {
    InputBindingMap map;
    InputBindings overrides;
    setOverride(overrides, InputAction::moveRight, {"KeyL"});
    setOverride(overrides, InputAction::debugPause, {});
    REQUIRE(map.replace(overrides) == InputBindingReplaceStatus::replaced);
    REQUIRE(map.bindingCount(InputAction::moveRight) == 1U);
    REQUIRE(map.bindingCode(InputAction::moveRight, 0U) == "KeyL");
    REQUIRE(map.bindingCount(InputAction::debugPause) == 0U);
    REQUIRE(!map.apply("KeyD", true, false).matched);
    REQUIRE(hasTransition(
        map.apply("KeyL", true, false),
        InputAction::moveRight,
        true
    ));
    REQUIRE(!map.apply("Slash", true, false).matched);
}

void testAliasAggregationUsesFirstPressAndLastRelease() {
    InputBindingMap map;
    const auto firstPress = map.apply("KeyW", true, false);
    REQUIRE(firstPress.count == 1U);
    REQUIRE(hasTransition(firstPress, InputAction::moveUp, true));

    const auto aliasPress = map.apply("ArrowUp", true, false);
    REQUIRE(aliasPress.matched);
    REQUIRE(aliasPress.count == 0U);
    const auto firstRelease = map.apply("KeyW", false, false);
    REQUIRE(firstRelease.matched);
    REQUIRE(firstRelease.count == 0U);
    const auto lastRelease = map.apply("ArrowUp", false, false);
    REQUIRE(lastRelease.count == 1U);
    REQUIRE(hasTransition(lastRelease, InputAction::moveUp, false));
}

void testOneCodeMayDriveMultipleActions() {
    InputBindingMap map;
    InputBindings overrides;
    setOverride(overrides, InputAction::moveUp, {"KeyI"});
    setOverride(overrides, InputAction::primaryAction, {"KeyI"});
    REQUIRE(map.replace(overrides) == InputBindingReplaceStatus::replaced);

    const auto pressed = map.apply("KeyI", true, false);
    REQUIRE(pressed.count == 2U);
    REQUIRE(hasTransition(pressed, InputAction::moveUp, true));
    REQUIRE(hasTransition(pressed, InputAction::primaryAction, true));
    const auto released = map.apply("KeyI", false, false);
    REQUIRE(released.count == 2U);
    REQUIRE(hasTransition(released, InputAction::moveUp, false));
    REQUIRE(hasTransition(released, InputAction::primaryAction, false));
}

void testRepeatDuplicateAndUnmatchedReleaseAreIdempotent() {
    InputBindingMap map;
    REQUIRE(map.apply("KeyD", false, false).count == 0U);
    REQUIRE(map.apply("KeyD", true, false).count == 1U);
    const auto repeated = map.apply("KeyD", true, true);
    REQUIRE(repeated.matched);
    REQUIRE(repeated.count == 0U);
    REQUIRE(map.apply("KeyD", true, false).count == 0U);
    REQUIRE(map.apply("KeyD", false, false).count == 1U);
    REQUIRE(map.apply("KeyD", false, false).count == 0U);
}

void testInvalidReplacementIsAtomicAndPreservesHeldState() {
    InputBindingMap map;
    InputBindings overrides;
    setOverride(overrides, InputAction::moveRight, {"KeyL"});
    REQUIRE(map.replace(overrides) == InputBindingReplaceStatus::replaced);
    REQUIRE(map.apply("KeyL", true, false).count == 1U);

    InputBindings invalid = overrides;
    auto* invalidAction = invalid.tryForAction(InputAction::moveRight);
    REQUIRE(invalidAction != nullptr);
    invalidAction->codes[0U].bytes[0U] = '!';
    REQUIRE(map.replace(invalid) == InputBindingReplaceStatus::rejectedInvalid);
    invalid = overrides;
    invalidAction = invalid.tryForAction(InputAction::moveRight);
    REQUIRE(invalidAction != nullptr);
    invalidAction->codes[0U].size = static_cast<std::uint8_t>(
        cirvivor::settings::maximum_keyboard_code_bytes + 1U
    );
    REQUIRE(map.replace(invalid) == InputBindingReplaceStatus::rejectedInvalid);
    REQUIRE(map.bindingCode(InputAction::moveRight, 0U) == "KeyL");
    REQUIRE(map.apply("KeyL", false, false).count == 1U);
}

void testEquivalentReplacementDoesNotClearHeldState() {
    InputBindingMap map;
    REQUIRE(map.apply("KeyD", true, false).count == 1U);
    REQUIRE(map.replace({}) == InputBindingReplaceStatus::unchanged);
    REQUIRE(map.apply("KeyD", false, false).count == 1U);
}

void testClearAndHotPathDoNotAllocate() {
    InputBindingMap map;
    InputBindings overrides;
    setOverride(overrides, InputAction::reload, {
        "KeyR", "Digit1", "F12", "Numpad7"
    });
    REQUIRE(map.replace(overrides) == InputBindingReplaceStatus::replaced);
    REQUIRE(map.bindingCount(InputAction::reload) == 4U);

    allocation_probe::count = 0U;
    allocation_probe::enabled = true;
    for (std::size_t iteration = 0U; iteration < 1'000U; ++iteration) {
        static_cast<void>(map.apply("Numpad7", true, false));
        static_cast<void>(map.apply("Numpad7", true, true));
        static_cast<void>(map.apply("Numpad7", false, false));
    }
    const bool cleared = map.clearPressed();
    allocation_probe::enabled = false;
    REQUIRE(!cleared);
    REQUIRE(allocation_probe::count == 0U);

    REQUIRE(map.apply("KeyW", true, false).count == 1U);
    REQUIRE(map.clearPressed());
    REQUIRE(map.apply("KeyW", false, false).count == 0U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"JavaScript defaults", testDefaultsMatchJavaScriptContract},
        TestCase{"override and unbind", testExplicitOverrideReplacesAndEmptyUnbinds},
        TestCase{"alias aggregation", testAliasAggregationUsesFirstPressAndLastRelease},
        TestCase{"multi-action code", testOneCodeMayDriveMultipleActions},
        TestCase{"idempotent physical state", testRepeatDuplicateAndUnmatchedReleaseAreIdempotent},
        TestCase{"invalid replacement atomicity", testInvalidReplacementIsAtomicAndPreservesHeldState},
        TestCase{"equivalent replacement", testEquivalentReplacementDoesNotClearHeldState},
        TestCase{"clear and zero allocation", testClearAndHotPathDoNotAllocate}
    };

    std::size_t passed = 0U;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return EXIT_FAILURE;
        }
    }
    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return EXIT_SUCCESS;
}
