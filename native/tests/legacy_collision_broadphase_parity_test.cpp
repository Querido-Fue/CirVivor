#include "core/physics/collision_candidate_builder.h"
#include "core/physics/collision_spatial_grid.h"
#include "core/state_hash/canonical_state_hasher.h"
#include "generated/legacy_collision_first_solve_fixture.h"

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

class AllocationScope final {
public:
    AllocationScope() noexcept {
        allocation_probe::count = 0U;
        allocation_probe::enabled = true;
    }

    ~AllocationScope() {
        allocation_probe::enabled = false;
    }

    [[nodiscard]] std::size_t count() const noexcept {
        return allocation_probe::count;
    }
};

[[nodiscard]] std::uint8_t hexNibble(const char value) {
    if (value >= '0' && value <= '9') {
        return static_cast<std::uint8_t>(value - '0');
    }
    if (value >= 'a' && value <= 'f') {
        return static_cast<std::uint8_t>(value - 'a' + 10);
    }
    throw TestFailure("Generated fixture contains a non-hex character.");
}

[[nodiscard]] std::vector<std::uint8_t> decodeFixtureBytes() {
    const std::string_view hex =
        cirvivor::test::generated::legacyCollisionFirstSolveHex;
    REQUIRE((hex.size() % 2U) == 0U);
    REQUIRE(
        hex.size() / 2U
        == cirvivor::test::generated::legacyCollisionFirstSolveByteCount
    );
    std::vector<std::uint8_t> bytes(hex.size() / 2U);
    for (std::size_t index = 0U; index < bytes.size(); ++index) {
        bytes[index] = static_cast<std::uint8_t>(
            (hexNibble(hex[index * 2U]) << 4U)
            | hexNibble(hex[(index * 2U) + 1U])
        );
    }
    return bytes;
}

class FixtureReader final {
public:
    explicit FixtureReader(const std::span<const std::uint8_t> bytes) noexcept
        : bytes_(bytes) {}

    [[nodiscard]] std::uint8_t u8() {
        requireBytes(1U);
        return bytes_[cursor_++];
    }

    [[nodiscard]] std::uint32_t u32() {
        requireBytes(4U);
        std::uint32_t value = 0U;
        for (std::uint32_t shift = 0U; shift < 32U; shift += 8U) {
            value |= static_cast<std::uint32_t>(bytes_[cursor_++]) << shift;
        }
        return value;
    }

    [[nodiscard]] std::int32_t i32() {
        return std::bit_cast<std::int32_t>(u32());
    }

    [[nodiscard]] std::uint64_t u64() {
        requireBytes(8U);
        std::uint64_t value = 0U;
        for (std::uint32_t shift = 0U; shift < 64U; shift += 8U) {
            value |= static_cast<std::uint64_t>(bytes_[cursor_++]) << shift;
        }
        return value;
    }

    [[nodiscard]] std::int64_t i64() {
        return std::bit_cast<std::int64_t>(u64());
    }

    [[nodiscard]] float f32() {
        return std::bit_cast<float>(u32());
    }

    [[nodiscard]] double f64() {
        return std::bit_cast<double>(u64());
    }

    void expectBytes(const std::string_view expected) {
        requireBytes(expected.size());
        for (const char value : expected) {
            if (bytes_[cursor_++] != static_cast<std::uint8_t>(value)) {
                throw TestFailure("Generated fixture magic does not match.");
            }
        }
    }

    [[nodiscard]] bool atEnd() const noexcept {
        return cursor_ == bytes_.size();
    }

private:
    void requireBytes(const std::size_t count) const {
        if (count > bytes_.size() - cursor_) {
            throw TestFailure("Generated fixture is truncated.");
        }
    }

    std::span<const std::uint8_t> bytes_;
    std::size_t cursor_ = 0U;
};

constexpr std::size_t scalarCount = 34U;

struct FixtureBody final {
    std::int32_t slot = -1;
    std::int32_t id = -1;
    std::int32_t referenceToken = -1;
    std::uint8_t referenceType = 0U;
    std::uint8_t kind = 0U;
    std::uint8_t shape = 0U;
    std::uint8_t flags = 0U;
    std::uint32_t circlePartCount = 0U;
    std::vector<float> circleParts;
    std::array<double, scalarCount> scalars{};
};

