#include "core/state_hash/state_hasher.h"

#include <bit>

namespace cirvivor::core {

void StateHasher64::reset() noexcept {
    value_ = offset_basis;
}

void StateHasher64::appendBytes(const std::span<const std::byte> bytes) noexcept {
    for (const std::byte byte : bytes) {
        value_ ^= static_cast<std::uint64_t>(std::to_integer<std::uint8_t>(byte));
        value_ *= prime;
    }
}

void StateHasher64::appendString(const std::string_view text) noexcept {
    appendBytes({
        reinterpret_cast<const std::byte*>(text.data()),
        text.size()
    });
}

void StateHasher64::appendU32(const std::uint32_t value) noexcept {
    for (std::uint32_t shift = 0; shift < 32U; shift += 8U) {
        const auto byte = static_cast<std::byte>((value >> shift) & 0xffU);
        appendBytes({&byte, 1});
    }
}

void StateHasher64::appendU64(const std::uint64_t value) noexcept {
    for (std::uint32_t shift = 0; shift < 64U; shift += 8U) {
        const auto byte = static_cast<std::byte>((value >> shift) & 0xffULL);
        appendBytes({&byte, 1});
    }
}

void StateHasher64::appendDoubleBits(const double value) noexcept {
    appendU64(std::bit_cast<std::uint64_t>(value));
}

std::uint64_t StateHasher64::value() const noexcept {
    return value_;
}

} // namespace cirvivor::core
