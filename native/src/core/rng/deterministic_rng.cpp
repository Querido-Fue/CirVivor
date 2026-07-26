#include "core/rng/deterministic_rng.h"

#include <stdexcept>

namespace cirvivor::core {

DeterministicRng::DeterministicRng(
    const std::uint64_t seed,
    const std::uint64_t sequence
) {
    reseed(seed, sequence);
}

void DeterministicRng::reseed(
    const std::uint64_t seed,
    const std::uint64_t sequence
) {
    if (sequence > maximum_sequence) {
        throw std::invalid_argument(
            "DeterministicRng sequence must fit the PCG 63-bit stream selector"
        );
    }
    state_ = 0;
    increment_ = (sequence << 1U) | 1U;
    static_cast<void>(nextU32());
    state_ += seed;
    static_cast<void>(nextU32());
}

std::uint32_t DeterministicRng::nextU32() noexcept {
    const std::uint64_t previousState = state_;
    state_ = previousState * multiplier + increment_;

    const auto xorShifted = static_cast<std::uint32_t>(
        ((previousState >> 18U) ^ previousState) >> 27U
    );
    const auto rotation = static_cast<std::uint32_t>(previousState >> 59U);
    return (xorShifted >> rotation)
        | (xorShifted << ((32U - rotation) & 31U));
}

std::uint32_t DeterministicRng::nextBounded(const std::uint32_t upperExclusive) {
    if (upperExclusive == 0U) {
        throw std::invalid_argument("DeterministicRng::nextBounded requires a non-zero bound");
    }

    const std::uint32_t threshold = (0U - upperExclusive) % upperExclusive;
    while (true) {
        const std::uint32_t value = nextU32();
        if (value >= threshold) {
            return value % upperExclusive;
        }
    }
}

double DeterministicRng::nextUnitDouble() noexcept {
    const std::uint64_t high = static_cast<std::uint64_t>(nextU32() >> 5U);
    const std::uint64_t low = static_cast<std::uint64_t>(nextU32() >> 6U);
    constexpr double denominator = 9'007'199'254'740'992.0;
    return (static_cast<double>(high * 67'108'864ULL) + static_cast<double>(low))
        / denominator;
}

std::uint64_t DeterministicRng::state() const noexcept {
    return state_;
}

std::uint64_t DeterministicRng::sequence() const noexcept {
    return increment_ >> 1U;
}

} // namespace cirvivor::core