struct FixtureCell final {
    std::int64_t key = 0;
    std::vector<std::int32_t> indices;
};

struct Fixture final {
    std::uint32_t gridFixedFrameToken = 0U;
    std::uint8_t gridMode = 0U;
    bool gridDataOnly = false;
    std::uint32_t cellSize = 0U;
    std::uint32_t gridBodyCount = 0U;
    std::vector<FixtureBody> bodies;
    std::vector<cirvivor::core::CollisionPreparedBody> preparedBodies;
    std::vector<float> broad;
    std::vector<std::uint8_t> bodyKind;
    std::vector<std::uint8_t> bodyShape;
    std::vector<double> relation;
    std::vector<double> candidateSweep;
    std::vector<std::uint8_t> candidateSweepValidity;
    std::vector<FixtureCell> gridCells;
    std::uint32_t candidateFixedFrameToken = 0U;
    std::uint32_t candidateScanEpoch = 0U;
    std::uint32_t nextCandidateScanEpoch = 0U;
    std::uint32_t cellScanToken = 0U;
    std::vector<std::int32_t> bodyIds;
    std::vector<cirvivor::core::CollisionCandidatePair> priorityPairs;
    std::vector<cirvivor::core::CollisionCandidatePair> normalPairs;
    std::vector<cirvivor::core::CollisionCandidateFairness> fairness;
    cirvivor::core::CollisionCandidateCounters counters{};
};

template <typename Value, typename ReadValue>
[[nodiscard]] std::vector<Value> readVector(
    FixtureReader& reader,
    ReadValue readValue
) {
    const std::size_t count = reader.u32();
    std::vector<Value> values(count);
    for (Value& value : values) {
        value = readValue(reader);
    }
    return values;
}

[[nodiscard]] cirvivor::core::CollisionPreparedBody prepareBody(
    const FixtureBody& body
) noexcept {
    const auto& value = body.scalars;
    cirvivor::core::CollisionPreparedBody prepared;
    prepared.id = body.id;
    prepared.referenceToken = body.referenceToken;
    prepared.kind = static_cast<cirvivor::core::CollisionBodyKind>(body.kind);
    prepared.shape = static_cast<cirvivor::core::CollisionBodyShape>(body.shape);
    prepared.hasReference = body.referenceToken >= 0;
    prepared.hexaHive = body.referenceType == 2U;
    prepared.circlePartCount = body.circlePartCount;
    prepared.x = value[0];
    prepared.y = value[1];
    prepared.centerX = value[2];
    prepared.centerY = value[3];
    prepared.minX = value[4];
    prepared.maxX = value[5];
    prepared.minY = value[6];
    prepared.maxY = value[7];
    prepared.sweepMinX = value[8];
    prepared.sweepMaxX = value[9];
    prepared.sweepMinY = value[10];
    prepared.sweepMaxY = value[11];
    prepared.enemyPairMinX = value[12];
    prepared.enemyPairMaxX = value[13];
    prepared.enemyPairMinY = value[14];
    prepared.enemyPairMaxY = value[15];
    prepared.projectileMinX = value[16];
    prepared.projectileMaxX = value[17];
    prepared.projectileMinY = value[18];
    prepared.projectileMaxY = value[19];
    prepared.radius = value[20];
    prepared.boundRadius = value[21];
    prepared.broadRadius = value[22];
    prepared.enemyPairBroadRadius = value[23];
    prepared.projectileBroadRadius = value[24];
    prepared.resolveRadius = value[25];
    return prepared;
}

