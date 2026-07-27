#pragma once

#include <cstddef>
#include <string_view>

namespace cirvivor::ui::data {

inline constexpr std::string_view title_version_history_url =
    "https://google.com";

/** JS headless text-width fallback가 세는 기본 한국어 링크의 UTF-16 unit 수입니다. */
inline constexpr std::size_t title_version_history_fallback_text_units = 8U;

} // namespace cirvivor::ui::data
