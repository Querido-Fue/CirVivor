#include "core/state_hash/canonical_state_hasher.h"

#include <array>
#include <bit>
#include <charconv>
#include <cmath>
#include <stdexcept>

namespace cirvivor::core {
namespace {

[[nodiscard]] bool isUtf8Continuation(const unsigned char value) noexcept {
    return (value & 0xc0U) == 0x80U;
}

[[nodiscard]] bool isValidUtf8(const std::string_view value) noexcept {
    std::size_t index = 0;
    while (index < value.size()) {
        const auto first = static_cast<unsigned char>(value[index]);
        if (first <= 0x7fU) {
            ++index;
            continue;
        }

        std::size_t continuationCount = 0;
        if (first >= 0xc2U && first <= 0xdfU) {
            continuationCount = 1;
        } else if (first >= 0xe0U && first <= 0xefU) {
            continuationCount = 2;
        } else if (first >= 0xf0U && first <= 0xf4U) {
            continuationCount = 3;
        } else {
            return false;
        }
        if (index + continuationCount >= value.size()) {
            return false;
        }
        for (std::size_t offset = 1; offset <= continuationCount; ++offset) {
            if (!isUtf8Continuation(static_cast<unsigned char>(value[index + offset]))) {
                return false;
            }
        }

        const auto second = static_cast<unsigned char>(value[index + 1]);
        if ((first == 0xe0U && second < 0xa0U)
            || (first == 0xedU && second >= 0xa0U)
            || (first == 0xf0U && second < 0x90U)
            || (first == 0xf4U && second >= 0x90U)) {
            return false;
        }
        index += continuationCount + 1;
    }
    return true;
}

} // namespace

void CanonicalStateHasher64::reset() noexcept {
    hasher_.reset();
}

void CanonicalStateHasher64::appendNull() noexcept {
    hasher_.appendString("N;");
}

void CanonicalStateHasher64::appendBoolean(const bool value) noexcept {
    hasher_.appendString(value ? "B1;" : "B0;");
}

void CanonicalStateHasher64::appendNumber(const double value) {
    if (!std::isfinite(value)) {
        throw std::invalid_argument("Canonical state numbers must be finite.");
    }

    constexpr std::array<char, 16> hexDigits{
        '0', '1', '2', '3', '4', '5', '6', '7',
        '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'
    };
    std::array<char, 18> token{};
    token.front() = 'F';
    token.back() = ';';

    const std::uint64_t bits = std::bit_cast<std::uint64_t>(value);
    for (std::size_t index = 0; index < 16; ++index) {
        const std::size_t shift = (15U - index) * 4U;
        const auto nibble = static_cast<std::size_t>((bits >> shift) & 0x0fU);
        token[index + 1] = hexDigits[nibble];
    }
    hasher_.appendString({token.data(), token.size()});
}

void CanonicalStateHasher64::appendString(const std::string_view value) {
    if (!isValidUtf8(value)) {
        throw std::invalid_argument("Canonical state strings must contain valid UTF-8.");
    }
    hasher_.appendString("S");
    appendCount(value.size());
    hasher_.appendString(":");
    hasher_.appendString(value);
    hasher_.appendString(";");
}

void CanonicalStateHasher64::beginArray(const std::size_t elementCount) noexcept {
    hasher_.appendString("A");
    appendCount(elementCount);
    hasher_.appendString("[");
}

void CanonicalStateHasher64::endArray() noexcept {
    hasher_.appendString("];");
}

void CanonicalStateHasher64::beginObject(const std::size_t memberCount) noexcept {
    hasher_.appendString("O");
    appendCount(memberCount);
    hasher_.appendString("{");
}

void CanonicalStateHasher64::appendObjectKey(const std::string_view key) {
    appendString(key);
}

void CanonicalStateHasher64::endObject() noexcept {
    hasher_.appendString("};");
}

std::uint64_t CanonicalStateHasher64::value() const noexcept {
    return hasher_.value();
}

void CanonicalStateHasher64::appendCount(const std::size_t value) noexcept {
    std::array<char, 32> digits{};
    const auto result = std::to_chars(digits.data(), digits.data() + digits.size(), value);
    hasher_.appendString({digits.data(), static_cast<std::size_t>(result.ptr - digits.data())});
}

} // namespace cirvivor::core