[[nodiscard]] Fixture readFixture() {
    const std::vector<std::uint8_t> bytes = decodeFixtureBytes();
    FixtureReader reader(bytes);
    reader.expectBytes("LCFSV001");
    Fixture fixture;
    fixture.gridFixedFrameToken = reader.u32();
    fixture.gridMode = reader.u8();
    fixture.gridDataOnly = reader.u8() != 0U;
    fixture.cellSize = reader.u32();
    fixture.gridBodyCount = reader.u32();
    const std::size_t bodyCount = reader.u32();
    fixture.bodies.resize(bodyCount);
    fixture.preparedBodies.resize(bodyCount);
    for (std::size_t index = 0U; index < bodyCount; ++index) {
        FixtureBody& body = fixture.bodies[index];
        body.slot = reader.i32();
        body.id = reader.i32();
        body.referenceToken = reader.i32();
        body.referenceType = reader.u8();
        body.kind = reader.u8();
        body.shape = reader.u8();
        body.flags = reader.u8();
        body.circlePartCount = reader.u32();
        if (reader.u8() != 0U) {
            body.circleParts = readVector<float>(
                reader,
                [](FixtureReader& input) { return input.f32(); }
            );
        }
        for (double& scalar : body.scalars) {
            scalar = reader.f64();
        }
        fixture.preparedBodies[index] = prepareBody(body);
    }

    fixture.broad = readVector<float>(
        reader,
        [](FixtureReader& input) { return input.f32(); }
    );
    fixture.bodyKind = readVector<std::uint8_t>(
        reader,
        [](FixtureReader& input) { return input.u8(); }
    );
    fixture.bodyShape = readVector<std::uint8_t>(
        reader,
        [](FixtureReader& input) { return input.u8(); }
    );
    fixture.relation = readVector<double>(
        reader,
        [](FixtureReader& input) { return input.f64(); }
    );
    fixture.candidateSweep = readVector<double>(
        reader,
        [](FixtureReader& input) { return input.f64(); }
    );
    fixture.candidateSweepValidity = readVector<std::uint8_t>(
        reader,
        [](FixtureReader& input) { return input.u8(); }
    );

    fixture.gridCells.resize(reader.u32());
    for (FixtureCell& cell : fixture.gridCells) {
        cell.key = reader.i64();
        cell.indices = readVector<std::int32_t>(
            reader,
            [](FixtureReader& input) { return input.i32(); }
        );
    }

    fixture.candidateFixedFrameToken = reader.u32();
    fixture.candidateScanEpoch = reader.u32();
    fixture.nextCandidateScanEpoch = reader.u32();
    fixture.cellScanToken = reader.u32();
    fixture.bodyIds = readVector<std::int32_t>(
        reader,
        [](FixtureReader& input) { return input.i32(); }
    );
    for (std::vector<cirvivor::core::CollisionCandidatePair>* const pairs : {
        &fixture.priorityPairs,
        &fixture.normalPairs
    }) {
        pairs->resize(reader.u32());
        for (cirvivor::core::CollisionCandidatePair& pair : *pairs) {
            pair.low = reader.i32();
            pair.high = reader.i32();
        }
    }

    fixture.fairness.resize(reader.u32());
    for (cirvivor::core::CollisionCandidateFairness& item : fixture.fairness) {
        item.low = reader.i32();
        item.enemyId = reader.i32();
        item.visitLimit = reader.u32();
        item.cellCount = reader.u32();
        item.cellScanToken = reader.u32();
        item.cellStart = reader.u32();
        item.bucketScanToken = reader.u32();
    }
    fixture.counters.guaranteedPairCount = reader.u32();
    fixture.counters.priorityAdmissionCount = reader.u32();
    fixture.counters.predictiveAdmissionCount = reader.u32();
    fixture.counters.admissionBudgetSkipCount = reader.u32();
    fixture.counters.candidateVisitCount = reader.u32();
    fixture.counters.scanTruncateCount = reader.u32();
    fixture.counters.bucketPairCount = reader.u32();
    fixture.counters.duplicatePairSkipCount = reader.u32();
    fixture.counters.ruleRejectCount = reader.u32();
    fixture.counters.candidatePairCount = reader.u32();
    REQUIRE(reader.atEnd());
    return fixture;
}

[[nodiscard]] std::string_view kindName(const std::uint8_t code) {
    constexpr std::array names{
        std::string_view(""),
        std::string_view("enemy"),
        std::string_view("player"),
        std::string_view("wall"),
        std::string_view("projectile"),
        std::string_view("item")
    };
    return names.at(code);
}

