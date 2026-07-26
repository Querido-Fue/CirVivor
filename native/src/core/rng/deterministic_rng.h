#pragma once

#include <cstdint>

namespace cirvivor::core {

class DeterministicRng final {
public:
    using result_type = std::uint32_t;

    static constexpr std::uint64_t default_seed = 0x4d59'5df4'd0f3'3173ULL;
    static constexpr std::uint64_t default_sequence = 0x1405'7b7e'f767'814fULL;
    static constexpr std::uint64_t maximum_sequence = 0x7fff'ffff'ffff'ffffULL;

    explicit DeterministicRng(
        std::uint64_t seed = default_seed,
        std::uint64_t sequence = default_sequence
    );

    void reseed(std::uint64_t seed, std::uint64_t sequence = default_sequence);

    [[nodiscard]] std::uint32_t nextU32() noexcept;
    [[nodiscard]] std::uint32_t nextBounded(std::uint32_t upperExclusive);
    [[nodiscard]] double nextUnitDouble() noexcept;

    [[nodiscard]] std::uint64_t state() const noexcept;
    [[nodiscard]] std::uint64_t sequence() const noexcept;

private:
    static constexpr std::uint64_t multiplier = 6'364'136'223'846'793'005ULL;

    std::uint64_t state_ = 0;
    std::uint64_t increment_ = 1;
};

} // namespace cirvivor::core
