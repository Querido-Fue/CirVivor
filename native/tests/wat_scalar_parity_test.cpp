#include "core/navigation/flow_field_scalar.h"
#include "core/physics/prepared_contact_scalar.h"

#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <limits>
#include <new>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace allocation_probe {

thread_local bool enabled = false;
thread_local std::size_t count = 0;

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

constexpr std::uint64_t fnvOffset = 0xcbf2'9ce4'8422'2325ULL;
constexpr std::uint64_t fnvPrime = 0x0000'0100'0000'01b3ULL;

[[nodiscard]] std::uint64_t appendByte(
    const std::uint64_t hash,
    const std::uint8_t value
) noexcept {
    return (hash ^ value) * fnvPrime;
}

[[nodiscard]] std::uint64_t appendU32(
    std::uint64_t hash,
    const std::uint32_t value
) noexcept {
    for (std::uint32_t shift = 0; shift < 32U; shift += 8U) {
        hash = appendByte(
            hash,
            static_cast<std::uint8_t>((value >> shift) & 0xffU)
        );
    }
    return hash;
}

[[nodiscard]] std::uint64_t appendFlowCase(
    std::uint64_t hash,
    const std::span<const std::uint8_t> blocked,
    const std::int32_t columns,
    const std::int32_t rows,
    const std::int32_t goalColumn,
    const std::int32_t goalRow,
    const cirvivor::core::FlowFieldBuildResult& result,
    const cirvivor::core::FlowFieldPlanes& planes
) noexcept {
    hash = appendU32(hash, static_cast<std::uint32_t>(columns));
    hash = appendU32(hash, static_cast<std::uint32_t>(rows));
    hash = appendU32(hash, static_cast<std::uint32_t>(goalColumn));
    hash = appendU32(hash, static_cast<std::uint32_t>(goalRow));
    for (const std::uint8_t value : blocked.first(result.cellCount)) {
        hash = appendByte(hash, value);
    }
    for (const std::span<const float> plane : {
        std::span<const float>(planes.integration.first(result.cellCount)),
        std::span<const float>(planes.directionX.first(result.cellCount)),
        std::span<const float>(planes.directionY.first(result.cellCount))
    }) {
        for (const float value : plane) {
            hash = appendU32(hash, std::bit_cast<std::uint32_t>(value));
        }
    }
    return appendU32(hash, result.goalIndex);
}

struct FlowBuffers final {
    explicit FlowBuffers(const std::size_t capacity)
        : blocked(capacity),
          integration(capacity),
          directionX(capacity),
          directionY(capacity) {}

    [[nodiscard]] cirvivor::core::FlowFieldPlanes planes() noexcept {
        return {integration, directionX, directionY};
    }

    std::vector<std::uint8_t> blocked;
    std::vector<float> integration;
    std::vector<float> directionX;
    std::vector<float> directionY;
};

[[nodiscard]] std::uint64_t buildAndAppend(
    std::uint64_t hash,
    cirvivor::core::FlowFieldScalar& scalar,
    FlowBuffers& buffers,
    const std::int32_t columns,
    const std::int32_t rows,
    const std::int32_t goalColumn,
    const std::int32_t goalRow
) {
    const std::size_t cellCount = static_cast<std::size_t>(columns)
        * static_cast<std::size_t>(rows);
    const cirvivor::core::FlowFieldPlanes output = buffers.planes();
    const auto result = scalar.build(
        std::span<const std::uint8_t>(buffers.blocked).first(cellCount),
        columns,
        rows,
        goalColumn,
        goalRow,
        output
    );
    REQUIRE(result.status == cirvivor::core::FlowFieldStatus::ok);
    REQUIRE(result.cellCount == cellCount);
    return appendFlowCase(
        hash,
        std::span<const std::uint8_t>(buffers.blocked).first(cellCount),
        columns,
        rows,
        goalColumn,
        goalRow,
        result,
        output
    );
}