[[nodiscard]] std::string_view shapeName(const std::uint8_t code) {
    constexpr std::array names{
        std::string_view(""),
        std::string_view("circle"),
        std::string_view("circleParts"),
        std::string_view("rect")
    };
    return names.at(code);
}

void appendFloatValues(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const std::span<const float> values
) {
    hasher.beginArray(values.size());
    for (const float value : values) {
        hasher.appendNumber(static_cast<double>(value));
    }
    hasher.endArray();
}

void appendDoubleValues(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const std::span<const double> values
) {
    hasher.beginArray(values.size());
    for (const double value : values) {
        hasher.appendNumber(value);
    }
    hasher.endArray();
}

void appendByteValues(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const std::span<const std::uint8_t> values
) {
    hasher.beginArray(values.size());
    for (const std::uint8_t value : values) {
        hasher.appendNumber(static_cast<double>(value));
    }
    hasher.endArray();
}

template <typename AppendValues>
void appendPlane(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const std::string_view rawEncoding,
    const std::string_view rawSha256,
    const std::size_t stride,
    const std::string_view type,
    AppendValues appendValues
) {
    hasher.beginObject(5U);
    hasher.appendObjectKey("rawEncoding");
    hasher.appendString(rawEncoding);
    hasher.appendObjectKey("rawSha256");
    hasher.appendString(rawSha256);
    hasher.appendObjectKey("stride");
    hasher.appendNumber(static_cast<double>(stride));
    hasher.appendObjectKey("type");
    hasher.appendString(type);
    hasher.appendObjectKey("values");
    appendValues();
    hasher.endObject();
}

void appendBodyScalars(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const FixtureBody& body
) {
    constexpr std::array<std::string_view, scalarCount> keys{
        "_candidatePairCount", "_frameResolveMax", "_frameResolveMoved",
        "_passPairProcessCount", "_resolvedPairCount", "boundRadius",
        "broadRadius", "centerX", "centerY", "enemyPairBroadRadius",
        "enemyPairMaxX", "enemyPairMaxY", "enemyPairMinX", "enemyPairMinY",
        "maxX", "maxY", "minX", "minY", "projectileBroadRadius",
        "projectileMaxX", "projectileMaxY", "projectileMinX", "projectileMinY",
        "radius", "resolveRadius", "sweepMaxX", "sweepMaxY", "sweepMinX",
        "sweepMinY", "velocityX", "velocityY", "weight", "x", "y"
    };
    constexpr std::array<std::size_t, scalarCount> indices{
        31U, 30U, 29U, 33U, 32U, 21U, 22U, 2U, 3U, 23U, 13U, 15U,
        12U, 14U, 5U, 7U, 4U, 6U, 24U, 17U, 19U, 16U, 18U, 20U, 25U,
        9U, 11U, 8U, 10U, 26U, 27U, 28U, 0U, 1U
    };
    hasher.beginObject(keys.size());
    for (std::size_t index = 0U; index < keys.size(); ++index) {
        hasher.appendObjectKey(keys[index]);
        const double value = body.scalars[indices[index]];
        if (std::isfinite(value)) {
            hasher.appendNumber(value);
        } else {
            hasher.appendNull();
        }
    }
    hasher.endObject();
}

