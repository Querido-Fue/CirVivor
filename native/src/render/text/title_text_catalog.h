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
    TitleTextCatalogEntry{UiTextSemanticId::externalYes, "예", "Yes", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::overlayClose, "닫기", "Close", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::deckTitle, "덱", "Deck", 25'600U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::deckAchievements, "업적", "Achievements", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::deckEncyclopedia, "도감", "Encyclopedia", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::deckZeroPercent, "0%", "0%", 14'080U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::quickStartTitle, "빠른 시작", "Quick Start", 25'600U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::comingSoon, "준비 중", "Coming Soon", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::quickStartBody, "최근 로드아웃 기반 시작 UI는 다음 단계에서 연결할 예정입니다.", "The quick start configuration UI will be connected in the next step.", 12'800U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::recordsTitle, "기록", "History", 25'600U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::recordsBody, "기록 조회 및 리더보드 UI는 다음 단계에서 연결할 예정입니다.", "The records and leaderboard UI will be connected in the next step.", 12'800U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::researchTitle, "연구", "Research", 25'600U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::researchBody, "연구 트리 UI는 다음 단계에서 연결할 예정입니다.", "The research tree UI will be connected in the next step.", 12'800U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::achievementsTitle, "도전과제", "Achievements", 25'600U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::achievementsBody, "도전과제 UI는 다음 단계에서 연결할 예정입니다.", "The achievements UI will be connected in the next step.", 12'800U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::settingsTitle, "설정", "Settings", 25'600U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::settingsDisplaySection, "디스플레이 및 성능", "Display & Performance", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::settingWindowMode, "화면 모드   전체화면", "Window Mode   FullScreen", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingUltrawide, "울트라와이드 지원", "Ultrawide Support", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingUltrawideDescription, "16:9보다 넓은 화면에서는 시야 범위가 좁아집니다.", "FOV will be limited where aspect ratios are above 16:9.", 9'600U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::settingRenderScale, "렌더링 해상도   100%", "Render Scale   100%", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingRenderScaleDescription, "렌더링 해상도를 낮추면 성능이 개선되지만, 화면이 흐릿하게 보일 수 있습니다.", "Lower values improve performance at the cost of visual clarity.", 9'600U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::settingUiScale, "UI 크기   100%", "UI Scale   100%", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingUiScaleDescription, "UI 크기를 조절합니다. 125%보다 큰 값에선 일부 UI가 보이지 않을 수 있습니다.", "Adjusts UI size. Some UI elements may not be visible above 125%.", 9'600U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::settingOpaqueUi, "UI 글래스 효과 제거", "Opacue UI Backgrounds", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingOpaqueUiDescription, "UI 배경을 불투명하게 만들어 그래픽 부하를 줄입니다.", "Makes UI backgrounds opaque, Reduces graphics load.", 9'600U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::settingBenchmark, "성능 벤치마크   실행", "Performance Benchmark   Run", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingsUiSection, "인터페이스", "UI", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::settingLanguage, "언어 (Language)   한국어", "Language   English", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingTheme, "테마   어둡게", "Theme   Dark", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingTooltipDelay, "툴팁 표시 시간   0.3초", "Tooltip Delay   0.3s", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingTooltipDelayDescription, "버튼 위에 마우스를 올린 뒤 툴팁이 나타날 때까지의 시간입니다.", "How long to hover a button before the tooltip appears.", 9'600U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::settingsSoundSection, "사운드", "Sound", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::settingBgm, "배경음악   25", "Music   25", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingSfx, "효과음   40", "Effects   40", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingsControlsSection, "조작", "Controls", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::settingKeybindings, "키 설정   열기", "Key Bindings   Open", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::settingsCancel, "취소", "Cancel", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::settingsSave, "저장", "Save", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::creditsTitle, "크레딧", "Credits", 25'600U, 700},
    TitleTextCatalogEntry{UiTextSemanticId::creditsMadeBy, "제작", "Made by", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::creditsBlog, "죽창   블로그  ↗", "Jukchang   Blog  ↗", 12'800U, 500},
    TitleTextCatalogEntry{UiTextSemanticId::creditsCirvivor, "죽창   GitHub  ↗", "Jukchang   GitHub  ↗", 12'800U, 500},
    TitleTextCatalogEntry{UiTextSemanticId::creditsAssets, "사용 소재", "Assets Credit", 16'640U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::creditsPretendard, "pretendard   GitHub  ↗", "pretendard   GitHub  ↗", 12'800U, 500},
    TitleTextCatalogEntry{UiTextSemanticId::creditsOutfit, "outfit   GitHub  ↗", "outfit   GitHub  ↗", 12'800U, 500},
    TitleTextCatalogEntry{UiTextSemanticId::creditsReactBits, "react bits   GitHub  ↗", "react bits   GitHub  ↗", 12'800U, 500},
    TitleTextCatalogEntry{UiTextSemanticId::debugTitle, "디버그 패널", "디버그 패널", 20'480U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugFrameTime, "프레임타임 보이기", "프레임타임 보이기", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::debugPoolInfo, "풀 정보 보이기", "풀 정보 보이기", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::debugHitboxes, "히트박스 보이기", "히트박스 보이기", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::debugAnimation, "애니메이션 디버그", "애니메이션 디버그", 12'800U, 400},
    TitleTextCatalogEntry{UiTextSemanticId::debugHint, "/ : 업데이트 정지·재개   . : 정지 상태에서 1프레임 실행", "/ : 업데이트 정지·재개   . : 정지 상태에서 1프레임 실행", 9'600U, 300},
    TitleTextCatalogEntry{UiTextSemanticId::debugDevTools, "DevTools 열기", "DevTools 열기", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugClose, "닫기", "닫기", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugProfilerHeader, "CPU 프로파일러(1초 평균 / avg | last | max)", "CPU 프로파일러(1초 평균 / avg | last | max)", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugProfilerFrameCpu, "frame.cpu", "frame.cpu", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugProfilerUpdateBuild, "frame.update+build", "frame.update+build", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugProfilerFixedUpdate, "frame.fixed.total", "frame.fixed.total", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugProfilerSceneBuild, "frame.scene.build", "frame.scene.build", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugProfilerRenderCall, "frame.render.call", "frame.render.call", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugPoolPhysicsBodies, "PhysicsBodies:", "PhysicsBodies:", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugPoolFrameCommands, "FrameCommands:", "FrameCommands:", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugPoolGlyphAtlas, "GlyphAtlas:", "GlyphAtlas:", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit0, "0", "0", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit1, "1", "1", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit2, "2", "2", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit3, "3", "3", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit4, "4", "4", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit5, "5", "5", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit6, "6", "6", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit7, "7", "7", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit8, "8", "8", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDigit9, "9", "9", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDecimalPoint, ".", ".", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetrySlash, "/", "/", 12'800U, 600},
    TitleTextCatalogEntry{UiTextSemanticId::debugTelemetryDash, "-", "-", 12'800U, 600}
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
