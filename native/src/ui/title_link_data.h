#pragma once

#include "ui/title_overlay_content.h"

#include <cstddef>
#include <string_view>

namespace cirvivor::ui::data {

inline constexpr std::string_view title_version_history_url =
    "https://google.com";

inline constexpr std::string_view title_credits_blog_url =
    "https://jukchang.com";
inline constexpr std::string_view title_credits_cirvivor_github_url =
    "https://github.com/Querido-Fue/CirVivor";
inline constexpr std::string_view title_credits_pretendard_github_url =
    "https://github.com/orioncactus/pretendard";
inline constexpr std::string_view title_credits_outfit_github_url =
    "https://github.com/Outfitio/Outfit-Fonts/tree/main";
inline constexpr std::string_view title_credits_react_bits_github_url =
    "https://github.com/DavidHDev/react-bits";

[[nodiscard]] constexpr std::string_view titleCreditsExternalUrl(
    const TitleOverlayControlId id
) noexcept {
    switch (id) {
    case TitleOverlayControlId::creditsBlog:
        return title_credits_blog_url;
    case TitleOverlayControlId::creditsCirvivorGithub:
        return title_credits_cirvivor_github_url;
    case TitleOverlayControlId::creditsPretendardGithub:
        return title_credits_pretendard_github_url;
    case TitleOverlayControlId::creditsOutfitGithub:
        return title_credits_outfit_github_url;
    case TitleOverlayControlId::creditsReactBitsGithub:
        return title_credits_react_bits_github_url;
    default:
        return {};
    }
}

/** JS headless text-width fallback가 세는 기본 한국어 링크의 UTF-16 unit 수입니다. */
inline constexpr std::size_t title_version_history_fallback_text_units = 8U;

} // namespace cirvivor::ui::data