void appendBody(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const FixtureBody& body
) {
    hasher.beginObject(13U);
    hasher.appendObjectKey("circlePartCount");
    hasher.appendNumber(static_cast<double>(body.circlePartCount));
    hasher.appendObjectKey("circleParts");
    if (body.circleParts.empty()) {
        hasher.appendNull();
    } else {
        appendPlane(
            hasher,
            "ieee754-f32be",
            "3767dee81d87ef68cb8f4dd2eba5e1bd28b00bf10181281cb98843c27c061064",
            3U,
            "Float32Array",
            [&hasher, &body]() { appendFloatValues(hasher, body.circleParts); }
        );
    }
    hasher.appendObjectKey("id");
    hasher.appendNumber(static_cast<double>(body.id));
    hasher.appendObjectKey("kind");
    hasher.appendString(kindName(body.kind));
    hasher.appendObjectKey("mergeLock");
    hasher.appendBoolean((body.flags & 2U) != 0U);
    hasher.appendObjectKey("movable");
    hasher.appendBoolean((body.flags & 1U) != 0U);
    hasher.appendObjectKey("refToken");
    hasher.appendNumber(static_cast<double>(body.referenceToken));
    hasher.appendObjectKey("refType");
    if (body.referenceType == 0U) {
        hasher.appendNull();
    } else {
        hasher.appendString(body.referenceType == 1U ? "square" : "hexa_hive");
    }
    hasher.appendObjectKey("scalars");
    appendBodyScalars(hasher, body);
    hasher.appendObjectKey("shape");
    hasher.appendString(shapeName(body.shape));
    hasher.appendObjectKey("sleepObservationIncomplete");
    hasher.appendBoolean((body.flags & 8U) != 0U);
    hasher.appendObjectKey("sleeping");
    hasher.appendBoolean((body.flags & 4U) != 0U);
    hasher.appendObjectKey("slot");
    hasher.appendNumber(static_cast<double>(body.slot));
    hasher.endObject();
}

[[nodiscard]] std::uint64_t hashGridEvent(
    const Fixture& fixture,
    const cirvivor::core::CollisionSpatialGrid& grid
) {
    cirvivor::core::CanonicalStateHasher64 hasher;
    hasher.beginObject(9U);
    hasher.appendObjectKey("bodies");
    hasher.beginArray(fixture.bodies.size());
    for (const FixtureBody& body : fixture.bodies) {
        appendBody(hasher, body);
    }
    hasher.endArray();
    hasher.appendObjectKey("cellSize");
    hasher.appendNumber(static_cast<double>(grid.activeBuild().cellSize));
    hasher.appendObjectKey("fixedFrameToken");
    hasher.appendNumber(static_cast<double>(fixture.gridFixedFrameToken));
    hasher.appendObjectKey("gridBodyCount");
    hasher.appendNumber(static_cast<double>(grid.activeBuild().gridBodyCount));
    hasher.appendObjectKey("gridCells");
    hasher.beginArray(grid.activeBuild().cellCount);
    for (std::size_t cellIndex = 0U; cellIndex < grid.activeBuild().cellCount; ++cellIndex) {
        hasher.beginArray(2U);
        hasher.appendNumber(static_cast<double>(grid.cellKey(cellIndex)));
        const std::span<const std::int32_t> indices = grid.cellBodies(cellIndex);
        hasher.beginArray(indices.size());
        for (const std::int32_t index : indices) {
            hasher.appendNumber(static_cast<double>(index));
        }
        hasher.endArray();
        hasher.endArray();
    }
    hasher.endArray();
    hasher.appendObjectKey("gridDataOnly");
    hasher.appendBoolean(fixture.gridDataOnly);
    hasher.appendObjectKey("gridMode");
    hasher.appendString(fixture.gridMode == 0U ? "default" : "invalid");
    hasher.appendObjectKey("planes");
    hasher.beginObject(6U);
    hasher.appendObjectKey("bodyKind");
    appendPlane(
        hasher, "u8",
        "558445598fe993a08617efcde23575cfc125f0155bb93cf0dc5aa31577c0975f",
        1U, "Uint8Array",
        [&hasher, &fixture]() { appendByteValues(hasher, fixture.bodyKind); }
    );
    hasher.appendObjectKey("bodyShape");
    appendPlane(
        hasher, "u8",
        "180f3fc65783394a3bd879bb07b2a16e1dd592d06e188c8b58ecd3d2cf062295",
        1U, "Uint8Array",
        [&hasher, &fixture]() { appendByteValues(hasher, fixture.bodyShape); }
    );
    hasher.appendObjectKey("broad");
    appendPlane(
        hasher, "ieee754-f32be",
        "a426088b934eae408e951f907ca8be5acdb922569da89d45c916338b99745145",
        14U, "Float32Array",
        [&hasher, &fixture]() { appendFloatValues(hasher, fixture.broad); }
    );
    hasher.appendObjectKey("candidateSweep");
    appendPlane(
        hasher, "ieee754-f64be",
        "9644f834b78f82f4a0a257db57c044cbf9e840a128b1ccd0cbd15a4b7c258634",
        8U, "Float64Array",
        [&hasher, &fixture]() { appendDoubleValues(hasher, fixture.candidateSweep); }
    );
    hasher.appendObjectKey("candidateSweepValidity");
    appendPlane(
        hasher, "u8",
        "235335175b5ae7af09bcc448ea62dfc70ec9c20578e4833e954c099756fb7677",
        1U, "Uint8Array",
        [&hasher, &fixture]() {
            appendByteValues(hasher, fixture.candidateSweepValidity);
        }
    );
    hasher.appendObjectKey("relation");
    appendPlane(
        hasher, "ieee754-f64be",
        "ef62ae1f918f7b74e9842822aafb25659b7ef239bb2c07b816f75ff6a42f9907",
        8U, "Float64Array",
        [&hasher, &fixture]() { appendDoubleValues(hasher, fixture.relation); }
    );
    hasher.endObject();
    hasher.appendObjectKey("type");
    hasher.appendString("gridRebuild");
    hasher.endObject();
    return hasher.value();
}

