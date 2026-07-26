#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

namespace cirvivor::core {

class StateHasher64 final {
public:
    static constexpr std::uint64_t offset_basis = 0xcbf2'9ce4'8422'2325ULL;
    static constexpr std::uint64_t prime = 0x0000'0100'0000'01b3ULL;

    StateHasher64() noexcept = default;

    void reset() noexcept;
    void appendBytes(std::span<const std::byte> bytes) noexcept;
    void appendString(std::string_view text) noexcept;
    void appendU32(std::uint32_t value) noexcept;
    void appendU64(std::uint64_t value) noexcept;
    void appendDoubleBits(double value) noexcept;

    [[nodiscard]] std::uint64_t value() const noexcept;

private:
    std::uint64_t value_ = offset_basis;
};

} // namespace cirvivor::core
