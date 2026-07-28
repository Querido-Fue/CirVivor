#include "app/title_display_policy.h"

#include <array>
#include <cmath>
#include <exception>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

using cirvivor::app::TitleDisplayArea;
using cirvivor::app::titleLocalPoint;
using cirvivor::app::tryResolveTitleDisplayArea;
using cirvivor::ui::layout::LogicalSafeAreaInsets;
using cirvivor::ui::layout::PointD;

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

void testUltrawideEnabledUsesFullWindow() {
    TitleDisplayArea area{};
    REQUIRE(tryResolveTitleDisplayArea(
        3'440.0,
        1'440.0,
        {},
        true,
        area
    ));
    REQUIRE_NEAR(area.windowOrigin.x, 0.0, 1.0e-12);
    REQUIRE_NEAR(area.windowOrigin.y, 0.0, 1.0e-12);
    REQUIRE_NEAR(area.logicalWidth, 3'440.0, 1.0e-12);
    REQUIRE_NEAR(area.logicalHeight, 1'440.0, 1.0e-12);
    REQUIRE(area.logicalSafeArea == LogicalSafeAreaInsets{});
    REQUIRE(area.usesFullWindow);
}

void testUltrawideDisabledUsesCenteredContain() {
    TitleDisplayArea area{};
    REQUIRE(tryResolveTitleDisplayArea(
        3'440.0,
        1'440.0,
        {},
        false,
        area
    ));
    REQUIRE_NEAR(area.windowOrigin.x, 440.0, 1.0e-12);
    REQUIRE_NEAR(area.windowOrigin.y, 0.0, 1.0e-12);
    REQUIRE_NEAR(area.logicalWidth, 2'560.0, 1.0e-12);
    REQUIRE_NEAR(area.logicalHeight, 1'440.0, 1.0e-12);
    REQUIRE(area.logicalSafeArea == LogicalSafeAreaInsets{});
    REQUIRE(!area.usesFullWindow);
}

void testTallWindowAlwaysUsesCenteredContain() {
    TitleDisplayArea enabled{};
    TitleDisplayArea disabled{};
    REQUIRE(tryResolveTitleDisplayArea(1'000.0, 1'000.0, {}, true, enabled));
    REQUIRE(tryResolveTitleDisplayArea(1'000.0, 1'000.0, {}, false, disabled));

    REQUIRE(enabled == disabled);
    REQUIRE_NEAR(enabled.windowOrigin.x, 0.0, 1.0e-12);
    REQUIRE_NEAR(enabled.windowOrigin.y, 218.75, 1.0e-12);
    REQUIRE_NEAR(enabled.logicalWidth, 1'000.0, 1.0e-12);
    REQUIRE_NEAR(enabled.logicalHeight, 562.5, 1.0e-12);
    REQUIRE(!enabled.usesFullWindow);
}

void testExactAspectKeepsGeometryForBothSettings() {
    TitleDisplayArea enabled{};
    TitleDisplayArea disabled{};
    REQUIRE(tryResolveTitleDisplayArea(1'920.0, 1'080.0, {}, true, enabled));
    REQUIRE(tryResolveTitleDisplayArea(1'920.0, 1'080.0, {}, false, disabled));

    REQUIRE(enabled.windowOrigin == disabled.windowOrigin);
    REQUIRE_NEAR(enabled.logicalWidth, disabled.logicalWidth, 1.0e-12);
    REQUIRE_NEAR(enabled.logicalHeight, disabled.logicalHeight, 1.0e-12);
    REQUIRE_NEAR(enabled.logicalWidth, 1'920.0, 1.0e-12);
    REQUIRE_NEAR(enabled.logicalHeight, 1'080.0, 1.0e-12);
    REQUIRE(enabled.usesFullWindow);
    REQUIRE(!disabled.usesFullWindow);
}

void testAsymmetricSafeAreaIsMappedInsideContent() {
    TitleDisplayArea wide{};
    REQUIRE(tryResolveTitleDisplayArea(
        3'440.0,
        1'440.0,
        {500.0, 30.0, 520.0, 50.0},
        false,
        wide
    ));
    REQUIRE_NEAR(wide.logicalSafeArea.left, 60.0, 1.0e-12);
    REQUIRE_NEAR(wide.logicalSafeArea.top, 30.0, 1.0e-12);
    REQUIRE_NEAR(wide.logicalSafeArea.right, 80.0, 1.0e-12);
    REQUIRE_NEAR(wide.logicalSafeArea.bottom, 50.0, 1.0e-12);

    TitleDisplayArea tall{};
    REQUIRE(tryResolveTitleDisplayArea(
        1'000.0,
        1'000.0,
        {20.0, 250.0, 30.0, 300.0},
        true,
        tall
    ));
    REQUIRE_NEAR(tall.logicalSafeArea.left, 20.0, 1.0e-12);
    REQUIRE_NEAR(tall.logicalSafeArea.top, 31.25, 1.0e-12);
    REQUIRE_NEAR(tall.logicalSafeArea.right, 30.0, 1.0e-12);
    REQUIRE_NEAR(tall.logicalSafeArea.bottom, 81.25, 1.0e-12);
}

void testPointerConversionPreservesLetterboxMisses() {
    TitleDisplayArea area{};
    REQUIRE(tryResolveTitleDisplayArea(
        3'440.0,
        1'440.0,
        {},
        false,
        area
    ));

    const PointD origin = titleLocalPoint({440.0, 0.0}, area);
    const PointD center = titleLocalPoint({1'720.0, 720.0}, area);
    const PointD leftLetterbox = titleLocalPoint({200.0, 100.0}, area);
    REQUIRE_NEAR(origin.x, 0.0, 1.0e-12);
    REQUIRE_NEAR(origin.y, 0.0, 1.0e-12);
    REQUIRE_NEAR(center.x, 1'280.0, 1.0e-12);
    REQUIRE_NEAR(center.y, 720.0, 1.0e-12);
    REQUIRE_NEAR(leftLetterbox.x, -240.0, 1.0e-12);
    REQUIRE_NEAR(leftLetterbox.y, 100.0, 1.0e-12);
}

void testInvalidInputPreservesOutputTransactionally() {
    const TitleDisplayArea sentinel{
        {17.0, 23.0},
        640.0,
        360.0,
        {1.0, 2.0, 3.0, 4.0},
        true
    };
    TitleDisplayArea area = sentinel;
    REQUIRE(!tryResolveTitleDisplayArea(0.0, 720.0, {}, true, area));
    REQUIRE(area == sentinel);

    REQUIRE(!tryResolveTitleDisplayArea(
        std::numeric_limits<double>::quiet_NaN(),
        720.0,
        {},
        true,
        area
    ));
    REQUIRE(area == sentinel);

    REQUIRE(!tryResolveTitleDisplayArea(
        1'280.0,
        720.0,
        {700.0, 0.0, 600.0, 0.0},
        true,
        area
    ));
    REQUIRE(area == sentinel);

    REQUIRE(!tryResolveTitleDisplayArea(1.0, 100.0, {}, false, area));
    REQUIRE(area == sentinel);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"ultrawide enabled", testUltrawideEnabledUsesFullWindow},
        TestCase{"ultrawide disabled", testUltrawideDisabledUsesCenteredContain},
        TestCase{"tall contain", testTallWindowAlwaysUsesCenteredContain},
        TestCase{"exact aspect", testExactAspectKeepsGeometryForBothSettings},
        TestCase{"asymmetric safe area", testAsymmetricSafeAreaIsMappedInsideContent},
        TestCase{"pointer local conversion", testPointerConversionPreservesLetterboxMisses},
        TestCase{"invalid input transaction", testInvalidInputPreservesOutputTransactionally}
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