void appendPairs(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const std::span<const cirvivor::core::CollisionCandidatePair> pairs
) {
    hasher.beginArray(pairs.size());
    for (const auto& pair : pairs) {
        hasher.beginArray(2U);
        hasher.appendNumber(static_cast<double>(pair.low));
        hasher.appendNumber(static_cast<double>(pair.high));
        hasher.endArray();
    }
    hasher.endArray();
}

void appendCandidateCounters(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const cirvivor::core::CollisionCandidateCounters& counters
) {
    hasher.beginObject(10U);
    hasher.appendObjectKey("admissionBudgetSkipCount");
    hasher.appendNumber(counters.admissionBudgetSkipCount);
    hasher.appendObjectKey("bucketPairCount");
    hasher.appendNumber(counters.bucketPairCount);
    hasher.appendObjectKey("candidatePairCount");
    hasher.appendNumber(counters.candidatePairCount);
    hasher.appendObjectKey("candidateVisitCount");
    hasher.appendNumber(counters.candidateVisitCount);
    hasher.appendObjectKey("duplicatePairSkipCount");
    hasher.appendNumber(counters.duplicatePairSkipCount);
    hasher.appendObjectKey("guaranteedPairCount");
    hasher.appendNumber(counters.guaranteedPairCount);
    hasher.appendObjectKey("predictiveAdmissionCount");
    hasher.appendNumber(counters.predictiveAdmissionCount);
    hasher.appendObjectKey("priorityAdmissionCount");
    hasher.appendNumber(counters.priorityAdmissionCount);
    hasher.appendObjectKey("ruleRejectCount");
    hasher.appendNumber(counters.ruleRejectCount);
    hasher.appendObjectKey("scanTruncateCount");
    hasher.appendNumber(counters.scanTruncateCount);
    hasher.endObject();
}