void testFlowOpenGridFloat32Golden() {
    cirvivor::core::FlowFieldScalar scalar(9);
    std::array<std::uint8_t, 9> blocked{};
    std::array<float, 9> integration{};
    std::array<float, 9> directionX{};
    std::array<float, 9> directionY{};
    const auto result = scalar.build(
        blocked,
        3,
        3,
        1,
        1,
        {integration, directionX, directionY}
    );
    REQUIRE(result.status == cirvivor::core::FlowFieldStatus::ok);
    REQUIRE(result.goalIndex == 4U);

    constexpr std::array<std::uint32_t, 9> expectedIntegration{
        0x3fb5'04f3U, 0x3f80'0000U, 0x3fb5'04f3U,
        0x3f80'0000U, 0x0000'0000U, 0x3f80'0000U,
        0x3fb5'04f3U, 0x3f80'0000U, 0x3fb5'04f3U
    };
    constexpr std::array<std::uint32_t, 9> expectedDirectionX{
        0x3f35'04f3U, 0x0000'0000U, 0xbf35'04f3U,
        0x3f80'0000U, 0x0000'0000U, 0xbf80'0000U,
        0x3f35'04f3U, 0x0000'0000U, 0xbf35'04f3U
    };
    constexpr std::array<std::uint32_t, 9> expectedDirectionY{
        0x3f35'04f3U, 0x3f80'0000U, 0x3f35'04f3U,
        0x0000'0000U, 0x0000'0000U, 0x0000'0000U,
        0xbf35'04f3U, 0xbf80'0000U, 0xbf35'04f3U
    };
    for (std::size_t index = 0; index < integration.size(); ++index) {
        REQUIRE(std::bit_cast<std::uint32_t>(integration[index]) == expectedIntegration[index]);
        REQUIRE(std::bit_cast<std::uint32_t>(directionX[index]) == expectedDirectionX[index]);
        REQUIRE(std::bit_cast<std::uint32_t>(directionY[index]) == expectedDirectionY[index]);
    }

    blocked.fill(std::uint8_t{255});
    const auto blockedGoalResult = scalar.build(
        blocked,
        3,
        3,
        1,
        1,
        {integration, directionX, directionY}
    );
    REQUIRE(blockedGoalResult.status == cirvivor::core::FlowFieldStatus::ok);
    REQUIRE(std::bit_cast<std::uint32_t>(integration[4]) == 0U);
    REQUIRE(std::bit_cast<std::uint32_t>(directionX[4]) == 0U);
    REQUIRE(std::bit_cast<std::uint32_t>(directionY[4]) == 0U);
}

