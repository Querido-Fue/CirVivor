#pragma once

#include "ui/layout/ui_layout_metrics.h"
#include "ui/title_overlay_state_machine.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace cirvivor::ui {

inline constexpr std::size_t maximum_title_overlay_controls = 20U;
inline constexpr std::size_t maximum_title_overlay_control_state_overrides = 20U;

enum class TitleOverlayControlId : std::uint8_t {
    none,
    cancel,
    confirm,
    close,
    deckAchievements,
    deckEncyclopedia,
    settingWindowMode,
    settingUltrawide,
    settingRenderScale,
    settingUiScale,
    settingOpaqueUi,
    settingBenchmark,
    settingLanguage,
    settingTheme,
    settingTooltipDelay,
    settingBgm,
    settingSfx,
    settingKeybindings,
    creditsBlog,
    creditsCirvivorGithub,
    creditsPretendardGithub,
    creditsOutfitGithub,
    creditsReactBitsGithub,
    debugFrameTime,
    debugPoolInfo,
    debugHitboxes,
    debugAnimation,
    debugOpenDevTools
};

enum class TitleOverlayControlAction : std::uint8_t {
    none,
    cancelTop,
    confirmTop,
    openExternalLink,
    activateApplicationControl
};

struct TitleOverlayControlStateOverride final {
    std::uint32_t overlaySequence = 0U;
    TitleOverlayControlId id = TitleOverlayControlId::none;
    double value = 0.0;
    bool selected = false;
    bool enabled = true;

    constexpr bool operator==(
        const TitleOverlayControlStateOverride&
    ) const noexcept = default;
};

/** Application domain을 모르는 fixed-capacity control 표시 상태입니다. */
struct TitleOverlayControlStateOverrides final {
    std::array<
        TitleOverlayControlStateOverride,
        maximum_title_overlay_control_state_overrides
    > controls{};
    std::uint8_t controlCount = 0U;
    std::uint64_t revision = 0U;

    constexpr bool operator==(
        const TitleOverlayControlStateOverrides&
    ) const noexcept = default;
};

struct TitleOverlayControl final {
    TitleOverlayControlId id = TitleOverlayControlId::none;
    TitleOverlayControlAction action = TitleOverlayControlAction::none;
    layout::RoundedRectD rect{};
    layout::RoundedRectD valueRect{};
    double value = 0.0;
    bool enabled = true;
    bool selected = false;

    constexpr bool operator==(const TitleOverlayControl&) const noexcept = default;
};

/**
 * 한 overlay attachment의 표시와 hit-test가 공유하는 고정 geometry입니다.
 * control의 action이 none이면 표시 전용입니다.
 */
struct TitleOverlayPresentation final {
    OverlayKind kind = OverlayKind::none;
    std::uint32_t sequence = 0U;
    std::int16_t layer = 0;
    double alpha = 0.0;
    double dimAlpha = 0.0;
    double contentScale = 1.0;
    double contentBlur = 0.0;
    bool acceptsInput = false;
    bool interactionsLocked = false;
    layout::RoundedRectD panelRect{};
    layout::RoundedRectD bodyRect{};
    layout::RoundedRectD headerDividerRect{};
    layout::RoundedRectD mapPreviewRect{};
    std::array<TitleOverlayControl, maximum_title_overlay_controls> controls{};
    std::uint8_t controlCount = 0U;

    constexpr bool operator==(const TitleOverlayPresentation&) const noexcept = default;
};

struct TitleOverlayPresentationSet final {
    std::array<TitleOverlayPresentation, maximum_overlay_count> overlays{};
    std::uint8_t overlayCount = 0U;
    std::uint64_t stateRevision = 0U;
    std::uint64_t layoutRevision = 0U;
    std::uint64_t controlStateRevision = 0U;

    constexpr bool operator==(const TitleOverlayPresentationSet&) const noexcept = default;
};

/** 실패 시 out을 변경하지 않습니다. */
[[nodiscard]] bool tryBuildTitleOverlayPresentationSet(
    const UiStateSnapshot& state,
    const layout::UiLayoutSnapshot& layoutSnapshot,
    TitleOverlayPresentationSet& out,
    const TitleOverlayControlStateOverrides* controlStateOverrides = nullptr
) noexcept;

[[nodiscard]] const TitleOverlayPresentation* findTitleOverlayPresentation(
    const TitleOverlayPresentationSet& presentations,
    std::uint32_t sequence
) noexcept;

/** draw order와 무관하게 attachment sequence가 가장 최신인 overlay를 반환합니다. */
[[nodiscard]] const TitleOverlayPresentation* findLatestTitleOverlayPresentation(
    const TitleOverlayPresentationSet& presentations
) noexcept;

[[nodiscard]] const TitleOverlayControl* hitTestTitleOverlayControl(
    const TitleOverlayPresentation& presentation,
    const layout::PointD& point
) noexcept;

static_assert(std::is_trivially_copyable_v<TitleOverlayControl>);
static_assert(std::is_trivially_copyable_v<TitleOverlayControlStateOverride>);
static_assert(std::is_trivially_copyable_v<TitleOverlayControlStateOverrides>);
static_assert(std::is_trivially_copyable_v<TitleOverlayPresentation>);
static_assert(std::is_trivially_copyable_v<TitleOverlayPresentationSet>);
static_assert(std::is_standard_layout_v<TitleOverlayControl>);
static_assert(std::is_standard_layout_v<TitleOverlayControlStateOverride>);
static_assert(std::is_standard_layout_v<TitleOverlayControlStateOverrides>);
static_assert(std::is_standard_layout_v<TitleOverlayPresentation>);
static_assert(std::is_standard_layout_v<TitleOverlayPresentationSet>);

} // namespace cirvivor::ui
