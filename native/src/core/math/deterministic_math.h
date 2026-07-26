#pragma once

namespace cirvivor::core {

// fdlibm-compatible exponential used by the JavaScript V8 oracle. Keeping
// authoritative math here avoids platform CRT last-bit differences.
[[nodiscard]] double deterministicExp(double value) noexcept;

} // namespace cirvivor::core
