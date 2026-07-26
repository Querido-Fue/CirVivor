#include "core/physics/collision_narrowphase.h"

#include <algorithm>
#include <array>
#include <bit>
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

using cirvivor::core::CollisionBodyKind;
using cirvivor::core::CollisionBodyShape;
using cirvivor::core::CollisionNarrowphaseBody;
using cirvivor::core::CollisionNarrowphaseLimits;
using cirvivor::core::CollisionNarrowphaseManifold;
using cirvivor::core::CollisionNarrowphasePair;
using cirvivor::core::CollisionNarrowphasePart;
using cirvivor::core::CollisionNarrowphaseScalar;
using cirvivor::core::CollisionNarrowphaseStatus;

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

[[nodiscard]] constexpr double f64(const std::uint64_t bits) noexcept {
    return std::bit_cast<double>(bits);
}

[[nodiscard]] constexpr float f32(const std::uint32_t bits) noexcept {
    return std::bit_cast<float>(bits);
}

struct GoldenInput final {
    std::array<CollisionNarrowphaseBody, 28> bodies{};
    std::array<CollisionNarrowphasePart, 17> parts{};
    std::array<CollisionNarrowphasePair, 27> pairs{};
};

[[nodiscard]] GoldenInput createGoldenInput() noexcept {
    GoldenInput input;
    input.bodies = {
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circle,
            .partStart = 0U,
            .partCount = 0U,
            .centerX = f64(0x0000000000000000ULL),
            .centerY = f64(0x0000000000000000ULL),
            .radius = f64(0x4024000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circle,
            .partStart = 0U,
            .partCount = 0U,
            .centerX = f64(0x4028000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x4024000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circle,
            .partStart = 0U,
            .partCount = 0U,
            .centerX = f64(0x402e99999999999aULL),
            .centerY = f64(0x0000000000000000ULL),
            .radius = f64(0x4024000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 0U,
            .partCount = 0U,
            .centerX = f64(0x4014000000000000ULL),
            .centerY = f64(0xc008000000000000ULL),
            .radius = f64(0x4010000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 0U,
            .partCount = 0U,
            .centerX = f64(0x4014000000000000ULL),
            .centerY = f64(0xc008000000000000ULL),
            .radius = f64(0x4010000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 0U,
            .partCount = 0U,
            .centerX = f64(0x7ff8000000000001ULL),
            .centerY = f64(0x0000000000000000ULL),
            .radius = f64(0x4010000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circleParts,
            .partStart = 0U,
            .partCount = 3U,
            .centerX = f64(0x0000000000000000ULL),
            .centerY = f64(0x0000000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circle,
            .partStart = 3U,
            .partCount = 0U,
            .centerX = f64(0x0000000000000000ULL),
            .centerY = f64(0x4010000000000000ULL),
            .radius = f64(0x401c000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circleParts,
            .partStart = 3U,
            .partCount = 2U,
            .centerX = f64(0x0000000000000000ULL),
            .centerY = f64(0x0000000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circleParts,
            .partStart = 5U,
            .partCount = 2U,
            .centerX = f64(0x0000000000000000ULL),
            .centerY = f64(0x4010000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circleParts,
            .partStart = 7U,
            .partCount = 1U,
            .centerX = f64(0x0000000000000000ULL),
            .centerY = f64(0x0000000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4000000000000000ULL),
            .centerY = f64(0x4000000000000000ULL),
            .radius = f64(0x4014000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::wall,
            .shape = CollisionBodyShape::rect,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4014000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x4024000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x4024000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::wall,
            .shape = CollisionBodyShape::rect,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4014000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x7ff8000000000002ULL),
            .maxX = f64(0x4024000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x4024000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4028000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x4008000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4026000000000000ULL),
            .centerY = f64(0x4026000000000000ULL),
            .radius = f64(0x4000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x402a000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x4008000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x3ff0000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x4000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4022000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x4000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4014000000000000ULL),
            .centerY = f64(0x3ff0000000000000ULL),
            .radius = f64(0x4000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4014000000000000ULL),
            .centerY = f64(0x4022000000000000ULL),
            .radius = f64(0x4000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x4014000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x4000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0x3ff0000000000000ULL),
            .centerY = f64(0x3ff0000000000000ULL),
            .radius = f64(0x4000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0xbf40624dd2f1a9fcULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x3ff0000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::player,
            .shape = CollisionBodyShape::circle,
            .partStart = 8U,
            .partCount = 0U,
            .centerX = f64(0xbf5205bc01a36e2fULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x3ff0000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circleParts,
            .partStart = 8U,
            .partCount = 6U,
            .centerX = f64(0x4008000000000000ULL),
            .centerY = f64(0x4014000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::enemy,
            .shape = CollisionBodyShape::circleParts,
            .partStart = 14U,
            .partCount = 3U,
            .centerX = f64(0x0000000000000000ULL),
            .centerY = f64(0x0000000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x0000000000000000ULL),
            .maxX = f64(0x0000000000000000ULL),
            .minY = f64(0x0000000000000000ULL),
            .maxY = f64(0x0000000000000000ULL)
        },
        CollisionNarrowphaseBody{
            .kind = CollisionBodyKind::wall,
            .shape = CollisionBodyShape::rect,
            .partStart = 17U,
            .partCount = 0U,
            .centerX = f64(0x4039000000000000ULL),
            .centerY = f64(0x4039000000000000ULL),
            .radius = f64(0x0000000000000000ULL),
            .minX = f64(0x4034000000000000ULL),
            .maxX = f64(0x403e000000000000ULL),
            .minY = f64(0x4034000000000000ULL),
            .maxY = f64(0x403e000000000000ULL)
        }
    };
    input.parts = {
        CollisionNarrowphasePart{
            f32(0x7fc00001U),
            f32(0x00000000U),
            f32(0x40c00000U)
        },
        CollisionNarrowphasePart{
            f32(0xc0800000U),
            f32(0x00000000U),
            f32(0x40c00000U)
        },
        CollisionNarrowphasePart{
            f32(0x40800000U),
            f32(0x00000000U),
            f32(0x40c00000U)
        },
        CollisionNarrowphasePart{
            f32(0xc0400000U),
            f32(0x00000000U),
            f32(0x40a00000U)
        },
        CollisionNarrowphasePart{
            f32(0x40400000U),
            f32(0x00000000U),
            f32(0x40a00000U)
        },
        CollisionNarrowphasePart{
            f32(0xc0400000U),
            f32(0x40800000U),
            f32(0x40a00000U)
        },
        CollisionNarrowphasePart{
            f32(0x40400000U),
            f32(0x40800000U),
            f32(0x40a00000U)
        },
        CollisionNarrowphasePart{
            f32(0x40000000U),
            f32(0x40000000U),
            f32(0x40a00000U)
        },
        CollisionNarrowphasePart{
            f32(0x7fc00003U),
            f32(0x00000000U),
            f32(0x3f800000U)
        },
        CollisionNarrowphasePart{
            f32(0xbf800000U),
            f32(0x40a00000U),
            f32(0x40000000U)
        },
        CollisionNarrowphasePart{
            f32(0x3f800000U),
            f32(0x40a00000U),
            f32(0x40000000U)
        },
        CollisionNarrowphasePart{
            f32(0x40a00000U),
            f32(0x3f800000U),
            f32(0x40000000U)
        },
        CollisionNarrowphasePart{
            f32(0x40a00000U),
            f32(0x41100000U),
            f32(0x40000000U)
        },
        CollisionNarrowphasePart{
            f32(0x41400000U),
            f32(0x40a00000U),
            f32(0x40400000U)
        },
        CollisionNarrowphasePart{
            f32(0x7fc00004U),
            f32(0x00000000U),
            f32(0x3f800000U)
        },
        CollisionNarrowphasePart{
            f32(0x00000000U),
            f32(0x00000000U),
            f32(0x00000000U)
        },
        CollisionNarrowphasePart{
            f32(0x00000000U),
            f32(0x7f800000U),
            f32(0x3f800000U)
        }
    };
    input.pairs = {
        CollisionNarrowphasePair{
            0U,
            1U
        },
        CollisionNarrowphasePair{
            0U,
            2U
        },
        CollisionNarrowphasePair{
            3U,
            4U
        },
        CollisionNarrowphasePair{
            5U,
            3U
        },
        CollisionNarrowphasePair{
            6U,
            7U
        },
        CollisionNarrowphasePair{
            7U,
            6U
        },
        CollisionNarrowphasePair{
            10U,
            11U
        },
        CollisionNarrowphasePair{
            11U,
            10U
        },
        CollisionNarrowphasePair{
            8U,
            9U
        },
        CollisionNarrowphasePair{
            9U,
            8U
        },
        CollisionNarrowphasePair{
            14U,
            12U
        },
        CollisionNarrowphasePair{
            12U,
            14U
        },
        CollisionNarrowphasePair{
            15U,
            12U
        },
        CollisionNarrowphasePair{
            16U,
            12U
        },
        CollisionNarrowphasePair{
            17U,
            12U
        },
        CollisionNarrowphasePair{
            18U,
            12U
        },
        CollisionNarrowphasePair{
            19U,
            12U
        },
        CollisionNarrowphasePair{
            20U,
            12U
        },
        CollisionNarrowphasePair{
            21U,
            12U
        },
        CollisionNarrowphasePair{
            22U,
            12U
        },
        CollisionNarrowphasePair{
            23U,
            12U
        },
        CollisionNarrowphasePair{
            24U,
            12U
        },
        CollisionNarrowphasePair{
            14U,
            13U
        },
        CollisionNarrowphasePair{
            25U,
            12U
        },
        CollisionNarrowphasePair{
            12U,
            25U
        },
        CollisionNarrowphasePair{
            26U,
            12U
        },
        CollisionNarrowphasePair{
            12U,
            27U
        }
    };
    return input;
}

struct ExpectedManifold final {
    std::string_view name;
    bool collided;
    std::array<std::uint64_t, 5> rawF64;
};

// Generated from production detectCollisionBodies(), source SHA-256
// a0dbe0e4b6c5ed040fe3120def34ef84b01d99e86fe4bd2f961ee4626021efe1; output raw f64 SHA-256
// 89648ea08dbcf1a9c6158623d48c1f67ddf6001b5ea5f887cd483ae3d518e9e1.
constexpr std::array<ExpectedManifold, 27> expectedManifolds{
        ExpectedManifold{
            "circle_circle_enemy_scaled_overlap",
            true,
            {0x3fed89d89d89d89eULL, 0x3fd89d89d89d89d9ULL, 0x4002666666666668ULL, 0x401c3f03f03f03f1ULL, 0x400789d89d89d89eULL}
        },
        ExpectedManifold{
            "circle_circle_enemy_scaled_tangent_rejected",
            false,
            {0ULL, 0ULL, 0ULL, 0ULL, 0ULL}
        },
        ExpectedManifold{
            "circle_circle_coincident_default_normal",
            true,
            {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x4020000000000000ULL, 0x4022000000000000ULL, 0xc008000000000000ULL}
        },
        ExpectedManifold{
            "circle_circle_invalid_nan_rejected",
            false,
            {0ULL, 0ULL, 0ULL, 0ULL, 0ULL}
        },
        ExpectedManifold{
            "parts_circle_multi_contact",
            true,
            {0x0000000000000000ULL, 0x3ff0000000000000ULL, 0x4015ac8fe621fc54ULL, 0x0000000000000000ULL, 0x4009f707af371edbULL}
        },
        ExpectedManifold{
            "circle_parts_reverse_signed_zero",
            true,
            {0x8000000000000000ULL, 0xbff0000000000000ULL, 0x4015ac8fe621fc54ULL, 0x0000000000000000ULL, 0x4009f707af371edbULL}
        },
        ExpectedManifold{
            "parts_circle_diagonal_fallback_normal",
            true,
            {0x3fe6a09e667f3bccULL, 0x3fe6a09e667f3bccULL, 0x4024000000000000ULL, 0x40162463000f8560ULL, 0x40162463000f8560ULL}
        },
        ExpectedManifold{
            "circle_parts_diagonal_fallback_reverse",
            true,
            {0xbfe6a09e667f3bccULL, 0xbfe6a09e667f3bccULL, 0x4024000000000000ULL, 0x40162463000f8560ULL, 0x40162463000f8560ULL}
        },
        ExpectedManifold{
            "parts_parts_order_ab",
            true,
            {0x0000000000000000ULL, 0x3ff0000000000000ULL, 0x40107bf43c77bf7aULL, 0x0000000000000000ULL, 0x400d232b7fb3e0bbULL}
        },
        ExpectedManifold{
            "parts_parts_order_ba",
            true,
            {0x0000000000000000ULL, 0xbff0000000000000ULL, 0x40107bf43c77bf7aULL, 0x0000000000000000ULL, 0x3fd6e6a40260fa29ULL}
        },
        ExpectedManifold{
            "circle_rect_edge",
            true,
            {0xbff0000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL, 0x4024000000000000ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "rect_circle_reverse_signed_zero",
            true,
            {0x3ff0000000000000ULL, 0x8000000000000000ULL, 0x3ff0000000000000ULL, 0x4024000000000000ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_corner",
            true,
            {0xbfe6a09e667f3bccULL, 0xbfe6a09e667f3bccULL, 0x3fe2bec333018866ULL, 0x4024000000000000ULL, 0x4024000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_tangent_rejected",
            false,
            {0ULL, 0ULL, 0ULL, 0ULL, 0ULL}
        },
        ExpectedManifold{
            "circle_rect_inside_left",
            true,
            {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x4008000000000000ULL, 0x0000000000000000ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_inside_right",
            true,
            {0xbff0000000000000ULL, 0x0000000000000000ULL, 0x4008000000000000ULL, 0x4024000000000000ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_inside_top",
            true,
            {0x0000000000000000ULL, 0x3ff0000000000000ULL, 0x4008000000000000ULL, 0x4014000000000000ULL, 0x0000000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_inside_bottom",
            true,
            {0x0000000000000000ULL, 0xbff0000000000000ULL, 0x4008000000000000ULL, 0x4014000000000000ULL, 0x4024000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_inside_all_tie_right_wins",
            true,
            {0xbff0000000000000ULL, 0x0000000000000000ULL, 0x401c000000000000ULL, 0x4024000000000000ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_inside_left_top_tie_top_wins",
            true,
            {0x0000000000000000ULL, 0x3ff0000000000000ULL, 0x4008000000000000ULL, 0x3ff0000000000000ULL, 0x0000000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_near_uses_inside_branch",
            true,
            {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_near_uses_distance_branch",
            true,
            {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x3feff6fd21ff2e49ULL, 0x0000000000000000ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "circle_rect_nonfinite_bound_falls_back_zero",
            true,
            {0xbff0000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL, 0x4024000000000000ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "parts_rect_multi_contact",
            true,
            {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x4016333333333334ULL, 0x400d1745d1745d17ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "rect_parts_reverse_signed_zero",
            true,
            {0xbff0000000000000ULL, 0x8000000000000000ULL, 0x4016333333333334ULL, 0x400d1745d1745d17ULL, 0x4014000000000000ULL}
        },
        ExpectedManifold{
            "parts_rect_invalid_only_rejected",
            false,
            {0ULL, 0ULL, 0ULL, 0ULL, 0ULL}
        },
        ExpectedManifold{
            "rect_rect_unsupported",
            false,
            {0ULL, 0ULL, 0ULL, 0ULL, 0ULL}
        }
};

[[nodiscard]] std::array<std::uint64_t, 5> manifoldBits(
    const CollisionNarrowphaseManifold& manifold
) noexcept {
    return {
        std::bit_cast<std::uint64_t>(manifold.normalX),
        std::bit_cast<std::uint64_t>(manifold.normalY),
        std::bit_cast<std::uint64_t>(manifold.penetration),
        std::bit_cast<std::uint64_t>(manifold.pointX),
        std::bit_cast<std::uint64_t>(manifold.pointY)
    };
}

void requireManifold(
    const CollisionNarrowphaseManifold& actual,
    const ExpectedManifold& expected
) {
    if (actual.collided != expected.collided) {
        throw TestFailure(
            std::string(expected.name) + " collision flag differs from production oracle"
        );
    }
    if (expected.collided && manifoldBits(actual) != expected.rawF64) {
        throw TestFailure(
            std::string(expected.name) + " raw f64 manifold differs from production oracle"
        );
    }
}

[[nodiscard]] bool equalsSentinel(
    const CollisionNarrowphaseManifold& value,
    const CollisionNarrowphaseManifold& sentinel
) noexcept {
    return value.collided == sentinel.collided
        && manifoldBits(value) == manifoldBits(sentinel);
}

void requireOutputsUntouched(
    const std::array<CollisionNarrowphaseManifold, 27>& outputs,
    const CollisionNarrowphaseManifold& sentinel
) {
    REQUIRE(std::all_of(outputs.begin(), outputs.end(), [&sentinel](const auto& value) {
        return equalsSentinel(value, sentinel);
    }));
}

void testProductionFixtureRawBitParityAndNoAllocation() {
    static_assert(
        std::bit_cast<std::uint64_t>(cirvivor::core::collisionEnemyPairRadiusScale)
        == 0x3fe8'7ae1'47ae'147bULL
    );
    static_assert(
        std::bit_cast<std::uint64_t>(cirvivor::core::collisionEnemyProjectileRadiusScale)
        == 0x3fed'eb85'1eb8'51ecULL
    );

    GoldenInput input = createGoldenInput();
    CollisionNarrowphaseScalar scalar({
        input.bodies.size(),
        input.parts.size(),
        input.pairs.size()
    });
    const CollisionNarrowphaseLimits limits = scalar.limits();
    REQUIRE(limits.maximumBodyCount == 28U);
    REQUIRE(limits.maximumPartCount == 17U);
    REQUIRE(limits.maximumPairCount == 27U);

    std::array<CollisionNarrowphaseManifold, 27> actual{};
    allocation_probe::count = 0U;
    allocation_probe::enabled = true;
    const CollisionNarrowphaseStatus status = scalar.detect(
        input.bodies,
        input.parts,
        input.pairs,
        actual
    );
    allocation_probe::enabled = false;

    REQUIRE(status == CollisionNarrowphaseStatus::ok);
    REQUIRE(allocation_probe::count == 0U);
    for (std::size_t index = 0; index < actual.size(); ++index) {
        requireManifold(actual[index], expectedManifolds[index]);
    }
}

void testValidationIsTransactional() {
    GoldenInput input = createGoldenInput();
    CollisionNarrowphaseScalar scalar({
        input.bodies.size(),
        input.parts.size(),
        input.pairs.size()
    });
    const CollisionNarrowphaseManifold sentinel{
        true,
        f64(0x3ff1'9999'9999'999aULL),
        f64(0xbff1'9999'9999'999aULL),
        f64(0x4001'9999'9999'999aULL),
        f64(0x400a'6666'6666'6666ULL),
        f64(0xc00a'6666'6666'6666ULL)
    };
    std::array<CollisionNarrowphaseManifold, 27> outputs;
    outputs.fill(sentinel);

    auto invalidBodies = input.bodies;
    invalidBodies[0].kind = static_cast<CollisionBodyKind>(0xffU);
    REQUIRE(scalar.detect(invalidBodies, input.parts, input.pairs, outputs)
        == CollisionNarrowphaseStatus::invalidBodyMetadata);
    requireOutputsUntouched(outputs, sentinel);

    invalidBodies = input.bodies;
    invalidBodies[0].shape = CollisionBodyShape::none;
    REQUIRE(scalar.detect(invalidBodies, input.parts, input.pairs, outputs)
        == CollisionNarrowphaseStatus::invalidBodyMetadata);
    requireOutputsUntouched(outputs, sentinel);

    invalidBodies = input.bodies;
    invalidBodies[6].partStart = 17U;
    invalidBodies[6].partCount = 1U;
    REQUIRE(scalar.detect(invalidBodies, input.parts, input.pairs, outputs)
        == CollisionNarrowphaseStatus::invalidPartSpan);
    requireOutputsUntouched(outputs, sentinel);

    invalidBodies = input.bodies;
    invalidBodies[6].partStart = std::numeric_limits<std::uint32_t>::max();
    invalidBodies[6].partCount = std::numeric_limits<std::uint32_t>::max();
    REQUIRE(scalar.detect(invalidBodies, input.parts, input.pairs, outputs)
        == CollisionNarrowphaseStatus::invalidPartSpan);
    requireOutputsUntouched(outputs, sentinel);

    auto invalidPairs = input.pairs;
    invalidPairs[4].bodyIndexB = 28U;
    REQUIRE(scalar.detect(input.bodies, input.parts, invalidPairs, outputs)
        == CollisionNarrowphaseStatus::invalidPair);
    requireOutputsUntouched(outputs, sentinel);

    REQUIRE(scalar.detect(
        input.bodies,
        input.parts,
        input.pairs,
        std::span(outputs).first(outputs.size() - 1U)
    ) == CollisionNarrowphaseStatus::outputTooSmall);
    requireOutputsUntouched(outputs, sentinel);

    CollisionNarrowphaseScalar small({
        input.bodies.size() - 1U,
        input.parts.size(),
        input.pairs.size()
    });
    REQUIRE(small.detect(input.bodies, input.parts, input.pairs, outputs)
        == CollisionNarrowphaseStatus::capacityExceeded);
    requireOutputsUntouched(outputs, sentinel);

    REQUIRE(scalar.detect({}, {}, {}, {}) == CollisionNarrowphaseStatus::ok);

    bool threw = false;
    try {
        CollisionNarrowphaseScalar invalid({
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
        TestCase{
            "production generic narrowphase raw-bit parity",
            testProductionFixtureRawBitParityAndNoAllocation
        },
        TestCase{
            "fixed-capacity transactional validation",
            testValidationIsTransactional
        }
    };

    std::size_t passed = 0U;
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