[[nodiscard]] std::uint64_t hashCandidateEvent(
    const Fixture& fixture,
    const cirvivor::core::CollisionCandidateBuilder& builder
) {
    const auto& result = builder.activeBuild();
    cirvivor::core::CanonicalStateHasher64 hasher;
    hasher.beginObject(10U);
    hasher.appendObjectKey("bodyIds");
    hasher.beginArray(fixture.bodyIds.size());
    for (const std::int32_t id : fixture.bodyIds) {
        hasher.appendNumber(static_cast<double>(id));
    }
    hasher.endArray();
    hasher.appendObjectKey("candidateScanEpoch");
    hasher.appendNumber(result.candidateScanEpoch);
    hasher.appendObjectKey("cellScanToken");
    hasher.appendNumber(result.cellScanToken);
    hasher.appendObjectKey("counters");
    appendCandidateCounters(hasher, result.counters);
    hasher.appendObjectKey("fairness");
    hasher.beginArray(builder.fairness().size());
    for (const auto& item : builder.fairness()) {
        hasher.beginObject(7U);
        hasher.appendObjectKey("bucketScanToken");
        hasher.appendNumber(item.bucketScanToken);
        hasher.appendObjectKey("cellCount");
        hasher.appendNumber(static_cast<double>(item.cellCount));
        hasher.appendObjectKey("cellScanToken");
        hasher.appendNumber(item.cellScanToken);
        hasher.appendObjectKey("cellStart");
        hasher.appendNumber(static_cast<double>(item.cellStart));
        hasher.appendObjectKey("enemyId");
        hasher.appendNumber(item.enemyId);
        hasher.appendObjectKey("low");
        hasher.appendNumber(item.low);
        hasher.appendObjectKey("visitLimit");
        hasher.appendNumber(item.visitLimit);
        hasher.endObject();
    }
    hasher.endArray();
    hasher.appendObjectKey("fixedFrameToken");
    hasher.appendNumber(fixture.candidateFixedFrameToken);
    hasher.appendObjectKey("nextCandidateScanEpoch");
    hasher.appendNumber(result.nextCandidateScanEpoch);
    hasher.appendObjectKey("normalPairs");
    appendPairs(hasher, builder.normalPairs());
    hasher.appendObjectKey("priorityPairs");
    appendPairs(hasher, builder.priorityPairs());
    hasher.appendObjectKey("type");
    hasher.appendString("candidateBuild");
    hasher.endObject();
    return hasher.value();
}

template <typename Value>
void requireEqualSpans(
    const std::span<const Value> actual,
    const std::span<const Value> expected
) {
    REQUIRE(actual.size() == expected.size());
    for (std::size_t index = 0U; index < actual.size(); ++index) {
        REQUIRE(actual[index] == expected[index]);
    }
}

