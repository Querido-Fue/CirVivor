#include "app/logical_ui_projection.h"

#include <array>
#include <cmath>
#include <exception>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

using cirvivor::app::LogicalUiProjection;
using cirvivor::app::LogicalUiProjectionPoint;
using cirvivor::app::tryProjectWindowPointToLogicalUi;

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

void requireNear(
    const double actual,
    const double expected,
    const double tolerance,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!std::isfinite(actual)
        || std::abs(actual - expected) > tolerance) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
            + " (actual=" + std::to_string(actual)
            + ", expected=" + std::to_string(expected) + ')'
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)
#define REQUIRE_NEAR(actual, expected, tolerance) \
    requireNear((actual), (expected), (tolerance), #actual, __FILE__, __LINE__)

[[nodiscard]] LogicalUiProjection ultrawideProjection() noexcept {
    return {
        {3'440.0, 1'440.0},
        {3'440.0, 1'440.0},
        {440.0, 0.0, 2'560.0, 1'440.0},
        {0.0, 0.0, 1'920.0, 1'080.0},
        4.0 / 3.0,
        4.0 / 3.0
    };
}

void testUltrawideCenteredSixteenByNineContent() {
    LogicalUiProjectionPoint logical{-1.0, -1.0};
    REQUIRE(tryProjectWindowPointToLogicalUi(
        {1'720.0, 720.0},
        ultrawideProjection(),
        logical
    ));
    REQUIRE_NEAR(logical.x, 960.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, 540.0, 1.0e-12);

    REQUIRE(tryProjectWindowPointToLogicalUi(
        {440.0, 0.0},
        ultrawideProjection(),
        logical
    ));
    REQUIRE_NEAR(logical.x, 0.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, 0.0, 1.0e-12);
}

void testLetterboxMissesRemainNegativeOrBeyondLogicalExtent() {
    LogicalUiProjectionPoint logical{};
    REQUIRE(tryProjectWindowPointToLogicalUi(
        {200.0, 720.0},
        ultrawideProjection(),
        logical
    ));
    REQUIRE_NEAR(logical.x, -180.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, 540.0, 1.0e-12);

    REQUIRE(tryProjectWindowPointToLogicalUi(
        {3'200.0, 720.0},
        ultrawideProjection(),
        logical
    ));
    REQUIRE_NEAR(logical.x, 2'070.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, 540.0, 1.0e-12);
}

void testDevicePixelRatioTwoUsesDrawablePixels() {
    const LogicalUiProjection projection{
        {1'280.0, 720.0},
        {2'560.0, 1'440.0},
        {0.0, 0.0, 2'560.0, 1'440.0},
        {0.0, 0.0, 1'920.0, 1'080.0},
        4.0 / 3.0,
        4.0 / 3.0
    };
    LogicalUiProjectionPoint logical{};
    REQUIRE(tryProjectWindowPointToLogicalUi(
        {320.0, 180.0},
        projection,
        logical
    ));
    REQUIRE_NEAR(logical.x, 480.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, 270.0, 1.0e-12);
}

void testTallWindowUsesCenteredContentWithoutClamping() {
    const LogicalUiProjection projection{
        {1'000.0, 1'000.0},
        {1'000.0, 1'000.0},
        {0.0, 218.75, 1'000.0, 562.5},
        {0.0, 0.0, 1'920.0, 1'080.0},
        1'000.0 / 1'920.0,
        562.5 / 1'080.0
    };
    LogicalUiProjectionPoint logical{};
    REQUIRE(tryProjectWindowPointToLogicalUi(
        {500.0, 500.0},
        projection,
        logical
    ));
    REQUIRE_NEAR(logical.x, 960.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, 540.0, 1.0e-12);

    REQUIRE(tryProjectWindowPointToLogicalUi(
        {500.0, 100.0},
        projection,
        logical
    ));
    REQUIRE_NEAR(logical.x, 960.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, -228.0, 1.0e-12);

    REQUIRE(tryProjectWindowPointToLogicalUi(
        {500.0, 900.0},
        projection,
        logical
    ));
    REQUIRE_NEAR(logical.x, 960.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, 1'308.0, 1.0e-12);
}

void testLogicalContentOriginIsPreserved() {
    const LogicalUiProjection projection{
        {800.0, 600.0},
        {800.0, 600.0},
        {100.0, 50.0, 600.0, 500.0},
        {40.0, 20.0, 1'200.0, 1'000.0},
        0.5,
        0.5
    };
    LogicalUiProjectionPoint logical{};
    REQUIRE(tryProjectWindowPointToLogicalUi(
        {100.0, 50.0},
        projection,
        logical
    ));
    REQUIRE_NEAR(logical.x, 40.0, 1.0e-12);
    REQUIRE_NEAR(logical.y, 20.0, 1.0e-12);
}

void testRoundedContainUsesDeclaredRendererScale() {
    const double rendererScale = static_cast<double>(
        static_cast<float>(562.0 / 1'080.0)
    );
    const LogicalUiProjection projection{
        {1'000.0, 1'000.0},
        {1'000.0, 1'000.0},
        {0.0, 219.0, 1'000.0, 562.0},
        {0.0, 0.0, 1'920.0, 1'080.0},
        rendererScale,
        rendererScale
    };
    LogicalUiProjectionPoint logical{};
    REQUIRE(tryProjectWindowPointToLogicalUi(
        {
            rendererScale * 1'920.0,
            219.0 + rendererScale * 1'080.0
        },
        projection,
        logical
    ));
    REQUIRE_NEAR(logical.x, 1'920.0, 1.0e-9);
    REQUIRE_NEAR(logical.y, 1'080.0, 1.0e-9);
}

void testInvalidInputPreservesOutputTransactionally() {
    const LogicalUiProjection validProjection{
        {1'280.0, 720.0},
        {2'560.0, 1'440.0},
        {0.0, 0.0, 2'560.0, 1'440.0},
        {0.0, 0.0, 1'920.0, 1'080.0},
        4.0 / 3.0,
        4.0 / 3.0
    };
    const LogicalUiProjectionPoint sentinel{17.0, 23.0};
    LogicalUiProjectionPoint logical = sentinel;

    LogicalUiProjection invalid = validProjection;
    invalid.windowSize.width = 0.0;
    REQUIRE(!tryProjectWindowPointToLogicalUi({100.0, 50.0}, invalid, logical));
    REQUIRE(logical == sentinel);

    invalid = validProjection;
    invalid.drawableContentRect.x = -1.0;
    REQUIRE(!tryProjectWindowPointToLogicalUi({100.0, 50.0}, invalid, logical));
    REQUIRE(logical == sentinel);

    invalid = validProjection;
    invalid.drawableContentRect.width = 2'561.0;
    REQUIRE(!tryProjectWindowPointToLogicalUi({100.0, 50.0}, invalid, logical));
    REQUIRE(logical == sentinel);

    invalid = validProjection;
    invalid.logicalContentRect.height = 0.0;
    REQUIRE(!tryProjectWindowPointToLogicalUi({100.0, 50.0}, invalid, logical));
    REQUIRE(logical == sentinel);

    REQUIRE(!tryProjectWindowPointToLogicalUi(
        {std::numeric_limits<double>::quiet_NaN(), 50.0},
        validProjection,
        logical
    ));
    REQUIRE(logical == sentinel);
}

void testInvalidDeclaredScalePreservesOutputTransactionally() {
    const LogicalUiProjection validProjection{
        {1'280.0, 720.0},
        {2'560.0, 1'440.0},
        {0.0, 0.0, 2'560.0, 1'440.0},
        {0.0, 0.0, 1'920.0, 1'080.0},
        4.0 / 3.0,
        4.0 / 3.0
    };
    const LogicalUiProjectionPoint sentinel{17.0, 23.0};
    LogicalUiProjectionPoint logical = sentinel;

    LogicalUiProjection invalid = validProjection;
    invalid.drawablePixelsPerLogicalUnitX = 0.0;
    REQUIRE(!tryProjectWindowPointToLogicalUi({100.0, 50.0}, invalid, logical));
    REQUIRE(logical == sentinel);

    invalid = validProjection;
    invalid.drawablePixelsPerLogicalUnitY = -1.0;
    REQUIRE(!tryProjectWindowPointToLogicalUi({100.0, 50.0}, invalid, logical));
    REQUIRE(logical == sentinel);

    invalid = validProjection;
    invalid.drawablePixelsPerLogicalUnitX =
        std::numeric_limits<double>::infinity();
    REQUIRE(!tryProjectWindowPointToLogicalUi({100.0, 50.0}, invalid, logical));
    REQUIRE(logical == sentinel);

    invalid = validProjection;
    invalid.drawablePixelsPerLogicalUnitY =
        std::numeric_limits<double>::quiet_NaN();
    REQUIRE(!tryProjectWindowPointToLogicalUi({100.0, 50.0}, invalid, logical));
    REQUIRE(logical == sentinel);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"ultrawide centered 16:9", testUltrawideCenteredSixteenByNineContent},
        TestCase{"letterbox misses", testLetterboxMissesRemainNegativeOrBeyondLogicalExtent},
        TestCase{"DPR 2", testDevicePixelRatioTwoUsesDrawablePixels},
        TestCase{"tall centered content", testTallWindowUsesCenteredContentWithoutClamping},
        TestCase{"logical content origin", testLogicalContentOriginIsPreserved},
        TestCase{"rounded contain renderer scale", testRoundedContainUsesDeclaredRendererScale},
        TestCase{"invalid input transaction", testInvalidInputPreservesOutputTransactionally},
        TestCase{"invalid declared scale transaction", testInvalidDeclaredScalePreservesOutputTransactionally}
    };

    std::size_t passed = 0U;
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
