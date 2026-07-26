#pragma once

#include <cstddef>
#include <cstdint>
#include <span>

namespace cirvivor::core {

inline constexpr double preparedContactEpsilon = 1.0e-6;
inline constexpr double preparedContactRadiusScale = 0.9 * 0.85;

enum class PreparedContactShape : std::uint32_t {
    circle = 0,
    circleParts = 1
};

[[nodiscard]] constexpr std::uint32_t makePreparedContactShapeFlags(
    const PreparedContactShape shapeA,
    const PreparedContactShape shapeB
) noexcept {
    return static_cast<std::uint32_t>(shapeA)
        | (static_cast<std::uint32_t>(shapeB) << 1U);
}

// This layout intentionally mirrors the 32-byte trusted-private WAT body ABI.
struct PreparedContactBody final {
    double centerX = 0.0;
    double centerY = 0.0;
    double radius = 0.0;
    std::uint32_t partStart = 0;
    std::uint32_t partCount = 0;
};

// World-space aggregate circles are stored as native float32 triples.
struct PreparedContactPart final {
    float centerX = 0.0F;
    float centerY = 0.0F;
    float radius = 0.0F;
};

// orderedShapeFlags is shape(A) | (shape(B) << 1); reserved must remain zero.
struct PreparedContactPair final {
    std::uint32_t bodyIndexA = 0;
    std::uint32_t bodyIndexB = 0;
    std::uint32_t orderedShapeFlags = 0;
    std::uint32_t reserved = 0;
};

static_assert(sizeof(PreparedContactBody) == 32);
static_assert(offsetof(PreparedContactBody, centerX) == 0);
static_assert(offsetof(PreparedContactBody, centerY) == 8);
static_assert(offsetof(PreparedContactBody, radius) == 16);
static_assert(offsetof(PreparedContactBody, partStart) == 24);
static_assert(offsetof(PreparedContactBody, partCount) == 28);
static_assert(sizeof(PreparedContactPart) == 12);
static_assert(sizeof(PreparedContactPair) == 16);

struct PreparedContactLimits final {
    std::size_t maximumBodyCount = 0;
    std::size_t maximumPartCount = 0;
    std::size_t maximumPairCount = 0;
};

enum class PreparedContactStatus : std::uint8_t {
    ok,
    capacityExceeded,
    outputTooSmall,
    invalidPair,
    invalidPartSpan
};

// Allocation-free scalar reference for the prepared-hexa boolean contact WAT.
// Callers own fixed-capacity body/part/pair/result buffers; scan() only reads or
// writes the provided spans and preserves candidate order in the uint8 output.
class PreparedContactScalar final {
public:
    explicit PreparedContactScalar(PreparedContactLimits limits);

    [[nodiscard]] PreparedContactLimits limits() const noexcept;

    [[nodiscard]] PreparedContactStatus scan(
        std::span<const PreparedContactBody> bodies,
        std::span<const PreparedContactPart> parts,
        std::span<const PreparedContactPair> pairs,
        std::span<std::uint8_t> contactFlags
    ) const noexcept;

private:
    PreparedContactLimits limits_;
};

} // namespace cirvivor::core
