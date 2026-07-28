#include "debug/debug_performance_tracker.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <string_view>

namespace {

using cirvivor::debug::DebugPerformanceSection;
using cirvivor::debug::DebugPerformanceTracker;
using cirvivor::debug::debug_performance_samples_per_section;
using cirvivor::debug::debug_performance_window_nanoseconds;

[[noreturn]] void fail(
    const char* expression,
    const char* file,
    const int line
) {
    std::cerr << file << ':' << line << ": requirement failed: "
              << expression << '\n';
    std::exit(EXIT_FAILURE);
}

#define REQUIRE(expression) \
    do { \
        if (!(expression)) { \
            fail(#expression, __FILE__, __LINE__); \
        } \
    } while (false)

[[nodiscard]] bool almostEqual(
    const double first,
    const double second,
    const double tolerance = 1.0e-9
) noexcept {
    return std::abs(first - second) <= tolerance;
}

void testDisabledTrackerRejectsSamples() {
    DebugPerformanceTracker tracker;
    REQUIRE(!tracker.isEnabled());
    REQUIRE(!tracker.record(DebugPerformanceSection::frameCpu, 1U, 1U));
    const auto snapshot = tracker.snapshot(1U);
    REQUIRE(!snapshot.enabled);
    REQUIRE(!snapshot.section(DebugPerformanceSection::frameCpu).hasSamples);
}

void testOneSecondWindowIncludesExactBoundary() {
    DebugPerformanceTracker tracker;
    REQUIRE(tracker.setEnabled(true));
    REQUIRE(tracker.record(DebugPerformanceSection::frameCpu, 0U, 1'000'000U));
    REQUIRE(tracker.record(
        DebugPerformanceSection::frameCpu,
        500'000'000U,
        2'000'000U
    ));
    REQUIRE(tracker.record(
        DebugPerformanceSection::frameCpu,
        debug_performance_window_nanoseconds,
        3'000'000U
    ));

    const auto boundary = tracker.snapshot(debug_performance_window_nanoseconds);
    const auto& stats = boundary.section(DebugPerformanceSection::frameCpu);
    REQUIRE(stats.hasSamples);
    REQUIRE(stats.sampleCount == 3U);
    REQUIRE(almostEqual(stats.averageMilliseconds, 2.0));
    REQUIRE(almostEqual(stats.lastMilliseconds, 3.0));
    REQUIRE(almostEqual(stats.maximumMilliseconds, 3.0));

    const auto expired = tracker.snapshot(
        debug_performance_window_nanoseconds + 1U
    );
    const auto& expiredStats = expired.section(DebugPerformanceSection::frameCpu);
    REQUIRE(expiredStats.sampleCount == 2U);
    REQUIRE(almostEqual(expiredStats.averageMilliseconds, 2.5));
}

void testSectionsRemainIndependent() {
    DebugPerformanceTracker tracker;
    static_cast<void>(tracker.setEnabled(true));
    REQUIRE(tracker.record(DebugPerformanceSection::frameCpu, 10U, 4'000'000U));
    REQUIRE(tracker.record(DebugPerformanceSection::sceneBuild, 10U, 1'500'000U));
    REQUIRE(tracker.record(DebugPerformanceSection::sceneBuild, 20U, 2'500'000U));

    const auto snapshot = tracker.snapshot(20U);
    REQUIRE(snapshot.section(DebugPerformanceSection::frameCpu).sampleCount == 1U);
    const auto& build = snapshot.section(DebugPerformanceSection::sceneBuild);
    REQUIRE(build.sampleCount == 2U);
    REQUIRE(almostEqual(build.averageMilliseconds, 2.0));
    REQUIRE(almostEqual(build.lastMilliseconds, 2.5));
}

void testNonMonotonicTimestampResetsOnlyItsSection() {
    DebugPerformanceTracker tracker;
    static_cast<void>(tracker.setEnabled(true));
    REQUIRE(tracker.record(DebugPerformanceSection::frameCpu, 100U, 1'000'000U));
    REQUIRE(tracker.record(DebugPerformanceSection::renderCall, 100U, 7'000'000U));
    REQUIRE(tracker.record(DebugPerformanceSection::frameCpu, 50U, 3'000'000U));

    const auto snapshot = tracker.snapshot(100U);
    const auto& frame = snapshot.section(DebugPerformanceSection::frameCpu);
    REQUIRE(frame.sampleCount == 1U);
    REQUIRE(almostEqual(frame.averageMilliseconds, 3.0));
    REQUIRE(snapshot.section(DebugPerformanceSection::renderCall).sampleCount == 1U);
}

void testRingDropsOnlyOldestSampleAtCapacity() {
    DebugPerformanceTracker tracker;
    static_cast<void>(tracker.setEnabled(true));
    for (std::size_t index = 0U;
         index <= debug_performance_samples_per_section;
         ++index) {
        REQUIRE(tracker.record(
            DebugPerformanceSection::updateBuild,
            static_cast<std::uint64_t>(index),
            static_cast<std::uint64_t>(index + 1U)
        ));
    }

    const auto snapshot = tracker.snapshot(
        debug_performance_samples_per_section
    );
    const auto& stats = snapshot.section(DebugPerformanceSection::updateBuild);
    REQUIRE(stats.sampleCount == debug_performance_samples_per_section);
    REQUIRE(almostEqual(stats.lastMilliseconds, 513.0 / 1'000'000.0));
    REQUIRE(almostEqual(stats.maximumMilliseconds, 513.0 / 1'000'000.0));
    REQUIRE(almostEqual(stats.averageMilliseconds, 257.5 / 1'000'000.0));
}

void testDisableClearsSamplesAndReenableStartsEmpty() {
    DebugPerformanceTracker tracker;
    REQUIRE(tracker.setEnabled(true));
    REQUIRE(tracker.record(DebugPerformanceSection::fixedUpdate, 1U, 5U));
    REQUIRE(tracker.setEnabled(false));
    REQUIRE(!tracker.setEnabled(false));
    REQUIRE(!tracker.snapshot(1U).enabled);
    REQUIRE(tracker.setEnabled(true));
    const auto snapshot = tracker.snapshot(1U);
    REQUIRE(snapshot.enabled);
    REQUIRE(!snapshot.section(DebugPerformanceSection::fixedUpdate).hasSamples);
}

void testInvalidSectionIsRejectedWithoutDisturbingValidData() {
    DebugPerformanceTracker tracker;
    static_cast<void>(tracker.setEnabled(true));
    REQUIRE(tracker.record(DebugPerformanceSection::frameCpu, 1U, 2U));
    REQUIRE(!tracker.record(DebugPerformanceSection::count, 2U, 3U));
    REQUIRE(!tracker.record(
        static_cast<DebugPerformanceSection>(255U),
        2U,
        std::numeric_limits<std::uint64_t>::max()
    ));
    REQUIRE(tracker.snapshot(2U).section(
        DebugPerformanceSection::frameCpu
    ).sampleCount == 1U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    constexpr std::array tests{
        TestCase{"disabled rejects samples", testDisabledTrackerRejectsSamples},
        TestCase{"one second boundary", testOneSecondWindowIncludesExactBoundary},
        TestCase{"section independence", testSectionsRemainIndependent},
        TestCase{"non-monotonic reset", testNonMonotonicTimestampResetsOnlyItsSection},
        TestCase{"fixed ring overwrite", testRingDropsOnlyOldestSampleAtCapacity},
        TestCase{"disable reset", testDisableClearsSamplesAndReenableStartsEmpty},
        TestCase{"invalid section", testInvalidSectionIsRejectedWithoutDisturbingValidData}
    };

    for (const TestCase& test : tests) {
        test.run();
        std::cout << "[PASS] " << test.name << '\n';
    }
    std::cout << tests.size() << " debug performance tracker tests passed\n";
    return EXIT_SUCCESS;
}
