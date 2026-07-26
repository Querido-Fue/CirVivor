#include "core/ids/entity_id.h"
#include "core/math/deterministic_math.h"
#include "core/rng/deterministic_rng.h"
#include "core/state_hash/canonical_state_hasher.h"
#include "core/state_hash/state_hasher.h"
#include "engine/frame_scheduler.h"

#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <exception>
#include <functional>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

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
    if (!std::isfinite(actual) || std::abs(actual - expected) > tolerance) {
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
    requireNear((actual), (expected), (tolerance), #actual " ~= " #expected, __FILE__, __LINE__)

void testDeterministicRngReferenceSequence() {
    cirvivor::core::DeterministicRng rng(42, 54);
    constexpr std::array<std::uint32_t, 6> expected{
        0xa15c'02b7U,
        0x7b47'f409U,
        0xba1d'3330U,
        0x83d2'f293U,
        0xbfa4'784bU,
        0xcbed'606eU
    };

    for (const std::uint32_t value : expected) {
        REQUIRE(rng.nextU32() == value);
    }

    rng.reseed(42, 54);
    REQUIRE(rng.nextU32() == expected.front());
    REQUIRE(rng.sequence() == 54U);
}

void testDeterministicRngRangesAndInvalidBound() {
    cirvivor::core::DeterministicRng rng(7, 11);
    for (std::uint32_t index = 0; index < 1'000U; ++index) {
        REQUIRE(rng.nextBounded(7U) < 7U);
        const double unit = rng.nextUnitDouble();
        REQUIRE(unit >= 0.0);
        REQUIRE(unit < 1.0);
    }

    bool threw = false;
    try {
        static_cast<void>(rng.nextBounded(0));
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE(threw);

    threw = false;
    try {
        cirvivor::core::DeterministicRng invalidSequence(
            7,
            cirvivor::core::DeterministicRng::maximum_sequence + 1U
        );
        static_cast<void>(invalidSequence);
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE(threw);
}

void testEntityIdGenerationAndPacking() {
    constexpr cirvivor::core::EntityId first{17, 3};
    constexpr cirvivor::core::EntityId stale{17, 2};
    static_assert(first.isValid());
    static_assert(first != stale);
    static_assert(!cirvivor::core::EntityId::invalid().isValid());

    REQUIRE(cirvivor::core::EntityId::fromPacked(first.packed()) == first);
    REQUIRE(cirvivor::core::EntityId::nextGeneration(0) == 1U);
    REQUIRE(cirvivor::core::EntityId::nextGeneration(7) == 8U);
    REQUIRE(cirvivor::core::EntityId::nextGeneration(
        std::numeric_limits<std::uint32_t>::max()
    ) == 1U);
}

void testStateHasherReferenceAndStableIntegralEncoding() {
    cirvivor::core::StateHasher64 hasher;
    hasher.appendString("hello");
    REQUIRE(hasher.value() == 0xa430'd846'80aa'bd0bULL);

    hasher.reset();
    hasher.appendU32(0x0403'0201U);
    cirvivor::core::StateHasher64 bytesHasher;
    const std::array<std::byte, 4> bytes{
        std::byte{0x01},
        std::byte{0x02},
        std::byte{0x03},
        std::byte{0x04}
    };
    bytesHasher.appendBytes(bytes);
    REQUIRE(hasher.value() == bytesHasher.value());
}

void testCanonicalStateHasherMatchesJavaScriptOracle() {
    cirvivor::core::CanonicalStateHasher64 hasher;
    hasher.beginObject(2);
    hasher.appendObjectKey("a");
    hasher.appendNumber(1);
    hasher.appendObjectKey("b");
    hasher.appendString("x");
    hasher.endObject();
    REQUIRE(hasher.value() == 0x00e2'1916'743a'ee53ULL);

    hasher.reset();
    hasher.beginArray(3);
    hasher.appendNull();
    hasher.appendBoolean(false);
    hasher.appendNumber(1.5);
    hasher.endArray();
    REQUIRE(hasher.value() == 0x9ce8'b339'627c'a222ULL);

    hasher.reset();
    hasher.appendString("한글");
    REQUIRE(hasher.value() == 0x4207'ab02'2087'0763ULL);

    hasher.reset();
    hasher.appendNumber(-0.0);
    REQUIRE(hasher.value() == 0x818b'9149'58e9'a8beULL);
}

void testCanonicalStateHasherRejectsInvalidValues() {
    cirvivor::core::CanonicalStateHasher64 hasher;
    bool threw = false;
    try {
        hasher.appendNumber(std::numeric_limits<double>::infinity());
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE(threw);

    threw = false;
    try {
        hasher.appendString(std::string_view("\xc0\x80", 2));
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE(threw);
}

void testDeterministicExpMatchesV8ReferenceBits() {
    struct ExpCase final {
        double input;
        std::uint64_t expectedBits;
    };
    constexpr std::array cases{
        ExpCase{0.0, 0x3ff0'0000'0000'0000ULL},
        ExpCase{1.0, 0x4005'bf0a'8b14'5769ULL},
        ExpCase{-1.0, 0x3fd7'8b56'362c'ef38ULL},
        ExpCase{1.0 / 3.0, 0x3ff6'546d'b1ba'2d13ULL},
        ExpCase{-1.0 / 6.0, 0x3feb'1660'd7a2'23b0ULL},
        ExpCase{10.0, 0x40d5'829d'cf95'0560ULL},
        ExpCase{-10.0, 0x3f07'cd79'b564'7c9aULL},
        ExpCase{709.0, 0x7fdd'422d'2be5'dc9bULL},
        ExpCase{-745.0, 0x0000'0000'0000'0001ULL}
    };
    for (const ExpCase testCase : cases) {
        REQUIRE(
            std::bit_cast<std::uint64_t>(
                cirvivor::core::deterministicExp(testCase.input)
            ) == testCase.expectedBits
        );
    }
    REQUIRE(std::isinf(cirvivor::core::deterministicExp(
        std::numeric_limits<double>::infinity()
    )));
    REQUIRE(cirvivor::core::deterministicExp(
        -std::numeric_limits<double>::infinity()
    ) == 0.0);
    REQUIRE(std::isnan(cirvivor::core::deterministicExp(
        std::numeric_limits<double>::quiet_NaN()
    )));
}

void testSchedulerNormalCatchUpAndInterpolation() {
    cirvivor::engine::FrameScheduler scheduler;
    const double fixedStep = scheduler.config().fixedStepSeconds;
    const auto schedule = scheduler.advance({
        .rawFrameDeltaSeconds = fixedStep * 2.5,
        .previousFrameCpuSeconds = 0,
        .fixedStepEnabled = true
    });

    REQUIRE(schedule.fixedStepCount == 2U);
    REQUIRE(schedule.droppedFixedStepCount == 0U);
    REQUIRE(!schedule.cpuBound);
    REQUIRE_NEAR(schedule.fixedAlpha, 0.5, 1.0e-12);
}

void testSchedulerClampAndDropsWholeDebt() {
    cirvivor::engine::FrameScheduler scheduler;
    const auto schedule = scheduler.advance({
        .rawFrameDeltaSeconds = 0.25,
        .previousFrameCpuSeconds = 0,
        .fixedStepEnabled = true
    });

    REQUIRE_NEAR(schedule.frameDeltaSeconds, 0.1, 1.0e-12);
    REQUIRE_NEAR(schedule.frameDeltaClampLossSeconds, 0.15, 1.0e-12);
    REQUIRE(schedule.fixedStepCount == 2U);
    REQUIRE(schedule.droppedFixedStepCount == 4U);
    REQUIRE(scheduler.accumulatorSeconds() < scheduler.config().fixedStepSeconds);
}

void testSchedulerCpuBoundLimitAndRecoveryHysteresis() {
    cirvivor::engine::FrameScheduler scheduler;
    const double fixedStep = scheduler.config().fixedStepSeconds;

    const auto entered = scheduler.advance({
        .rawFrameDeltaSeconds = fixedStep,
        .previousFrameCpuSeconds = 0.016,
        .fixedStepEnabled = true
    });
    REQUIRE(entered.fixedStepCount == 1U);
    REQUIRE(entered.cpuBound);

    const auto limited = scheduler.advance({
        .rawFrameDeltaSeconds = fixedStep * 2.5,
        .previousFrameCpuSeconds = 0.04,
        .fixedStepEnabled = true
    });
    REQUIRE(limited.fixedStepCount == 1U);
    REQUIRE(limited.droppedFixedStepCount == 1U);
    REQUIRE(limited.cpuBound);

    const auto notHeadroom = scheduler.advance({fixedStep, 0.012, true});
    REQUIRE(notHeadroom.cpuBound);
    REQUIRE(scheduler.advance({fixedStep, 0.010, true}).cpuBound);
    REQUIRE(scheduler.advance({fixedStep, 0.010, true}).cpuBound);
    REQUIRE(!scheduler.advance({fixedStep, 0.010, true}).cpuBound);
}

void testSchedulerPauseAndDisabledStepResetState() {
    cirvivor::engine::FrameScheduler scheduler;
    const double fixedStep = scheduler.config().fixedStepSeconds;

    static_cast<void>(scheduler.advance({fixedStep * 1.5, fixedStep * 1.5, true}));
    REQUIRE(scheduler.accumulatorSeconds() > 0);
    REQUIRE(scheduler.isCpuBound());

    scheduler.suspend();
    REQUIRE(scheduler.isSuspended());
    REQUIRE_NEAR(scheduler.accumulatorSeconds(), 0, 0);
    REQUIRE(!scheduler.isCpuBound());
    const auto suspended = scheduler.advance({0.1, 0, true});
    REQUIRE(suspended.suspended);
    REQUIRE(suspended.fixedStepCount == 0U);

    scheduler.resume();
    const auto resumed = scheduler.advance({fixedStep * 0.5, 0, true});
    REQUIRE(!resumed.suspended);
    REQUIRE(resumed.fixedStepCount == 0U);
    REQUIRE_NEAR(resumed.fixedAlpha, 0.5, 1.0e-12);

    const auto disabled = scheduler.advance({fixedStep, 0.016, false});
    REQUIRE(disabled.fixedStepCount == 0U);
    REQUIRE_NEAR(scheduler.accumulatorSeconds(), 0, 0);
    REQUIRE(!scheduler.isCpuBound());
}

void testSchedulerNormalizesInvalidDeltaAndConfig() {
    cirvivor::engine::FrameSchedulerConfig invalidConfig;
    invalidConfig.fixedStepSeconds = std::numeric_limits<double>::quiet_NaN();
    invalidConfig.maxFrameDeltaSeconds = -1;
    invalidConfig.normalMaxSteps = 0;
    invalidConfig.cpuBoundMaxSteps = 99;
    invalidConfig.enterCpuRatio = std::numeric_limits<double>::infinity();
    invalidConfig.exitCpuRatio = -1;
    invalidConfig.recoveryFrames = 0;
    cirvivor::engine::FrameScheduler scheduler(invalidConfig);

    REQUIRE_NEAR(scheduler.config().fixedStepSeconds, 1.0 / 60.0, 1.0e-15);
    REQUIRE_NEAR(scheduler.config().maxFrameDeltaSeconds, 0.1, 1.0e-15);
    REQUIRE(scheduler.config().normalMaxSteps == 2U);
    REQUIRE(scheduler.config().cpuBoundMaxSteps == 2U);

    const auto schedule = scheduler.advance({
        .rawFrameDeltaSeconds = std::numeric_limits<double>::quiet_NaN(),
        .previousFrameCpuSeconds = std::numeric_limits<double>::quiet_NaN(),
        .fixedStepEnabled = true
    });
    REQUIRE_NEAR(schedule.frameDeltaSeconds, 1.0 / 60.0, 1.0e-15);
    REQUIRE(schedule.fixedStepCount == 1U);
}

struct TestCase final {
    std::string_view name;
    std::function<void()> run;
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"deterministic RNG reference sequence", testDeterministicRngReferenceSequence},
        TestCase{"deterministic RNG ranges", testDeterministicRngRangesAndInvalidBound},
        TestCase{"EntityId generation and packing", testEntityIdGenerationAndPacking},
        TestCase{"state hasher", testStateHasherReferenceAndStableIntegralEncoding},
        TestCase{"canonical state hasher parity", testCanonicalStateHasherMatchesJavaScriptOracle},
        TestCase{"canonical state hasher validation", testCanonicalStateHasherRejectsInvalidValues},
        TestCase{"V8-compatible deterministic exp", testDeterministicExpMatchesV8ReferenceBits},
        TestCase{"scheduler normal catch-up", testSchedulerNormalCatchUpAndInterpolation},
        TestCase{"scheduler clamp and debt drop", testSchedulerClampAndDropsWholeDebt},
        TestCase{"scheduler CPU-bound hysteresis", testSchedulerCpuBoundLimitAndRecoveryHysteresis},
        TestCase{"scheduler pause reset", testSchedulerPauseAndDisabledStepResetState},
        TestCase{"scheduler input normalization", testSchedulerNormalizesInvalidDeltaAndConfig}
    };

    std::size_t passed = 0;
    for (const auto& test : tests) {
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