void testLegacyCollisionBroadphaseFirstSolveParity() {
    Fixture fixture = readFixture();
    REQUIRE(fixture.bodies.size() == 52U);
    REQUIRE(fixture.gridBodyCount == 50U);
    REQUIRE(fixture.gridCells.size() == 32U);
    REQUIRE(fixture.priorityPairs.size() == 503U);
    REQUIRE(fixture.normalPairs.size() == 16U);
    REQUIRE(fixture.fairness.size() == 49U);

    cirvivor::core::CollisionSpatialGrid grid({
        .bodyCapacity = 52U,
        .cellCapacity = 64U,
        .membershipCapacity = 256U,
        .hashSlotCount = 128U
    });
    cirvivor::core::CollisionCandidateBuilder builder({
        .bodyCapacity = 52U,
        .priorityPairCapacity = 503U,
        .normalPairCapacity = 16U,
        .fairnessCapacity = 49U
    });
    const cirvivor::core::CollisionCandidatePlanes planes{
        .broad = fixture.broad,
        .candidateSweep = fixture.candidateSweep,
        .candidateSweepValidity = fixture.candidateSweepValidity,
        .bodyKind = fixture.bodyKind,
        .bodyShape = fixture.bodyShape
    };

    cirvivor::core::CollisionSpatialGridBuildResult gridResult;
    cirvivor::core::CollisionCandidateBuildResult candidateResult;
    std::size_t allocationCount = 0U;
    {
        AllocationScope allocationScope;
        gridResult = grid.buildDefault(
            fixture.preparedBodies,
            fixture.broad,
            fixture.gridBodyCount
        );
        candidateResult = builder.build(
            fixture.preparedBodies,
            planes,
            fixture.gridBodyCount,
            grid,
            fixture.candidateScanEpoch
        );
        allocationCount = allocationScope.count();
    }

    REQUIRE(allocationCount == 0U);
    REQUIRE(gridResult.status == cirvivor::core::CollisionBuildStatus::ok);
    REQUIRE(gridResult.cellSize == static_cast<std::int32_t>(fixture.cellSize));
    REQUIRE(gridResult.cellCount == fixture.gridCells.size());
    REQUIRE(candidateResult.status == cirvivor::core::CollisionBuildStatus::ok);
    REQUIRE(candidateResult.candidateScanEpoch == fixture.candidateScanEpoch);
    REQUIRE(candidateResult.nextCandidateScanEpoch == fixture.nextCandidateScanEpoch);
    REQUIRE(candidateResult.cellScanToken == fixture.cellScanToken);
    REQUIRE(candidateResult.counters == fixture.counters);

    for (std::size_t index = 0U; index < fixture.gridCells.size(); ++index) {
        REQUIRE(grid.cellKey(index) == fixture.gridCells[index].key);
        requireEqualSpans<std::int32_t>(grid.cellBodies(index), fixture.gridCells[index].indices);
    }
    requireEqualSpans<cirvivor::core::CollisionCandidatePair>(
        builder.priorityPairs(),
        fixture.priorityPairs
    );
    requireEqualSpans<cirvivor::core::CollisionCandidatePair>(
        builder.normalPairs(),
        fixture.normalPairs
    );
    requireEqualSpans<cirvivor::core::CollisionCandidateFairness>(
        builder.fairness(),
        fixture.fairness
    );

    const std::uint64_t gridHash = hashGridEvent(fixture, grid);
    const std::uint64_t candidateHash = hashCandidateEvent(fixture, builder);
    std::cout << "[INFO] grid=" << std::hex << gridHash
              << " candidate=" << candidateHash << std::dec
              << " cells=" << gridResult.cellCount
              << " priority=" << candidateResult.priorityPairCount
              << " normal=" << candidateResult.normalPairCount
              << " allocations=" << allocationCount << '\n';
    REQUIRE(gridHash == 0x4387'5838'75b6'0d1aULL);
    REQUIRE(candidateHash == 0x1d9a'1870'5563'28dcULL);

    const auto publishedGridResult = grid.activeBuild();
    const std::int64_t publishedFirstKey = grid.cellKey(0U);
    std::vector<float> oversizedBroad = fixture.broad;
    oversizedBroad[0] = -10'000.0F;
    oversizedBroad[1] = 10'000.0F;
    oversizedBroad[2] = -10'000.0F;
    oversizedBroad[3] = 10'000.0F;
    const auto failedGridResult = grid.buildDefault(
        fixture.preparedBodies,
        oversizedBroad,
        fixture.gridBodyCount
    );
    REQUIRE(failedGridResult.status == cirvivor::core::CollisionBuildStatus::capacityExceeded);
    REQUIRE(grid.activeBuild().cellCount == publishedGridResult.cellCount);
    REQUIRE(grid.cellKey(0U) == publishedFirstKey);

    const auto publishedCandidateResult = builder.activeBuild();
    const auto publishedFirstPair = builder.priorityPairs().front();
    std::vector<cirvivor::core::CollisionPreparedBody> expandedBodies = fixture.preparedBodies;
    auto& wall = expandedBodies.back();
    wall.minX = -10'000.0;
    wall.maxX = 10'000.0;
    wall.minY = -10'000.0;
    wall.maxY = 10'000.0;
    wall.sweepMinX = wall.minX;
    wall.sweepMaxX = wall.maxX;
    wall.sweepMinY = wall.minY;
    wall.sweepMaxY = wall.maxY;
    wall.centerX = 200.0;
    wall.centerY = 200.0;
    wall.boundRadius = 20'000.0;
    wall.broadRadius = 20'000.0;
    const auto failedCandidateResult = builder.build(
        expandedBodies,
        planes,
        fixture.gridBodyCount,
        grid,
        fixture.candidateScanEpoch
    );
    REQUIRE(
        failedCandidateResult.status
        == cirvivor::core::CollisionBuildStatus::capacityExceeded
    );
    REQUIRE(
        failedCandidateResult.nextCandidateScanEpoch
        == fixture.candidateScanEpoch
    );
    REQUIRE(
        builder.activeBuild().priorityPairCount
        == publishedCandidateResult.priorityPairCount
    );
    REQUIRE(builder.priorityPairs().front() == publishedFirstPair);
}

} // namespace

int main() {
    try {
        testLegacyCollisionBroadphaseFirstSolveParity();
        std::cout << "[PASS] legacy collision broadphase first-solve parity\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "[FAIL] legacy collision broadphase first-solve parity: "
                  << error.what() << '\n';
        return 1;
    }
}