// Golden digests were produced directly by the checked-in WAT runtime at
// flow WAT SHA-256 2bdbb47800c5fd778ab240eb8c45cc44e1a492237ce69a96814e8c4dd687f818.
// Each digest consumes dimensions, goal, blocked u8 bytes, all three f32 plane
// bit patterns, and goalIndex in the same deterministic case order as the JS test.
void testFlowWatGoldenSuites() {
    constexpr std::size_t maximumCellCount = 257U * 193U;
    cirvivor::core::FlowFieldScalar scalar(maximumCellCount);
    FlowBuffers buffers(maximumCellCount);

    std::fill_n(buffers.blocked.begin(), 16, std::uint8_t{0});
    buffers.blocked[1] = 1U;
    buffers.blocked[4] = 255U;
    const std::uint64_t cornerDigest = buildAndAppend(
        fnvOffset,
        scalar,
        buffers,
        4,
        4,
        1,
        1
    );
    REQUIRE(cornerDigest == 0x6860'af9b'1a2d'fa1cULL);
    REQUIRE(buffers.integration[0] >= 5.0e19F);
    REQUIRE(buffers.directionX[0] == 0.0F);
    REQUIRE(buffers.directionY[0] == 0.0F);

    constexpr std::array<std::string_view, 7> decreaseRows{
        "1100010", "0010110", "0010000", "0100000",
        "0001000", "1000000", "0101011"
    };
    std::fill_n(buffers.blocked.begin(), 49, std::uint8_t{0});
    for (std::size_t row = 0; row < decreaseRows.size(); ++row) {
        for (std::size_t column = 0; column < decreaseRows[row].size(); ++column) {
            if (decreaseRows[row][column] == '1') {
                buffers.blocked[(row * 7U) + column] = 1U;
            }
        }
    }
    const std::uint64_t decreaseDigest = buildAndAppend(
        fnvOffset,
        scalar,
        buffers,
        7,
        7,
        0,
        4
    );
    REQUIRE(decreaseDigest == 0x3230'b6e8'042f'307dULL);

    std::uint64_t exhaustiveDigest = fnvOffset;
    std::size_t exhaustiveCaseCount = 0;
    for (std::int32_t rows = 1; rows <= 3; ++rows) {
        for (std::int32_t columns = 1; columns <= 3; ++columns) {
            const std::int32_t cellCount = columns * rows;
            const std::uint32_t maskCount = 1U << static_cast<std::uint32_t>(cellCount);
            for (std::uint32_t mask = 0; mask < maskCount; ++mask) {
                std::fill_n(
                    buffers.blocked.begin(),
                    static_cast<std::size_t>(cellCount),
                    std::uint8_t{0}
                );
                for (std::int32_t index = 0; index < cellCount; ++index) {
                    if ((mask & (1U << static_cast<std::uint32_t>(index))) != 0U) {
                        buffers.blocked[static_cast<std::size_t>(index)] =
                            (index & 1) == 0 ? 1U : 255U;
                    }
                }
                for (std::int32_t goalIndex = 0; goalIndex < cellCount; ++goalIndex) {
                    exhaustiveDigest = buildAndAppend(
                        exhaustiveDigest,
                        scalar,
                        buffers,
                        columns,
                        rows,
                        goalIndex % columns,
                        goalIndex / columns
                    );
                    ++exhaustiveCaseCount;
                }
            }
        }
    }
    REQUIRE(exhaustiveCaseCount == 5'506U);
    REQUIRE(exhaustiveDigest == 0x70d2'072d'eca5'6472ULL);

    std::uint64_t elongatedDigest = fnvOffset;
    std::fill_n(buffers.blocked.begin(), 4'097U * 2U, std::uint8_t{0});
    for (std::int32_t column = 3; column < 4'096; column += 97) {
        const std::int32_t row = (column / 97) % 2;
        buffers.blocked[
            static_cast<std::size_t>(row) * 4'097U
            + static_cast<std::size_t>(column)
        ] = 255U;
    }
    elongatedDigest = buildAndAppend(
        elongatedDigest,
        scalar,
        buffers,
        4'097,
        2,
        4'096,
        1
    );
    std::fill_n(buffers.blocked.begin(), 4'097U * 2U, std::uint8_t{0});
    for (std::int32_t row = 3; row < 4'096; row += 97) {
        const std::int32_t column = (row / 97) % 2;
        buffers.blocked[
            static_cast<std::size_t>(row) * 2U
            + static_cast<std::size_t>(column)
        ] = 255U;
    }
    elongatedDigest = buildAndAppend(
        elongatedDigest,
        scalar,
        buffers,
        2,
        4'097,
        1,
        4'096
    );
    REQUIRE(elongatedDigest == 0x849e'3b92'e04d'6631ULL);

    std::fill_n(buffers.blocked.begin(), maximumCellCount, std::uint8_t{0});
    std::size_t stripe = 0;
    for (std::int32_t column = 13; column < 256; column += 19) {
        const std::int32_t gapStart = static_cast<std::int32_t>(
            (stripe * 37U) % 190U
        );
        for (std::int32_t row = 0; row < 193; ++row) {
            if (row >= gapStart && row <= gapStart + 2) {
                continue;
            }
            buffers.blocked[
                static_cast<std::size_t>(row) * 257U
                + static_cast<std::size_t>(column)
            ] = (stripe & 1U) == 0U ? 1U : 255U;
        }
        ++stripe;
    }
    const std::uint64_t largeDigest = buildAndAppend(
        fnvOffset,
        scalar,
        buffers,
        257,
        193,
        256,
        192
    );
    REQUIRE(largeDigest == 0x9e89'7ab1'9c9e'9faaULL);

    constexpr std::array<double, 5> densities{0.0, 0.08, 0.23, 0.47, 0.72};
    std::uint64_t randomDigest = fnvOffset;
    for (std::uint32_t caseIndex = 1; caseIndex <= 64U; ++caseIndex) {
        std::uint32_t state = 0x9e37'79b9U ^ caseIndex;
        const auto nextRandom = [&state]() noexcept {
            state ^= state << 13U;
            state ^= state >> 17U;
            state ^= state << 5U;
            return static_cast<double>(state) / 4'294'967'296.0;
        };
        const std::int32_t columns = 4 + static_cast<std::int32_t>(caseIndex % 29U);
        const std::int32_t rows = 4 + static_cast<std::int32_t>((caseIndex * 7U) % 23U);
        const std::size_t cellCount = static_cast<std::size_t>(columns)
            * static_cast<std::size_t>(rows);
        const double density = densities[caseIndex % densities.size()];
        std::fill_n(buffers.blocked.begin(), cellCount, std::uint8_t{0});
        for (std::size_t index = 0; index < cellCount; ++index) {
            if (nextRandom() < density) {
                buffers.blocked[index] = nextRandom() < 0.5 ? 1U : 255U;
            }
        }
        const std::int32_t goalColumn = static_cast<std::int32_t>(
            nextRandom() * static_cast<double>(columns)
        );
        const std::int32_t goalRow = static_cast<std::int32_t>(
            nextRandom() * static_cast<double>(rows)
        );
        buffers.blocked[
            static_cast<std::size_t>(goalRow) * static_cast<std::size_t>(columns)
            + static_cast<std::size_t>(goalColumn)
        ] = 0U;
        randomDigest = buildAndAppend(
            randomDigest,
            scalar,
            buffers,
            columns,
            rows,
            goalColumn,
            goalRow
        );
    }
    REQUIRE(randomDigest == 0x282a'dc12'47a1'fce5ULL);
}

void testFlowValidationAndNoTickAllocation() {
    cirvivor::core::FlowFieldScalar scalar(187);
    std::array<std::uint8_t, 187> blocked{};
    std::array<float, 187> integration{};
    std::array<float, 187> directionX{};
    std::array<float, 187> directionY{};
    const cirvivor::core::FlowFieldPlanes output{
        integration,
        directionX,
        directionY
    };

    allocation_probe::count = 0;
    allocation_probe::enabled = true;
    const auto result = scalar.build(blocked, 17, 11, 8, 5, output);
    allocation_probe::enabled = false;
    REQUIRE(result.status == cirvivor::core::FlowFieldStatus::ok);
    REQUIRE(allocation_probe::count == 0U);

    REQUIRE(scalar.build(blocked, 0, 11, 0, 0, output).status
        == cirvivor::core::FlowFieldStatus::invalidDimensions);
    REQUIRE(scalar.build(blocked, 17, 11, 17, 0, output).status
        == cirvivor::core::FlowFieldStatus::invalidGoal);
    REQUIRE(scalar.build({}, 46'341, 46'341, 0, 0, {}).status
        == cirvivor::core::FlowFieldStatus::dimensionOverflow);

    cirvivor::core::FlowFieldScalar smallScalar(9);
    REQUIRE(smallScalar.build({}, 4, 3, 0, 0, {}).status
        == cirvivor::core::FlowFieldStatus::capacityExceeded);
    REQUIRE(smallScalar.build({}, 3, 3, 0, 0, {}).status
        == cirvivor::core::FlowFieldStatus::inputTooSmall);
    REQUIRE(smallScalar.build(blocked, 3, 3, 0, 0, {}).status
        == cirvivor::core::FlowFieldStatus::outputTooSmall);

    bool threw = false;
    try {
        cirvivor::core::FlowFieldScalar invalid(
            static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max()) + 1U
        );
        static_cast<void>(invalid);
    } catch (const std::length_error&) {
        threw = true;
    }
    REQUIRE(threw);
}

[[nodiscard]] cirvivor::core::PreparedContactBody makeCircleBody(
    const double centerX,
    const double centerY,
    const double radius
) noexcept {
    return {
        .centerX = centerX,
        .centerY = centerY,
        .radius = radius
    };
}

[[nodiscard]] cirvivor::core::PreparedContactBody makePartBody(
    const std::uint32_t partStart,
    const std::uint32_t partCount
) noexcept {
    return {
        .centerX = 0.0,
        .centerY = 0.0,
        .radius = 1.0,
        .partStart = partStart,
        .partCount = partCount
    };
}

[[nodiscard]] cirvivor::core::PreparedContactPair makePair(
    const std::uint32_t bodyIndexA,
    const std::uint32_t bodyIndexB,
    const cirvivor::core::PreparedContactShape shapeA,
    const cirvivor::core::PreparedContactShape shapeB
) noexcept {
    return {
        .bodyIndexA = bodyIndexA,
        .bodyIndexB = bodyIndexB,
        .orderedShapeFlags = cirvivor::core::makePreparedContactShapeFlags(shapeA, shapeB)
    };
}

struct ContactGoldenInput final {
    std::array<cirvivor::core::PreparedContactBody, 14> bodies{};
    std::array<cirvivor::core::PreparedContactPart, 10> parts{};
    std::array<cirvivor::core::PreparedContactPair, 13> pairs{};
};

[[nodiscard]] ContactGoldenInput createContactGoldenInput() {
    using cirvivor::core::PreparedContactShape;
    ContactGoldenInput input;
    constexpr float tangent = std::bit_cast<float>(0x4174'cccdU);
    constexpr float epsilonRejected = std::bit_cast<float>(0x4174'ccccU);
    constexpr float epsilonAccepted = std::bit_cast<float>(0x4174'cccbU);

    input.bodies = {
        makeCircleBody(0.0, 0.0, 10.0),
        makeCircleBody(15.0, 0.0, 10.0),
        makeCircleBody(static_cast<double>(tangent), 0.0, 10.0),
        makeCircleBody(std::numeric_limits<double>::quiet_NaN(), 0.0, 10.0),
        makePartBody(0U, 2U),
        makeCircleBody(0.0, 100.0, 10.0),
        makePartBody(2U, 1U),
        makeCircleBody(static_cast<double>(epsilonRejected), 200.0, 10.0),
        makeCircleBody(static_cast<double>(epsilonAccepted), 200.0, 10.0),
        makePartBody(3U, 2U),
        makePartBody(5U, 2U),
        makePartBody(7U, 1U),
        makePartBody(8U, 1U),
        makePartBody(9U, 1U)
    };
    input.parts = {
        cirvivor::core::PreparedContactPart{
            std::numeric_limits<float>::quiet_NaN(), 0.0F, 10.0F
        },
        cirvivor::core::PreparedContactPart{0.0F, 100.0F, 10.0F},
        cirvivor::core::PreparedContactPart{0.0F, 200.0F, 10.0F},
        cirvivor::core::PreparedContactPart{0.0F, 300.0F, 10.0F},
        cirvivor::core::PreparedContactPart{1'000.0F, 300.0F, 10.0F},
        cirvivor::core::PreparedContactPart{tangent, 300.0F, 10.0F},
        cirvivor::core::PreparedContactPart{0.0F, 300.0F, 10.0F},
        cirvivor::core::PreparedContactPart{0.0F, 400.0F, 10.0F},
        cirvivor::core::PreparedContactPart{epsilonAccepted, 400.0F, 10.0F},
        cirvivor::core::PreparedContactPart{
            std::numeric_limits<float>::infinity(), 0.0F, 10.0F
        }
    };
    input.pairs = {
        makePair(0U, 1U, PreparedContactShape::circle, PreparedContactShape::circle),
        makePair(0U, 2U, PreparedContactShape::circle, PreparedContactShape::circle),
        makePair(0U, 3U, PreparedContactShape::circle, PreparedContactShape::circle),
        makePair(4U, 5U, PreparedContactShape::circleParts, PreparedContactShape::circle),
        makePair(5U, 4U, PreparedContactShape::circle, PreparedContactShape::circleParts),
        makePair(6U, 7U, PreparedContactShape::circleParts, PreparedContactShape::circle),
        makePair(6U, 8U, PreparedContactShape::circleParts, PreparedContactShape::circle),
        makePair(9U, 10U, PreparedContactShape::circleParts, PreparedContactShape::circleParts),
        makePair(10U, 9U, PreparedContactShape::circleParts, PreparedContactShape::circleParts),
        makePair(11U, 12U, PreparedContactShape::circleParts, PreparedContactShape::circleParts),
        makePair(13U, 0U, PreparedContactShape::circleParts, PreparedContactShape::circle),
        makePair(0U, 0U, PreparedContactShape::circle, PreparedContactShape::circle),
        makePair(4U, 4U, PreparedContactShape::circleParts, PreparedContactShape::circleParts)
    };
    return input;
}

void testPreparedContactWatGoldenAndOrder() {
    // Expected bytes come from collision-contact WAT SHA-256
    // 02f78ec05321a7981e0fbe24cf8a98dc30884d3cf468abadf720169de568c4dc.
    static_assert(
        std::bit_cast<std::uint64_t>(cirvivor::core::preparedContactRadiusScale)
        == 0x3fe8'7ae1'47ae'147bULL
    );
    using cirvivor::core::PreparedContactShape;
    REQUIRE(cirvivor::core::makePreparedContactShapeFlags(
        PreparedContactShape::circleParts,
        PreparedContactShape::circle
    ) == 1U);
    REQUIRE(cirvivor::core::makePreparedContactShapeFlags(
        PreparedContactShape::circle,
        PreparedContactShape::circleParts
    ) == 2U);

    ContactGoldenInput input = createContactGoldenInput();
    cirvivor::core::PreparedContactScalar scalar({14U, 10U, 13U});
    std::array<std::uint8_t, 13> actual{};
    constexpr std::array<std::uint8_t, 13> expected{
        1U, 0U, 0U, 1U, 1U, 0U, 1U,
        1U, 1U, 1U, 0U, 1U, 1U
    };

    allocation_probe::count = 0;
    allocation_probe::enabled = true;
    const auto status = scalar.scan(input.bodies, input.parts, input.pairs, actual);
    allocation_probe::enabled = false;
    REQUIRE(status == cirvivor::core::PreparedContactStatus::ok);
    REQUIRE(actual == expected);
    REQUIRE(allocation_probe::count == 0U);

    constexpr double radiusSum = 20.0 * cirvivor::core::preparedContactRadiusScale;
    constexpr double rejected = static_cast<double>(std::bit_cast<float>(0x4174'ccccU));
    constexpr double accepted = static_cast<double>(std::bit_cast<float>(0x4174'cccbU));
    static_assert(radiusSum - rejected <= cirvivor::core::preparedContactEpsilon);
    static_assert(radiusSum - accepted > cirvivor::core::preparedContactEpsilon);
}

void testPreparedContactValidationIsTransactional() {
    ContactGoldenInput input = createContactGoldenInput();
    cirvivor::core::PreparedContactScalar scalar({14U, 10U, 13U});
    std::array<std::uint8_t, 13> flags{};

    auto invalidPairs = input.pairs;
    invalidPairs[4].reserved = 1U;
    flags.fill(0xa5U);
    REQUIRE(scalar.scan(input.bodies, input.parts, invalidPairs, flags)
        == cirvivor::core::PreparedContactStatus::invalidPair);
    REQUIRE(flags.front() == 0xa5U && flags.back() == 0xa5U);

    invalidPairs = input.pairs;
    invalidPairs[4].orderedShapeFlags = 4U;
    REQUIRE(scalar.scan(input.bodies, input.parts, invalidPairs, flags)
        == cirvivor::core::PreparedContactStatus::invalidPair);

    invalidPairs = input.pairs;
    invalidPairs[4].bodyIndexB = 14U;
    REQUIRE(scalar.scan(input.bodies, input.parts, invalidPairs, flags)
        == cirvivor::core::PreparedContactStatus::invalidPair);

    auto invalidBodies = input.bodies;
    invalidBodies[4].partStart = 10U;
    invalidBodies[4].partCount = 1U;
    REQUIRE(scalar.scan(invalidBodies, input.parts, input.pairs, flags)
        == cirvivor::core::PreparedContactStatus::invalidPartSpan);
    REQUIRE(flags.front() == 0xa5U && flags.back() == 0xa5U);

    invalidBodies = input.bodies;
    invalidBodies[4].partStart = std::numeric_limits<std::uint32_t>::max();
    invalidBodies[4].partCount = std::numeric_limits<std::uint32_t>::max();
    REQUIRE(scalar.scan(invalidBodies, input.parts, input.pairs, flags)
        == cirvivor::core::PreparedContactStatus::invalidPartSpan);

    cirvivor::core::PreparedContactScalar small({14U, 10U, 12U});
    REQUIRE(small.scan(input.bodies, input.parts, input.pairs, flags)
        == cirvivor::core::PreparedContactStatus::capacityExceeded);
    REQUIRE(scalar.scan(input.bodies, input.parts, input.pairs, std::span(flags).first(12))
        == cirvivor::core::PreparedContactStatus::outputTooSmall);

    REQUIRE(scalar.scan({}, {}, {}, {}) == cirvivor::core::PreparedContactStatus::ok);

    bool threw = false;
    try {
        cirvivor::core::PreparedContactScalar invalid({
            static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max()) + 1U,
            0U,
            0U
        });
        static_cast<void>(invalid);
    } catch (const std::length_error&) {
        threw = true;
    }
    REQUIRE(threw);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"flow open-grid float32 golden", testFlowOpenGridFloat32Golden},
        TestCase{"flow WAT exhaustive/large golden suites", testFlowWatGoldenSuites},
        TestCase{"flow fixed-capacity validation", testFlowValidationAndNoTickAllocation},
        TestCase{"prepared contact WAT ordered flags", testPreparedContactWatGoldenAndOrder},
        TestCase{"prepared contact transactional validation", testPreparedContactValidationIsTransactional}
    };

    std::size_t passed = 0;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            allocation_probe::enabled = false;
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }
    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
