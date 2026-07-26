#pragma once

#include "core/state_hash/state_hasher.h"

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace cirvivor::core {

// Streams the cirvivor-canonical-v1-f64be token format used by the JavaScript
// SDL porting oracle. Object keys must be appended in JavaScript sort order.
class CanonicalStateHasher64 final {
public:
    CanonicalStateHasher64() noexcept = default;

    void reset() noexcept;
    void appendNull() noexcept;
    void appendBoolean(bool value) noexcept;
    void appendNumber(double value);
    void appendString(std::string_view value);
    void beginArray(std::size_t elementCount) noexcept;
    void endArray() noexcept;
    void beginObject(std::size_t memberCount) noexcept;
    void appendObjectKey(std::string_view key);
    void endObject() noexcept;

    [[nodiscard]] std::uint64_t value() const noexcept;

private:
    void appendCount(std::size_t value) noexcept;

    StateHasher64 hasher_;
};

} // namespace cirvivor::core
