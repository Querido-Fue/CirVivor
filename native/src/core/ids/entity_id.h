#pragma once

#include <compare>
#include <cstdint>
#include <limits>

namespace cirvivor::core {

struct EntityId final {
    static constexpr std::uint32_t invalid_index = std::numeric_limits<std::uint32_t>::max();
    static constexpr std::uint32_t invalid_generation = 0;

    std::uint32_t index = invalid_index;
    std::uint32_t generation = invalid_generation;

    [[nodiscard]] static constexpr EntityId invalid() noexcept {
        return {};
    }

    [[nodiscard]] static constexpr EntityId fromPacked(const std::uint64_t packed) noexcept {
        return {
            static_cast<std::uint32_t>(packed & 0xffff'ffffULL),
            static_cast<std::uint32_t>(packed >> 32U)
        };
    }

    [[nodiscard]] constexpr bool isValid() const noexcept {
        return index != invalid_index && generation != invalid_generation;
    }

    [[nodiscard]] constexpr std::uint64_t packed() const noexcept {
        return (static_cast<std::uint64_t>(generation) << 32U)
            | static_cast<std::uint64_t>(index);
    }

    [[nodiscard]] static constexpr std::uint32_t nextGeneration(
        const std::uint32_t currentGeneration
    ) noexcept {
        if (currentGeneration == std::numeric_limits<std::uint32_t>::max()) {
            return 1;
        }
        return currentGeneration + 1U == invalid_generation
            ? 1U
            : currentGeneration + 1U;
    }

    constexpr auto operator<=>(const EntityId&) const noexcept = default;
};

} // namespace cirvivor::core
