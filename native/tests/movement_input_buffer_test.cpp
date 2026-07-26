#include "app/movement_input_buffer.h"

#include <array>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

using cirvivor::app::MovementInputBuffer;
using cirvivor::app::MovementInputChannel;

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

void testShortTapSurvivesUntilOneFixedStep() {
    MovementInputBuffer input;
    input.apply(MovementInputChannel::right, 0x40U, true);
    input.apply(MovementInputChannel::right, 0x40U, false);

    REQUIRE(input.consumeFixedStep().moveRight);
    REQUIRE(!input.consumeFixedStep().moveRight);
}

void testHeldInputRemainsActiveAcrossFixedSteps() {
    MovementInputBuffer input;
    input.apply(MovementInputChannel::down, 0x04U, true);

    REQUIRE(input.consumeFixedStep().moveDown);
    REQUIRE(input.consumeFixedStep().moveDown);

    input.apply(MovementInputChannel::down, 0x04U, false);
    REQUIRE(!input.consumeFixedStep().moveDown);
}

void testRepeatDoesNotCreateAReleasePulse() {
    MovementInputBuffer input;
    input.apply(MovementInputChannel::up, 0x01U, true);
    REQUIRE(input.consumeFixedStep().moveUp);

    input.apply(MovementInputChannel::up, 0x01U, true);
    input.apply(MovementInputChannel::up, 0x01U, false);
    REQUIRE(!input.consumeFixedStep().moveUp);
}

void testAliasSourcesComposeWithoutPrematureRelease() {
    MovementInputBuffer input;
    input.apply(MovementInputChannel::left, 0x10U, true);
    input.apply(MovementInputChannel::left, 0x20U, true);
    static_cast<void>(input.consumeFixedStep());

    input.apply(MovementInputChannel::left, 0x10U, false);
    REQUIRE(input.consumeFixedStep().moveLeft);

    input.apply(MovementInputChannel::left, 0x20U, false);
    REQUIRE(!input.consumeFixedStep().moveLeft);
}

void testClearDropsHeldAndPendingInput() {
    MovementInputBuffer input;
    input.apply(MovementInputChannel::right, 0x40U, true);
    input.apply(MovementInputChannel::right, 0x40U, false);
    input.apply(MovementInputChannel::up, 0x01U, true);

    input.clear();
    const auto actions = input.consumeFixedStep();
    REQUIRE(!actions.moveUp);
    REQUIRE(!actions.moveDown);
    REQUIRE(!actions.moveLeft);
    REQUIRE(!actions.moveRight);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"short tap latch", testShortTapSurvivesUntilOneFixedStep},
        TestCase{"held input", testHeldInputRemainsActiveAcrossFixedSteps},
        TestCase{"repeat idempotence", testRepeatDoesNotCreateAReleasePulse},
        TestCase{"alias composition", testAliasSourcesComposeWithoutPrematureRelease},
        TestCase{"clear input", testClearDropsHeldAndPendingInput}
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
