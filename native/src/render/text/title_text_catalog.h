#pragma once

#include "render/common/pre_shaped_text.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace cirvivor::render::text {

struct TitleTextCatalogEntry final {
    UiTextSemanticId semantic = UiTextSemanticId::titleCardStart;
    std::string_view korean;
    std::string_view english;
    std::uint32_t logicalPixelSizeMilli = 0;
    std::int32_t weight = 400;
};

struct TitleExternalUrlTextEntry final {
    std::string_view url;
    UiTextSemanticId semantic = UiTextSemanticId::externalUrlGoogle;
};

inline constexpr std::array title_text_catalog{
    TitleTextCatalogEntry{UiTextSemanticId::titleCardStart, "게임 시작", "Play", 16'000U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::titleCardQuickStart, "빠른 시작", "Quick Start", 16'000U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::titleCardQuickStartDescription, "최근 로드아웃으로 게임 시작", "Use latest loadout", 10'880U, 500},
    TitleTextCatalogEntry{UiTextSemanticId::titleCardRecords, "기록", "History", 16'000U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::titleCardDeck, "덱", "Deck", 16'000U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::titleCardDeckDescription, "덱 확인 및 강화", "Review & upgrade deck", 10'880U, 500},
    TitleTextCatalogEntry{UiTextSemanticId::titleCardResearch, "연구", "Research", 16'000U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::titleCardResearchDescription, "연구 트리 열기", "Open research tree", 10'880U, 500},
    TitleTextCatalogEntry{UiTextSemanticId::utilitySetting, "설정", "Settings", 10'880U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::utilityCredits, "크레딧", "Credits", 10'880U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::utilityAchievements, "도전과제", "Achievements", 10'880U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::utilityExit, "종료", "Quit", 10'880U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::versionLabel, "ver 0.41", "ver 0.41", 12'800U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::versionHistoryLink, "패치 내역 열기", "Patch Notes", 12'800U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::mapSelectTitle, "맵 선택", "Select Map", 25'600U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::mapName, "8자 회랑", "Figure-Eight Corridor", 16'640U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::mapSelected, "선택됨", "Selected", 12'800U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::mapDescription, "7타일 폭의 복도와 8자 진행 경로로 구성된 맵입니다.", "A seven-tile-wide corridor following a figure-eight route.", 12'800U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::mapCancel, "취소", "Cancel", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::mapStart, "게임 시작", "Start Game", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::exitTitle, "종료", "Quit", 20'480U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::exitBody, "게임을 종료할까요?", "Are you sure you want to quit the game?", 14'080U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::exitNo, "아니오", "No", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::exitYes, "예", "Yes", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::externalTitle, "주의", "Warning", 20'480U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::externalBody, "외부 브라우저에서 아래 링크가 열립니다. 계속할까요?", "Following link will open in external browser. Continue?", 14'080U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::externalUrlGoogle, "google.com", "google.com", 12'800U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::externalUrlJukchang, "jukchang.com", "jukchang.com", 12'800U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::externalUrlCirVivor, "github.com/Querido-Fue/CirVivor", "github.com/Querido-Fue/CirVivor", 12'800U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::externalUrlPretendard, "github.com/orioncactus/pretendard", "github.com/orioncactus/pretendard", 12'800U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::externalUrlOutfit, "github.com/Outfitio/Outfit-Fonts/tree/main", "github.com/Outfitio/Outfit-Fonts/tree/main", 12'800U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::externalUrlReactBits, "github.com/DavidHDev/react-bits", "github.com/DavidHDev/react-bits", 12'800U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::externalNo, "아니오", "No", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::externalYes, "예", "Yes", 12'800U, 600}
};

inline constexpr std::array title_external_url_text_catalog{
    TitleExternalUrlTextEntry{
        "https://google.com",
        UiTextSemanticId::externalUrlGoogle
    },
    TitleExternalUrlTextEntry{
        "https://jukchang.com",
        UiTextSemanticId::externalUrlJukchang
    },
    TitleExternalUrlTextEntry{
        "https://github.com/Querido-Fue/CirVivor",
        UiTextSemanticId::externalUrlCirVivor
    },
    TitleExternalUrlTextEntry{
        "https://github.com/orioncactus/pretendard",
        UiTextSemanticId::externalUrlPretendard
    },
    TitleExternalUrlTextEntry{
        "https://github.com/Outfitio/Outfit-Fonts/tree/main",
        UiTextSemanticId::externalUrlOutfit
    },
    TitleExternalUrlTextEntry{
        "https://github.com/DavidHDev/react-bits",
        UiTextSemanticId::externalUrlReactBits
    }
};

[[nodiscard]] constexpr const TitleTextCatalogEntry* titleTextCatalogEntry(
    const UiTextSemanticId semantic
) noexcept {
    for (const TitleTextCatalogEntry& entry : title_text_catalog) {
        if (entry.semantic == semantic) {
            return &entry;
        }
    }
    return nullptr;
}

[[nodiscard]] constexpr PreShapedTextKey titleTextKey(
    const UiTextSemanticId semantic,
    const UiTextLocale locale
) noexcept {
    const TitleTextCatalogEntry* const entry = titleTextCatalogEntry(semantic);
    return entry == nullptr
        ? PreShapedTextKey{semantic, locale, 0U, 0}
        : PreShapedTextKey{
              semantic,
              locale,
              entry->logicalPixelSizeMilli,
              entry->weight
          };
}

[[nodiscard]] constexpr bool titleExternalUrlSemantic(
    const std::string_view url,
    UiTextSemanticId& semantic
) noexcept {
    for (const TitleExternalUrlTextEntry& entry : title_external_url_text_catalog) {
        if (url == entry.url) {
            semantic = entry.semantic;
            return true;
        }
    }
    return false;
}

[[nodiscard]] consteval bool titleExternalUrlCatalogIsValid() noexcept {
    for (std::size_t index = 0U;
         index < title_external_url_text_catalog.size();
         ++index) {
        const TitleExternalUrlTextEntry& entry = title_external_url_text_catalog[index];
        if (entry.url.empty() || titleTextCatalogEntry(entry.semantic) == nullptr) {
            return false;
        }
        for (std::size_t other = index + 1U;
             other < title_external_url_text_catalog.size();
             ++other) {
            if (entry.url == title_external_url_text_catalog[other].url
                || entry.semantic == title_external_url_text_catalog[other].semantic) {
                return false;
            }
        }
    }
    return true;
}

static_assert(title_external_url_text_catalog.size() == 6U);
static_assert(titleExternalUrlCatalogIsValid());

} // namespace cirvivor::render::text
