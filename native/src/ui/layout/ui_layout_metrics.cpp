#include "ui/layout/ui_layout_metrics.h"
#include "ui/title_link_data.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace cirvivor::ui::layout {
namespace {

constexpr double game_aspect_ratio = 16.0 / 9.0;
constexpr double title_logo_viewbox_width = 1'178.8;
constexpr double title_logo_viewbox_height = 589.45;
constexpr double title_card_menu_scale = 0.848;
constexpr double overlay_transition_seconds = 0.5;
constexpr double title_entrance_start_scale = 1.12;
constexpr double title_entrance_offset_x_ratio = 0.075;
constexpr double title_overlay_base_dim = 0.28;
constexpr double external_link_warning_height_multiplier = 1.15;
constexpr double expo_boundary_slope = 6.93147180559945309417;

struct TypographyDefinition final {
    double sizeUiWidthPercent = 0.0;
    std::uint16_t weight = 0U;
    double lineHeightScale = 1.0;
};

constexpr std::array<TypographyDefinition, typography_role_count> typography_definitions{
    TypographyDefinition{2.0, 700U, 1.0},
    TypographyDefinition{1.6, 600U, 1.0},
    TypographyDefinition{1.3, 400U, 1.0},
    TypographyDefinition{1.1, 300U, 1.0},
    TypographyDefinition{1.0, 300U, 1.0},
    TypographyDefinition{0.85, 300U, 1.0},
    TypographyDefinition{1.1, 700U, 1.0},
    TypographyDefinition{1.0, 700U, 1.0},
    TypographyDefinition{0.85, 700U, 1.0},
    TypographyDefinition{0.9, 300U, 1.0},
    TypographyDefinition{0.9, 400U, 1.0},
    TypographyDefinition{1.0, 600U, 1.0},
    TypographyDefinition{0.8, 500U, 1.0},
    TypographyDefinition{1.0, 700U, 1.0},
    TypographyDefinition{4.0, 400U, 1.0},
    TypographyDefinition{0.85, 700U, 1.35},
    TypographyDefinition{0.85, 300U, 1.35},
    TypographyDefinition{0.85, 500U, 1.32}
};

[[nodiscard]] constexpr ThemeColor color(
    const std::uint8_t red,
    const std::uint8_t green,
    const std::uint8_t blue,
    const double alpha = 1.0
) noexcept {
    return {red, green, blue, alpha};
}

constexpr void populateSharedThemeMetrics(ThemeMetrics& theme) noexcept {
    theme.loadingAccent = color(22U, 111U, 251U);
    theme.loadingHaloStops = {
        TitleLoadingHaloStop{0.0, color(22U, 111U, 251U), 0.0, 0.0},
        TitleLoadingHaloStop{0.06, color(132U, 204U, 255U), 0.022, 0.038},
        TitleLoadingHaloStop{0.14, color(110U, 194U, 255U), 0.03, 0.05},
        TitleLoadingHaloStop{0.3, color(84U, 176U, 255U), 0.032, 0.054},
        TitleLoadingHaloStop{0.5, color(56U, 151U, 255U), 0.024, 0.04},
        TitleLoadingHaloStop{0.72, color(31U, 127U, 251U), 0.013, 0.022},
        TitleLoadingHaloStop{0.9, color(22U, 111U, 251U), 0.004, 0.008},
        TitleLoadingHaloStop{1.0, color(22U, 111U, 251U), 0.0, 0.0}
    };
    theme.loadingRing = color(102U, 188U, 255U);
    theme.loadingRingShadow = color(48U, 145U, 255U);
    theme.loadingRingAlphaScale = 0.052;
    theme.loadingRingAlphaMax = 0.09;
    theme.loadingRingShadowAlphaScale = 0.07;
    theme.loadingRingShadowAlphaMax = 0.12;
    theme.loadingSurfaceHighlight = color(214U, 248U, 255U);
    theme.loadingSurfaceHighlightAlpha = 0.95;
    theme.loadingSurfaceShadow = color(204U, 244U, 255U);
    theme.loadingSurfaceShadowAlpha = 0.45;
    theme.confirmIdle = color(22U, 111U, 251U);
    theme.confirmHover = color(77U, 148U, 255U);
    theme.confirmText = color(255U, 255U, 255U);
    theme.cancelIdle = color(255U, 80U, 80U);
    theme.cancelHover = color(255U, 122U, 122U);
    theme.cancelText = color(255U, 255U, 255U);
    theme.overlayDim = 0.5;
    theme.menuUtilityTextOpacity = 0.82;
    theme.menuUtilityTextFocusedOpacity = 1.0;
    theme.menuUtilityBorderFallbackOpacity = 0.82;
    theme.menuBackfaceDividerOpacity = 0.06;
    theme.menuBackfaceTagTextOpacity = 1.0;
    theme.menuPanelBackfaceFillOpacity = 0.02;
    theme.menuPanelStrokeOpacity = 0.26;
    theme.menuPanelEdgeOpacity = 0.3;
    theme.menuUtilityPanelStrokeOpacity = 0.24;
    theme.menuPlaceholderOpacity = 0.92;
    theme.menuCardInnerLineOpacity = 0.12;
    theme.menuCardInnerLineFocusDelta = 0.1;
    theme.menuCardRowOpacity = 0.1;
}

[[nodiscard]] constexpr ThemeMetrics makeDarkThemeMetrics() noexcept {
    ThemeMetrics theme{};
    populateSharedThemeMetrics(theme);
    theme.background = color(5U, 3U, 10U);
    theme.titleBackground = color(5U, 3U, 10U);
    theme.titleGradient = {
        color(33U, 7U, 51U),
        color(19U, 5U, 31U),
        color(9U, 3U, 16U),
        color(42U, 6U, 39U),
        color(4U, 2U, 8U)
    };
    theme.titleGradientFallback = {
        color(26U, 32U, 39U),
        color(19U, 24U, 31U),
        color(14U, 19U, 26U),
        color(10U, 15U, 21U),
        color(6U, 9U, 14U)
    };
    theme.logoFill = color(224U, 224U, 224U);
    theme.logoShadow = color(5U, 3U, 10U);
    theme.titleShieldShadow = color(20U, 10U, 40U);
    theme.titleShieldLow = color(157U, 109U, 255U);
    theme.titleShieldHigh = color(131U, 201U, 255U);
    theme.titleShieldHighlight = color(241U, 253U, 255U);
    theme.titleText = color(224U, 224U, 224U);
    theme.titleLine = color(104U, 97U, 116U);
    theme.titleShadow = color(20U, 10U, 28U);
    theme.titleEnemy = color(240U, 230U, 255U, 0.5);
    theme.menuForeground = color(255U, 255U, 255U);
    theme.menuAccent = color(22U, 111U, 251U);
    theme.menuIconFill = color(255U, 255U, 255U);
    theme.menuIconShadow = color(26U, 26U, 26U);
    theme.titleButtonNormal = color(20U, 10U, 28U, 0.0);
    theme.titleButtonHover = {
        ThemeColorStop{0.0, color(255U, 255U, 255U, 0.2)},
        ThemeColorStop{0.8, color(255U, 255U, 255U, 0.2)},
        ThemeColorStop{1.0, color(255U, 255U, 255U, 0.0)}
    };
    theme.titleButtonText = color(255U, 255U, 255U);
    theme.overlaySectionText = color(153U, 153U, 153U);
    theme.overlayItemText = color(213U, 213U, 213U);
    theme.overlayControlText = color(153U, 153U, 153U);
    theme.overlayValueText = color(170U, 170U, 170U);
    theme.overlayPanelBackground = color(5U, 8U, 14U);
    theme.overlayPanelBorder = color(11U, 19U, 32U);
    theme.overlayGlassBackground = color(6U, 10U, 18U, 0.9);
    theme.overlayGlassBorder = color(92U, 112U, 142U, 0.34);
    theme.overlayGlassTint = color(2U, 4U, 8U);
    theme.overlayGlassEdge = color(76U, 97U, 130U);
    theme.overlayDivider = color(255U, 255U, 255U, 0.08);
    theme.overlayPanelShadow = color(0U, 0U, 0U, 0.0);
    theme.overlayPanelHasShadow = false;
    theme.overlayControlInactive = color(255U, 255U, 255U, 0.06);
    theme.overlayControlHover = color(255U, 255U, 255U, 0.12);
    theme.linkIdle = color(255U, 255U, 255U, 0.06);
    theme.linkHover = color(255U, 255U, 255U, 0.12);
    theme.linkText = color(213U, 213U, 213U);
    theme.optionActive = color(59U, 130U, 246U);
    theme.optionActiveText = color(255U, 255U, 255U);
    theme.segmentBackground = color(255U, 255U, 255U, 0.08);
    theme.segmentThumb = color(59U, 130U, 246U);
    theme.segmentTextActive = color(255U, 255U, 255U);
    theme.segmentTextInactive = color(112U, 112U, 112U);
    theme.toggleActive = color(59U, 130U, 246U);
    theme.toggleInactive = color(255U, 255U, 255U, 0.12);
    theme.toggleKnob = color(255U, 255U, 255U);
    theme.toggleShadow = color(0U, 0U, 0U, 0.3);
    theme.sliderTrack = color(255U, 255U, 255U, 0.12);
    theme.sliderValueActive = color(79U, 163U, 255U);
    theme.sliderValueInactive = color(112U, 112U, 112U);
    theme.sliderKnob = color(255U, 255U, 255U);
    theme.sliderShadow = color(0U, 0U, 0U, 0.3);
    theme.overlayGlassTintStrength = 0.54;
    theme.overlayGlassEdgeStrength = 0.13;
    theme.menuPanelFillOpacity = 0.048;
    theme.menuPanelTintOpacity = 0.13;
    return theme;
}

[[nodiscard]] constexpr ThemeMetrics makeLightThemeMetrics() noexcept {
    ThemeMetrics theme{};
    populateSharedThemeMetrics(theme);
    theme.background = color(206U, 206U, 206U);
    theme.titleBackground = color(206U, 206U, 206U);
    theme.titleGradient = {
        color(217U, 217U, 217U),
        color(212U, 212U, 212U),
        color(206U, 206U, 206U),
        color(200U, 200U, 200U),
        color(207U, 207U, 207U)
    };
    theme.titleGradientFallback = theme.titleGradient;
    theme.logoFill = color(32U, 32U, 32U);
    theme.logoShadow = color(206U, 206U, 206U);
    theme.titleShieldShadow = color(238U, 242U, 247U);
    theme.titleShieldLow = color(92U, 147U, 223U);
    theme.titleShieldHigh = color(141U, 194U, 244U);
    theme.titleShieldHighlight = color(243U, 247U, 251U);
    theme.titleText = color(36U, 36U, 36U);
    theme.titleLine = color(136U, 136U, 136U);
    theme.titleShadow = color(224U, 224U, 224U);
    theme.titleEnemy = color(230U, 90U, 90U, 0.85);
    theme.menuForeground = color(36U, 36U, 36U);
    theme.menuAccent = color(22U, 111U, 251U);
    theme.menuIconFill = color(36U, 36U, 36U);
    theme.menuIconShadow = color(104U, 104U, 104U);
    theme.titleButtonNormal = color(238U, 238U, 238U, 0.0);
    theme.titleButtonHover = {
        ThemeColorStop{0.0, color(0U, 0U, 0U, 0.1)},
        ThemeColorStop{0.8, color(0U, 0U, 0U, 0.1)},
        ThemeColorStop{1.0, color(0U, 0U, 0U, 0.0)}
    };
    theme.titleButtonText = color(36U, 36U, 36U);
    theme.overlaySectionText = color(102U, 102U, 102U);
    theme.overlayItemText = color(45U, 45U, 45U);
    theme.overlayControlText = color(102U, 102U, 102U);
    theme.overlayValueText = color(77U, 77U, 77U);
    theme.overlayPanelBackground = color(210U, 210U, 210U);
    theme.overlayPanelBorder = color(200U, 200U, 200U);
    theme.overlayGlassBackground = color(236U, 237U, 239U, 0.88);
    theme.overlayGlassBorder = color(222U, 224U, 228U, 0.56);
    theme.overlayGlassTint = color(236U, 236U, 236U);
    theme.overlayGlassEdge = color(207U, 213U, 222U);
    theme.overlayDivider = color(70U, 70U, 70U, 0.08);
    theme.overlayPanelShadow = color(0U, 0U, 0U, 0.3);
    theme.overlayPanelHasShadow = true;
    theme.overlayControlInactive = color(0U, 0U, 0U, 0.045);
    theme.overlayControlHover = color(0U, 0U, 0U, 0.08);
    theme.linkIdle = color(0U, 0U, 0U, 0.045);
    theme.linkHover = color(0U, 0U, 0U, 0.08);
    theme.linkText = color(45U, 45U, 45U);
    theme.optionActive = color(22U, 111U, 251U);
    theme.optionActiveText = color(244U, 247U, 255U);
    theme.segmentBackground = color(0U, 0U, 0U, 0.05);
    theme.segmentThumb = color(236U, 236U, 236U);
    theme.segmentTextActive = color(22U, 111U, 251U);
    theme.segmentTextInactive = color(102U, 102U, 102U);
    theme.toggleActive = color(22U, 111U, 251U);
    theme.toggleInactive = color(0U, 0U, 0U, 0.1);
    theme.toggleKnob = color(236U, 236U, 236U);
    theme.toggleShadow = color(0U, 0U, 0U, 0.3);
    theme.sliderTrack = color(0U, 0U, 0U, 0.16);
    theme.sliderValueActive = color(22U, 111U, 251U);
    theme.sliderValueInactive = color(136U, 136U, 136U);
    theme.sliderKnob = color(236U, 236U, 236U);
    theme.sliderShadow = color(0U, 0U, 0U, 0.3);
    theme.overlayGlassTintStrength = 0.18;
    theme.overlayGlassEdgeStrength = 0.1;
    theme.menuPanelFillOpacity = 0.045;
    theme.menuPanelTintOpacity = 0.12;
    return theme;
}

constexpr ThemeMetrics dark_theme_metrics = makeDarkThemeMetrics();
constexpr ThemeMetrics light_theme_metrics = makeLightThemeMetrics();

[[nodiscard]] constexpr TitleTimelineMetrics makeTitleTimelineMetrics() noexcept {
    TitleTimelineMetrics timeline{};
    timeline.introStartDelaySeconds = 1.5;
    timeline.introBlurStart = 10.0;
    timeline.introBlurDurationSeconds = 0.6;
    timeline.logoPlaybackSeconds = 3.0;
    timeline.transitionAccelSeconds = 0.3;
    timeline.transitionCruiseSeconds = 0.2;
    timeline.transitionDecelSeconds = 1.5;
    timeline.transitionTotalSeconds = 2.0;
    timeline.menuAppearStartDelaySeconds = 0.3;
    timeline.menuDeclaredDurationSeconds = 1.29;
    timeline.menuRevealTotalSeconds = 1.39;
    timeline.menuRevealCoreSeconds = 1.09;
    timeline.pointerTransitionThreshold = 0.98;
    timeline.cardReveal = {
        TitleCardRevealTiming{TitleCardSlot::start, 0.0, 0.58, 0.01, 0.015, 0.06},
        TitleCardRevealTiming{TitleCardSlot::quickStart, 0.05, 0.66, 0.03, -0.01, 0.04},
        TitleCardRevealTiming{TitleCardSlot::records, 0.11, 0.74, 0.04, 0.01, 0.02},
        TitleCardRevealTiming{TitleCardSlot::deck, 0.14, 0.82, 0.02, 0.03, 0.045},
        TitleCardRevealTiming{TitleCardSlot::research, 0.19, 0.9, 0.035, 0.04, 0.03}
    };
    return timeline;
}

constexpr TitleTimelineMetrics title_timeline_metrics = makeTitleTimelineMetrics();

[[nodiscard]] constexpr double clampValue(
    const double value,
    const double minimum,
    const double maximum
) noexcept {
    return std::max(minimum, std::min(maximum, value));
}

[[nodiscard]] constexpr double lerp(
    const double start,
    const double end,
    const double progress
) noexcept {
    return start + ((end - start) * progress);
}

[[nodiscard]] double easeOutExpo(const double progress) noexcept {
    const double clamped = clampValue(progress, 0.0, 1.0);
    if (clamped <= 0.0) {
        return 0.0;
    }
    if (clamped >= 1.0) {
        return 1.0;
    }
    return 1.0 - std::pow(2.0, -10.0 * clamped);
}

[[nodiscard]] double easeInExpo(const double progress) noexcept {
    const double clamped = clampValue(progress, 0.0, 1.0);
    if (clamped <= 0.0) {
        return 0.0;
    }
    if (clamped >= 1.0) {
        return 1.0;
    }
    return std::pow(2.0, (10.0 * clamped) - 10.0);
}

[[nodiscard]] double easeOutCubic(const double progress) noexcept {
    const double clamped = clampValue(progress, 0.0, 1.0);
    const double inverse = 1.0 - clamped;
    return 1.0 - (inverse * inverse * inverse);
}

[[nodiscard]] bool finitePositive(const double value) noexcept {
    return std::isfinite(value) && value > 0.0;
}

[[nodiscard]] bool finiteNonNegative(const double value) noexcept {
    return std::isfinite(value) && value >= 0.0;
}

[[nodiscard]] bool finiteRect(const RoundedRectD& rect) noexcept {
    return std::isfinite(rect.x)
        && std::isfinite(rect.y)
        && finiteNonNegative(rect.width)
        && finiteNonNegative(rect.height)
        && finiteNonNegative(rect.radius);
}

[[nodiscard]] bool finiteTypography(const TypographyMetrics& typography) noexcept {
    return finitePositive(typography.size)
        && finitePositive(typography.lineHeight)
        && typography.weight > 0U;
}

[[nodiscard]] bool finitePoint(const PointD& point) noexcept {
    return std::isfinite(point.x) && std::isfinite(point.y);
}

[[nodiscard]] double sampleRevealProgress(
    const double revealClockElapsedSeconds,
    const double delaySeconds,
    const double durationSeconds
) noexcept {
    const double trackElapsed = revealClockElapsedSeconds - delaySeconds;
    if (trackElapsed <= 0.0) {
        return 0.0;
    }
    const double endpointTolerance = std::numeric_limits<double>::epsilon()
        * 8.0
        * std::max(1.0, durationSeconds);
    if (trackElapsed >= durationSeconds
        || durationSeconds - trackElapsed <= endpointTolerance) {
        return 1.0;
    }
    return clampValue(trackElapsed / durationSeconds, 0.0, 1.0);
}

[[nodiscard]] double sampleTitleTransitionProgress(
    const double elapsedSeconds,
    const TitleTimelineMetrics& timeline
) noexcept {
    const double accelDuration = timeline.transitionAccelSeconds;
    const double cruiseDuration = timeline.transitionCruiseSeconds;
    const double decelDuration = timeline.transitionDecelSeconds;
    const double velocityWeightedDuration = (accelDuration / expo_boundary_slope)
        + cruiseDuration
        + (decelDuration / expo_boundary_slope);
    const double cruiseVelocity = 1.0 / velocityWeightedDuration;
    const double accelEnd = (cruiseVelocity * accelDuration) / expo_boundary_slope;
    const double cruiseEnd = accelEnd + (cruiseVelocity * cruiseDuration);

    if (elapsedSeconds <= 0.0) {
        return 0.0;
    }
    if (elapsedSeconds <= accelDuration) {
        return lerp(0.0, accelEnd, easeInExpo(elapsedSeconds / accelDuration));
    }
    const double cruiseEndSeconds = accelDuration + cruiseDuration;
    if (elapsedSeconds <= cruiseEndSeconds) {
        return lerp(
            accelEnd,
            cruiseEnd,
            (elapsedSeconds - accelDuration) / cruiseDuration
        );
    }
    const double transitionEndSeconds = cruiseEndSeconds + decelDuration;
    if (elapsedSeconds < transitionEndSeconds) {
        return lerp(
            cruiseEnd,
            1.0,
            easeOutExpo((elapsedSeconds - cruiseEndSeconds) / decelDuration)
        );
    }
    return 1.0;
}

[[nodiscard]] TitlePaneRenderMetrics samplePaneRenderMetrics(
    const RoundedRectD& settledRect,
    const double ease,
    const double offsetX,
    const double offsetY
) noexcept {
    const double clampedEase = clampValue(ease, 0.0, 1.0);
    RoundedRectD panelRect = settledRect;
    panelRect.x += (1.0 - clampedEase) * offsetX;
    panelRect.y += (1.0 - clampedEase) * offsetY;
    return {panelRect, clampedEase};
}

[[nodiscard]] bool validTitleEntranceSource(const UiLayoutSnapshot& snapshot) noexcept {
    const ViewportMetrics& viewport = snapshot.viewport;
    const TitleLayoutMetrics& title = snapshot.title;
    const TitleTimelineMetrics& timeline = title.timeline;
    const double transitionSegmentTotal = timeline.transitionAccelSeconds
        + timeline.transitionCruiseSeconds
        + timeline.transitionDecelSeconds;
    if (!finitePositive(viewport.ww)
        || !finitePositive(viewport.wh)
        || !finitePositive(viewport.uiww)
        || !finitePositive(viewport.uiScale)
        || !finitePositive(viewport.scaledUiww)
        || !finiteRect(viewport.safeAreaRect)
        || !finitePositive(viewport.safeAreaRect.width)
        || !finitePositive(viewport.safeAreaRect.height)
        || !finiteRect(title.cardPane)
        || !finiteRect(title.utilityPane)
        || !finiteNonNegative(timeline.menuAppearStartDelaySeconds)
        || !finitePositive(timeline.transitionAccelSeconds)
        || !finitePositive(timeline.transitionCruiseSeconds)
        || !finitePositive(timeline.transitionDecelSeconds)
        || !finitePositive(timeline.transitionTotalSeconds)
        || !finitePositive(timeline.menuRevealTotalSeconds)
        || !finitePositive(timeline.menuRevealCoreSeconds)) {
        return false;
    }
    const double transitionDurationTolerance = std::numeric_limits<double>::epsilon()
        * 8.0
        * std::max(1.0, timeline.transitionTotalSeconds);
    if (!finitePositive(transitionSegmentTotal)
        || std::abs(transitionSegmentTotal - timeline.transitionTotalSeconds)
            > transitionDurationTolerance) {
        return false;
    }
    for (std::size_t index = 0U; index < title_card_count; ++index) {
        const TitleCardMetrics& card = title.cards[index];
        const TitleCardRevealTiming& reveal = timeline.cardReveal[index];
        if (!finiteRect(card.settledRect)
            || !finiteTypography(card.descriptionTypography)
            || !finiteNonNegative(reveal.delaySeconds)
            || !finitePositive(reveal.durationSeconds)
            || !std::isfinite(reveal.offsetXRatio)
            || !std::isfinite(reveal.offsetYRatio)
            || !finiteNonNegative(reveal.scaleOffset)) {
            return false;
        }
    }
    for (const UtilityTileMetrics& tile : title.utilityTiles) {
        if (!finiteRect(tile.rect) || !finitePositive(tile.placeholderSize)) {
            return false;
        }
    }
    if (title.versionHistoryLink.available
        && (!finitePoint(title.versionHistoryLink.textAnchor)
            || !finiteRect(title.versionHistoryLink.iconRect)
            || !finitePositive(title.versionHistoryLink.iconRect.width)
            || !finitePositive(title.versionHistoryLink.iconRect.height)
            || !finiteRect(title.versionHistoryLink.hitRect)
            || !finitePositive(title.versionHistoryLink.hitRect.width)
            || !finitePositive(title.versionHistoryLink.hitRect.height))) {
        return false;
    }
    return true;
}

[[nodiscard]] bool validTitleEntranceRenderState(
    const TitleEntranceRenderState& state
) noexcept {
    if (!finiteNonNegative(state.elapsedSeconds)
        || !finiteNonNegative(state.transitionProgress)
        || state.transitionProgress > 1.0
        || !finiteNonNegative(state.transitionEase)
        || state.transitionEase > 1.0
        || !finiteNonNegative(state.revealClockElapsedSeconds)
        || !finitePositive(state.worldScale)
        || !finiteRect(state.cardPane.panelRect)
        || !finiteNonNegative(state.cardPane.alpha)
        || state.cardPane.alpha > 1.0
        || !finiteRect(state.utilityPane.panelRect)
        || !finiteNonNegative(state.utilityPane.alpha)
        || state.utilityPane.alpha > 1.0) {
        return false;
    }
    for (const TitleCardRenderMetrics& card : state.cards) {
        if (!finiteNonNegative(card.revealProgress)
            || card.revealProgress > 1.0
            || !finiteNonNegative(card.revealEase)
            || card.revealEase > 1.0
            || !finiteNonNegative(card.alpha)
            || card.alpha > 1.0
            || !finitePositive(card.entryScale)
            || !finiteNonNegative(card.startOffsetX)
            || !std::isfinite(card.offscreenStartX)
            || !finiteRect(card.panelRect)
            || !finiteTypography(card.titleTypography)
            || !finiteTypography(card.descriptionTypography)) {
            return false;
        }
    }
    for (const UtilityTileRenderMetrics& tile : state.utilityTiles) {
        if (!finiteNonNegative(tile.revealProgress)
            || tile.revealProgress > 1.0
            || !finiteNonNegative(tile.revealEase)
            || tile.revealEase > 1.0
            || !finiteNonNegative(tile.alpha)
            || tile.alpha > 1.0
            || !std::isfinite(tile.translateX)
            || !std::isfinite(tile.translateY)
            || !finiteRect(tile.panelRect)
            || !finitePositive(tile.placeholderSize)) {
            return false;
        }
    }
    if (state.versionHistoryLink.available
        && (!finiteNonNegative(state.versionHistoryLink.alpha)
            || state.versionHistoryLink.alpha > 1.0
            || !finitePoint(state.versionHistoryLink.textAnchor)
            || !finiteRect(state.versionHistoryLink.iconRect)
            || !finitePositive(state.versionHistoryLink.iconRect.width)
            || !finitePositive(state.versionHistoryLink.iconRect.height)
            || !finiteRect(state.versionHistoryLink.hitRect)
            || !finitePositive(state.versionHistoryLink.hitRect.width)
            || !finitePositive(state.versionHistoryLink.hitRect.height))) {
        return false;
    }
    return true;
}

[[nodiscard]] bool buildViewport(
    const LayoutInput& input,
    ViewportMetrics& viewport
) noexcept {
    const LogicalSafeAreaInsets& safeArea = input.logicalSafeArea;
    if (!std::isfinite(input.logicalWidth)
        || !std::isfinite(input.logicalHeight)
        || input.logicalWidth < 1.0
        || input.logicalHeight < 1.0
        || !finitePositive(input.uiScale)
        || !finiteNonNegative(input.versionHistoryLinkTextWidth)
        || !finiteNonNegative(safeArea.left)
        || !finiteNonNegative(safeArea.top)
        || !finiteNonNegative(safeArea.right)
        || !finiteNonNegative(safeArea.bottom)
        || safeArea.left >= input.logicalWidth
        || safeArea.right >= input.logicalWidth - safeArea.left
        || safeArea.top >= input.logicalHeight
        || safeArea.bottom >= input.logicalHeight - safeArea.top) {
        return false;
    }

    const double safeWidth = input.logicalWidth - safeArea.left - safeArea.right;
    const double safeHeight = input.logicalHeight - safeArea.top - safeArea.bottom;
    const double maximumUiWidth = safeHeight * game_aspect_ratio;
    const double uiww = std::floor(clampValue(safeWidth, 1.0, maximumUiWidth));
    const double scaledUiww = uiww * input.uiScale;
    const double scaledWh = safeHeight * input.uiScale;
    if (!finitePositive(safeWidth)
        || !finitePositive(safeHeight)
        || !finitePositive(maximumUiWidth)
        || !finitePositive(uiww)
        || !finitePositive(scaledUiww)
        || !finitePositive(scaledWh)) {
        return false;
    }

    viewport.ww = input.logicalWidth;
    viewport.wh = input.logicalHeight;
    viewport.uiww = uiww;
    viewport.uiOffsetX = safeArea.left + ((safeWidth - uiww) * 0.5);
    viewport.uiScale = input.uiScale;
    viewport.scaledUiww = scaledUiww;
    viewport.scaledWh = scaledWh;
    viewport.logicalSafeArea = safeArea;
    viewport.safeAreaRect = {
        safeArea.left,
        safeArea.top,
        safeWidth,
        safeHeight,
        0.0
    };
    viewport.logicalUiRect = {
        viewport.uiOffsetX,
        safeArea.top,
        uiww,
        safeHeight,
        0.0
    };
    return std::isfinite(viewport.uiOffsetX)
        && finiteRect(viewport.safeAreaRect)
        && finiteRect(viewport.logicalUiRect);
}

[[nodiscard]] OverlayPageMetrics buildOverlayPageMetrics(
    const ViewportMetrics& viewport
) noexcept {
    const double safeHeight = viewport.safeAreaRect.height;
    return {
        viewport.uiww * 0.018 * viewport.uiScale,
        viewport.uiww * 0.015 * viewport.uiScale,
        safeHeight * 0.025 * viewport.uiScale,
        safeHeight * 0.015 * viewport.uiScale,
        safeHeight * 0.014 * viewport.uiScale,
        safeHeight * 0.025 * viewport.uiScale,
        viewport.uiww * 0.006 * viewport.uiScale,
        viewport.uiww * 0.07 * viewport.uiScale,
        safeHeight * 0.035 * viewport.uiScale,
        viewport.uiww * 0.008 * viewport.uiScale,
        viewport.uiww * 0.003 * viewport.uiScale
    };
}

[[nodiscard]] TypographyMetrics resolveCardTitleTypography(
    const RoundedRectD& rect,
    const double uiScale,
    const bool compactHorizontal
) noexcept {
    const double panelRatio = rect.height > rect.width * 0.7 ? 0.095 : 0.08;
    const double compactSize = compactHorizontal ? rect.height * 0.28 : 0.0;
    const double size = std::max({16.0 * uiScale, rect.width * panelRatio, compactSize});
    return {size, size * 1.06, 700U};
}

struct UtilityPaneBuildResult final {
    RoundedRectD pane{};
    std::array<UtilityTileMetrics, utility_tile_count> tiles{};
};

[[nodiscard]] UtilityPaneBuildResult buildUtilityPane(
    const double paneRight,
    const double paneWidth,
    const double paneTop,
    const double sidePadding,
    const double verticalPadding,
    const ViewportMetrics& viewport,
    const double uiScale
) noexcept {
    constexpr double entryCount = static_cast<double>(utility_tile_count);
    const double tileGap = std::max(10.0 * uiScale, viewport.uiww * 0.008 * uiScale);
    const double baseContentWidth = std::max(1.0, paneWidth - (sidePadding * 2.0));
    const double targetTileSize = std::max(1.0, viewport.uiww * (68.0 / 2'560.0) * uiScale);
    const double baseTileSize = clampValue(
        (baseContentWidth - (tileGap * (entryCount - 1.0))) / entryCount,
        1.0,
        targetTileSize
    );
    const double maxPaneWidth = std::max(1.0, paneRight - viewport.uiOffsetX);
    const double maxTileSize = std::max(
        1.0,
        (
            maxPaneWidth
            - (sidePadding * 2.0)
            - (tileGap * (entryCount - 1.0))
        ) / entryCount
    );
    const double preferredTileSize = std::max(1.0, baseTileSize * 1.25);
    const double tileSize = clampValue(preferredTileSize, 1.0, maxTileSize);
    const double paneResultWidth = (tileSize * entryCount)
        + (tileGap * (entryCount - 1.0))
        + (sidePadding * 2.0);
    const double paneX = paneRight - paneResultWidth;
    const double contentWidth = std::max(1.0, paneResultWidth - (sidePadding * 2.0));
    const double paneHeight = std::max(1.0, tileSize + (verticalPadding * 2.0));
    const double rowWidth = (tileSize * entryCount) + (tileGap * (entryCount - 1.0));
    const double startX = paneX + sidePadding + std::max(0.0, (contentWidth - rowWidth) * 0.5);
    const double tileY = paneTop + ((paneHeight - tileSize) * 0.5);

    UtilityPaneBuildResult result{};
    result.pane = {
        paneX,
        paneTop,
        paneResultWidth,
        paneHeight,
        std::max(18.0 * uiScale, std::min(paneResultWidth, paneHeight) * 0.08)
    };
    constexpr std::array slots{
        UtilityTileSlot::setting,
        UtilityTileSlot::credits,
        UtilityTileSlot::achievements,
        UtilityTileSlot::exit
    };
    for (std::size_t index = 0U; index < utility_tile_count; ++index) {
        result.tiles[index] = {
            slots[index],
            {
                startX + (static_cast<double>(index) * (tileSize + tileGap)),
                tileY,
                tileSize,
                tileSize,
                std::max(8.0 * uiScale, tileSize * 0.18)
            },
            std::max(12.0 * uiScale, tileSize * 0.34)
        };
    }
    return result;
}

struct PaneVerticalLayout final {
    double cardPaneTop = 0.0;
    double utilityPaneTop = 0.0;
};

[[nodiscard]] PaneVerticalLayout buildInitialPaneVerticalLayout(
    const double cardPaneHeight,
    const double contentTop,
    const double contentHeight,
    const double uiScale
) noexcept {
    const double groupShift = std::max(
        10.0 * uiScale,
        contentHeight * 0.014 * uiScale
    );
    const double cardTop = contentTop + (contentHeight * 0.22) + groupShift;
    const double cardBottom = cardTop + std::max(1.0, cardPaneHeight);
    const double shiftedUtilityTop = contentTop + (contentHeight * 0.72) + groupShift;
    const double gapReduction = std::max(
        10.0 * uiScale,
        contentHeight * 0.012 * uiScale
    );
    const double minimumGap = std::max(
        18.0 * uiScale,
        contentHeight * 0.02 * uiScale
    );
    const double baseGap = std::max(0.0, shiftedUtilityTop - cardBottom);
    const double gap = std::max(minimumGap, baseGap - gapReduction);
    return {cardTop, cardBottom + gap};
}

[[nodiscard]] double resolvePaneGroupVerticalShift(
    const PaneVerticalLayout& layout,
    const double cardPaneHeight,
    const double utilityPaneHeight,
    const double contentTop,
    const double contentHeight,
    const double uiScale
) noexcept {
    const double resolvedHeight = std::max(1.0, cardPaneHeight);
    const double contentBottom = contentTop + contentHeight;
    const double centeredCardTop = contentTop + ((contentHeight - resolvedHeight) * 0.5);
    const double preferredShift = centeredCardTop - layout.cardPaneTop;
    const double groupTop = std::min(layout.cardPaneTop, layout.utilityPaneTop);
    const double groupBottom = std::max(
        layout.cardPaneTop + resolvedHeight,
        layout.utilityPaneTop + std::max(0.0, utilityPaneHeight)
    );
    const double screenMargin = std::max(8.0 * uiScale, contentHeight * 0.018);
    const double minimumShift = contentTop + screenMargin - groupTop;
    const double maximumShift = contentBottom - screenMargin - groupBottom;
    if (minimumShift > maximumShift) {
        return contentTop
            + ((contentHeight - (groupBottom - groupTop)) * 0.5)
            - groupTop;
    }
    return clampValue(preferredShift, minimumShift, maximumShift);
}

struct VerticalStack final {
    double versionTop = 0.0;
    double cardPaneTop = 0.0;
    double utilityPaneTop = 0.0;
    double gapBeforeCard = 0.0;
    double gapAfterCard = 0.0;
};

[[nodiscard]] VerticalStack resolveVerticalStack(
    const double uiScale,
    const double referenceTop,
    const double referenceBottom,
    const double referenceGap,
    const double versionHeight,
    const double cardPaneHeight,
    const double utilityPaneHeight
) noexcept {
    const double contentHeight = versionHeight + cardPaneHeight + utilityPaneHeight;
    if (uiScale <= 1.0) {
        const double availableGap = std::max(
            0.0,
            referenceBottom - referenceTop - contentHeight
        );
        const double distributedGap = availableGap * 0.5;
        const double cardTop = referenceTop + versionHeight + distributedGap;
        return {
            referenceTop,
            cardTop,
            cardTop + cardPaneHeight + distributedGap,
            distributedGap,
            distributedGap
        };
    }

    const double stackHeight = contentHeight + (referenceGap * 2.0);
    const double referenceCenter = (referenceTop + referenceBottom) * 0.5;
    const double versionTop = referenceCenter - (stackHeight * 0.5);
    const double cardTop = versionTop + versionHeight + referenceGap;
    return {
        versionTop,
        cardTop,
        cardTop + cardPaneHeight + referenceGap,
        referenceGap,
        referenceGap
    };
}

[[nodiscard]] double versionBlockHeight(
    const ViewportMetrics& viewport,
    const double uiScale,
    const bool hasLink
) noexcept {
    const double versionSize = viewport.uiww * 0.01 * uiScale;
    if (!hasLink) {
        return versionSize;
    }
    const double linkSize = viewport.uiww * 0.01 * uiScale;
    const double lineGap = std::max(
        4.0 * uiScale,
        viewport.wh * 0.005 * uiScale
    );
    return versionSize + linkSize + lineGap;
}

[[nodiscard]] bool buildVersionHistoryLinkMetrics(
    const ViewportMetrics& viewport,
    const TitleLayoutMetrics& title,
    const bool hasVersionHistoryLink,
    const double measuredTextWidth,
    TitleVersionHistoryLinkMetrics& out
) noexcept {
    out = {};
    if (!hasVersionHistoryLink) {
        return true;
    }

    TypographyMetrics versionTypography{};
    TypographyMetrics linkTypography{};
    TypographyMetrics fallbackTypography{};
    if (!tryResolveTypography(
            TypographyRole::h5,
            viewport,
            versionTypography
        )
        || !tryResolveTypography(
            TypographyRole::label,
            viewport,
            linkTypography
        )
        || !tryResolveTypography(
            TypographyRole::h6,
            viewport,
            fallbackTypography
        )) {
        return false;
    }

    const double uiScale = viewport.uiScale;
    const double textWidth = measuredTextWidth > 0.0
        ? measuredTextWidth
        : static_cast<double>(
            cirvivor::ui::data::title_version_history_fallback_text_units
        ) * fallbackTypography.size * 0.6;
    const double lineGap = std::max(
        4.0 * uiScale,
        viewport.wh * 0.005 * uiScale
    );
    const double linkY = title.versionLabelTop
        + versionTypography.size
        + lineGap;
    const double iconSize = std::max(
        10.0 * uiScale,
        linkTypography.size * 0.9504
    );
    const double iconGap = std::max(
        4.0 * uiScale,
        viewport.uiww * 0.0034 * uiScale
    );
    const double right = title.utilityPane.x + title.utilityPane.width;
    const double iconX = right - textWidth - iconGap - iconSize;
    const double iconY = linkY + ((linkTypography.size - iconSize) * 0.5);
    const double horizontalPadding = std::max(
        6.0 * uiScale,
        viewport.uiww * 0.004 * uiScale
    );
    const double verticalPadding = std::max(
        4.0 * uiScale,
        viewport.wh * 0.004 * uiScale
    );
    const double blockWidth = iconSize + iconGap + textWidth;
    const TitleVersionHistoryLinkMetrics candidate{
        true,
        {right, linkY},
        {iconX, iconY, iconSize, iconSize, 0.0},
        {
            right - blockWidth - horizontalPadding,
            linkY - verticalPadding,
            blockWidth + (horizontalPadding * 2.0),
            linkTypography.size + (verticalPadding * 2.0),
            0.0
        }
    };
    if (!finitePoint(candidate.textAnchor)
        || !finiteRect(candidate.iconRect)
        || !finitePositive(candidate.iconRect.width)
        || !finitePositive(candidate.iconRect.height)
        || !finiteRect(candidate.hitRect)
        || !finitePositive(candidate.hitRect.width)
        || !finitePositive(candidate.hitRect.height)) {
        return false;
    }
    out = candidate;
    return true;
}

[[nodiscard]] RoundedRectD buildLoadingLogoRect(
    const CircleD& circle,
    const ViewportMetrics& viewport
) noexcept {
    const double horizontalGap = std::max(18.0, viewport.safeAreaRect.height * 0.025);
    const double leftPadding = std::max(18.0, viewport.uiww * 0.02);
    const double availableWidth = std::max(
        64.0,
        (circle.center.x - circle.radius)
            - (viewport.uiOffsetX + leftPadding + horizontalGap)
    );
    const double preferredWidth = std::min(
        viewport.uiww * 0.28,
        circle.radius * 3.15
    ) * 0.8;
    const double width = std::min(preferredWidth, availableWidth);
    const double x = std::max(
        viewport.uiOffsetX + leftPadding,
        (circle.center.x - circle.radius) - horizontalGap - width
    );
    const double height = width * (title_logo_viewbox_height / title_logo_viewbox_width);
    return {x, circle.center.y - (height * 0.5), width, height, 0.0};
}

[[nodiscard]] RoundedRectD buildSettledLogoRect(
    const ViewportMetrics& viewport
) noexcept {
    const double width = viewport.uiww * 0.19 * 0.8;
    const double height = width * (title_logo_viewbox_height / title_logo_viewbox_width);
    return {
        viewport.safeAreaRect.x + (viewport.uiww * 0.11),
        viewport.safeAreaRect.y
            + (viewport.safeAreaRect.height * 0.5)
            - (height * 0.5),
        width,
        height,
        0.0
    };
}

[[nodiscard]] bool buildTitleLayout(
    const ViewportMetrics& viewport,
    const bool hasVersionHistoryLink,
    const double versionHistoryLinkTextWidth,
    TitleLayoutMetrics& title
) noexcept {
    const double uiScale = viewport.uiScale;
    const double safeLeft = viewport.safeAreaRect.x;
    const double safeTop = viewport.safeAreaRect.y;
    const double safeWidth = viewport.safeAreaRect.width;
    const double safeHeight = viewport.safeAreaRect.height;
    const double safeRight = safeLeft + safeWidth;
    const double safeBottom = safeTop + safeHeight;
    title.menuLogoAnchor = {
        safeLeft + (viewport.scaledUiww * 0.065),
        safeTop + (viewport.scaledWh * 0.11)
    };

    const double circleRadius = std::max(
        48.0,
        std::min(safeHeight * 0.115, viewport.uiww * 0.22)
    );
    const double outlineWidth = std::max(1.0, safeHeight * 0.00085);
    title.introCircle = {
        {
            viewport.uiOffsetX + (viewport.uiww * 0.5),
            safeTop + (safeHeight * 0.5)
        },
        circleRadius,
        outlineWidth
    };
    // JS oracle의 최종 X에는 ultrawide UIOffsetX가 더해지지 않는다.
    // Native safe-area의 full-viewport 원점만 더해 zero-inset desktop 좌표를 보존한다.
    title.settledCircle = {
        {safeLeft + (viewport.uiww * 0.35), safeTop + (safeHeight * 0.5)},
        circleRadius,
        outlineWidth
    };
    title.loadingLogoRect = buildLoadingLogoRect(title.introCircle, viewport);
    title.settledLogoRect = buildSettledLogoRect(viewport);

    const double gap = viewport.scaledUiww * 0.012 * title_card_menu_scale;
    const double columnWidth = viewport.scaledUiww * 0.15 * title_card_menu_scale;
    const double largeCardHeight = columnWidth;
    const double stackedAreaHeight = std::max(1.0, largeCardHeight - gap);
    const double quickStartHeight = stackedAreaHeight * (2.8 / 3.8);
    const double recordsHeight = stackedAreaHeight - quickStartHeight;
    const double layoutRadius = std::max(12.0 * uiScale, viewport.scaledWh * 0.018);
    const double rightColumnX = safeRight - (viewport.scaledUiww * 0.065) - columnWidth;
    const double leftColumnX = rightColumnX - gap - columnWidth;
    const double groupHeight = largeCardHeight + gap + quickStartHeight;
    const double topY = safeBottom - (viewport.scaledWh * 0.11) - groupHeight;
    const double bottomRowY = topY + largeCardHeight + gap;
    const double recordsY = topY + quickStartHeight + gap;

    constexpr std::array cardSlots{
        TitleCardSlot::start,
        TitleCardSlot::quickStart,
        TitleCardSlot::records,
        TitleCardSlot::deck,
        TitleCardSlot::research
    };
    const std::array baseRects{
        RoundedRectD{leftColumnX, topY, columnWidth, largeCardHeight, layoutRadius},
        RoundedRectD{rightColumnX, topY, columnWidth, quickStartHeight, layoutRadius},
        RoundedRectD{rightColumnX, recordsY, columnWidth, recordsHeight, layoutRadius},
        RoundedRectD{leftColumnX, bottomRowY, columnWidth, quickStartHeight, layoutRadius},
        RoundedRectD{rightColumnX, bottomRowY, columnWidth, quickStartHeight, layoutRadius}
    };

    double groupMinX = std::numeric_limits<double>::infinity();
    double groupMinY = std::numeric_limits<double>::infinity();
    double groupMaxX = -std::numeric_limits<double>::infinity();
    double groupMaxY = -std::numeric_limits<double>::infinity();
    for (const RoundedRectD& rect : baseRects) {
        groupMinX = std::min(groupMinX, rect.x);
        groupMinY = std::min(groupMinY, rect.y);
        groupMaxX = std::max(groupMaxX, rect.x + rect.width);
        groupMaxY = std::max(groupMaxY, rect.y + rect.height);
    }
    const double menuGroupWidth = groupMaxX - groupMinX;
    const double menuGroupHeight = groupMaxY - groupMinY;
    const double verticalPadding = std::max(
        24.0 * uiScale,
        safeHeight * 0.026 * uiScale
    );
    const double sidePadding = verticalPadding;
    const double rightOuterGap = std::max(
        28.0 * uiScale,
        viewport.uiww * 0.024 * uiScale
    );
    const double paneRight = safeRight - rightOuterGap;
    const double paneLeft = paneRight - menuGroupWidth - (sidePadding * 2.0);
    const double paneWidth = menuGroupWidth + (sidePadding * 2.0);
    const double cardPaneHeight = std::max(1.0, menuGroupHeight + (verticalPadding * 2.0));

    const UtilityPaneBuildResult unshiftedUtility = buildUtilityPane(
        paneRight,
        paneWidth,
        0.0,
        sidePadding,
        verticalPadding,
        viewport,
        uiScale
    );

    const double referenceSidePadding = sidePadding / uiScale;
    const double referenceVerticalPadding = verticalPadding / uiScale;
    const double referencePaneRight = safeRight - std::max(28.0, viewport.uiww * 0.024);
    const double referencePaneWidth = (menuGroupWidth / uiScale)
        + (referenceSidePadding * 2.0);
    const UtilityPaneBuildResult referenceUtility = buildUtilityPane(
        referencePaneRight,
        referencePaneWidth,
        0.0,
        referenceSidePadding,
        referenceVerticalPadding,
        viewport,
        1.0
    );
    const double referenceCardPaneHeight = cardPaneHeight / uiScale;
    const PaneVerticalLayout referenceInitial = buildInitialPaneVerticalLayout(
        referenceCardPaneHeight,
        safeTop,
        safeHeight,
        1.0
    );
    const double referenceShift = resolvePaneGroupVerticalShift(
        referenceInitial,
        referenceCardPaneHeight,
        referenceUtility.pane.height,
        safeTop,
        safeHeight,
        1.0
    );
    const double referenceCardTop = referenceInitial.cardPaneTop + referenceShift;
    const double referenceUtilityTop = referenceInitial.utilityPaneTop + referenceShift;
    const double referenceGap = std::max(
        0.0,
        referenceUtilityTop - (referenceCardTop + referenceCardPaneHeight)
    );
    const double currentVersionHeight = versionBlockHeight(
        viewport,
        uiScale,
        hasVersionHistoryLink
    );
    const double referenceVersionHeight = versionBlockHeight(
        viewport,
        1.0,
        hasVersionHistoryLink
    );
    const double referenceTop = referenceCardTop - referenceGap - referenceVersionHeight;
    const double referenceBottom = referenceUtilityTop + referenceUtility.pane.height;
    const VerticalStack stack = resolveVerticalStack(
        uiScale,
        referenceTop,
        referenceBottom,
        referenceGap,
        currentVersionHeight,
        cardPaneHeight,
        unshiftedUtility.pane.height
    );

    title.cardPane = {
        paneLeft,
        stack.cardPaneTop,
        paneWidth,
        cardPaneHeight,
        std::max(18.0 * uiScale, std::min(paneWidth, cardPaneHeight) * 0.06)
    };
    title.utilityPane = unshiftedUtility.pane;
    title.utilityPane.y += stack.utilityPaneTop;
    title.versionLabelTop = stack.versionTop;
    title.gapBeforeCardPane = stack.gapBeforeCard;
    title.gapAfterCardPane = stack.gapAfterCard;
    if (!buildVersionHistoryLinkMetrics(
            viewport,
            title,
            hasVersionHistoryLink,
            versionHistoryLinkTextWidth,
            title.versionHistoryLink
        )) {
        return false;
    }

    const double cardOffsetX = (paneLeft + sidePadding) - groupMinX;
    const double cardOffsetY = (stack.cardPaneTop + verticalPadding) - groupMinY;
    TypographyMetrics descriptionTypography{};
    if (!tryResolveTypography(TypographyRole::cardDescription, viewport, descriptionTypography)) {
        return false;
    }
    constexpr std::array hasDescription{false, true, false, true, true};
    for (std::size_t index = 0U; index < title_card_count; ++index) {
        RoundedRectD settled = baseRects[index];
        settled.x += cardOffsetX;
        settled.y += cardOffsetY;
        settled.radius = std::max(
            12.0 * uiScale,
            std::min(settled.width, settled.height) * 0.08
        );
        title.cards[index] = {
            cardSlots[index],
            baseRects[index],
            settled,
            resolveCardTitleTypography(
                settled,
                uiScale,
                cardSlots[index] == TitleCardSlot::records
            ),
            descriptionTypography,
            hasDescription[index]
        };
    }

    title.utilityTiles = unshiftedUtility.tiles;
    for (UtilityTileMetrics& tile : title.utilityTiles) {
        tile.rect.y += stack.utilityPaneTop;
    }
    title.timeline = title_timeline_metrics;

    if (!finiteRect(title.loadingLogoRect)
        || !finiteRect(title.settledLogoRect)
        || !finiteRect(title.cardPane)
        || !finiteRect(title.utilityPane)
        || !std::isfinite(title.versionLabelTop)
        || !finitePositive(title.introCircle.radius)
        || !finitePositive(title.settledCircle.radius)) {
        return false;
    }
    for (const TitleCardMetrics& card : title.cards) {
        if (!finiteRect(card.layoutRect)
            || !finiteRect(card.settledRect)
            || !finiteTypography(card.titleTypography)
            || !finiteTypography(card.descriptionTypography)) {
            return false;
        }
    }
    for (const UtilityTileMetrics& tile : title.utilityTiles) {
        if (!finiteRect(tile.rect) || !finitePositive(tile.placeholderSize)) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] RoundedRectD buildDialogRect(
    const ViewportMetrics& viewport,
    const double widthRatio,
    const double heightRatio
) noexcept {
    const double width = viewport.uiww * widthRatio * viewport.uiScale;
    const double height = viewport.safeAreaRect.height
        * heightRatio
        * viewport.uiScale;
    return {
        viewport.safeAreaRect.x + ((viewport.safeAreaRect.width - width) * 0.5),
        viewport.safeAreaRect.y + ((viewport.safeAreaRect.height - height) * 0.5),
        width,
        height,
        viewport.uiww * 0.006 * viewport.uiScale
    };
}

[[nodiscard]] OverlayLayoutMetrics buildOverlayLayoutMetrics(
    const ViewportMetrics& viewport
) noexcept {
    OverlayLayoutMetrics result{};
    result.mapSelect = {
        buildDialogRect(viewport, 0.52, 0.68),
        title_overlay_base_dim
    };
    result.exit = {
        buildDialogRect(viewport, 0.3, 0.2),
        title_overlay_base_dim
    };
    result.externalLinkWarning = {
        buildDialogRect(
            viewport,
            0.3,
            0.2 * external_link_warning_height_multiplier
        ),
        title_overlay_base_dim
    };
    result.titleBaseDim = title_overlay_base_dim;
    result.titleIcon = {
        viewport.uiww * 0.0022 * viewport.uiScale,
        0.92,
        1.08,
        2.5
    };
    return result;
}

[[nodiscard]] bool validOverlayLayoutMetrics(
    const OverlayLayoutMetrics& metrics
) noexcept {
    return finiteRect(metrics.mapSelect.panelRect)
        && finiteNonNegative(metrics.mapSelect.baseDim)
        && metrics.mapSelect.baseDim <= 1.0
        && finiteRect(metrics.exit.panelRect)
        && finiteNonNegative(metrics.exit.baseDim)
        && metrics.exit.baseDim <= 1.0
        && finiteRect(metrics.externalLinkWarning.panelRect)
        && finiteNonNegative(metrics.externalLinkWarning.baseDim)
        && metrics.externalLinkWarning.baseDim <= 1.0
        && finiteNonNegative(metrics.titleBaseDim)
        && metrics.titleBaseDim <= 1.0
        && finitePositive(metrics.titleIcon.gap)
        && finitePositive(metrics.titleIcon.maxHeightRatio)
        && finitePositive(metrics.titleIcon.baseScaleMultiplier)
        && finitePositive(metrics.titleIcon.gapMultiplier);
}

[[nodiscard]] bool validOverlayPresentation(
    const OverlayPresentationMetrics& presentation
) noexcept {
    return std::isfinite(presentation.alpha)
        && presentation.alpha >= 0.0
        && presentation.alpha <= 1.0
        && std::isfinite(presentation.dimAlpha)
        && presentation.dimAlpha >= 0.0
        && presentation.dimAlpha <= 1.0
        && finitePositive(presentation.contentScale)
        && finiteNonNegative(presentation.contentBlur);
}

} // namespace

bool UiLayoutMetrics::tryUpdate(const LayoutInput& input) noexcept {
    UiLayoutSnapshot candidate{};
    if (!buildViewport(input, candidate.viewport)) {
        return false;
    }

    candidate.overlayPage = buildOverlayPageMetrics(candidate.viewport);
    for (std::size_t index = 0U; index < typography_role_count; ++index) {
        if (!tryResolveTypography(
                static_cast<TypographyRole>(index),
                candidate.viewport,
                candidate.typography[index]
            )) {
            return false;
        }
    }
    if (!buildTitleLayout(
            candidate.viewport,
            input.hasVersionHistoryLink,
            input.versionHistoryLinkTextWidth,
            candidate.title
        )) {
        return false;
    }
    candidate.overlays = buildOverlayLayoutMetrics(candidate.viewport);
    if (!validOverlayLayoutMetrics(candidate.overlays)) {
        return false;
    }
    candidate.exitDialog = candidate.overlays.exit.panelRect;

    candidate.revision = snapshot_.revision + 1U;
    snapshot_ = candidate;
    hasSnapshot_ = true;
    return true;
}

bool UiLayoutMetrics::hasSnapshot() const noexcept {
    return hasSnapshot_;
}

const UiLayoutSnapshot& UiLayoutMetrics::snapshot() const noexcept {
    return snapshot_;
}

const DarkThemeMetrics& darkThemeMetrics() noexcept {
    return dark_theme_metrics;
}

const ThemeMetrics& lightThemeMetrics() noexcept {
    return light_theme_metrics;
}

const ThemeMetrics& themeMetrics(const ThemeVariant variant) noexcept {
    switch (variant) {
    case ThemeVariant::light:
        return light_theme_metrics;
    case ThemeVariant::dark:
        return dark_theme_metrics;
    }
    return dark_theme_metrics;
}

bool tryResolveTypography(
    const TypographyRole role,
    const ViewportMetrics& viewport,
    TypographyMetrics& out
) noexcept {
    const std::size_t index = static_cast<std::size_t>(role);
    if (index >= typography_definitions.size()
        || !finitePositive(viewport.uiww)
        || !finitePositive(viewport.uiScale)) {
        return false;
    }

    const TypographyDefinition& definition = typography_definitions[index];
    const double size = (definition.sizeUiWidthPercent / 100.0)
        * viewport.uiww
        * viewport.uiScale;
    const TypographyMetrics candidate{
        size,
        size * definition.lineHeightScale,
        definition.weight
    };
    if (!finiteTypography(candidate)) {
        return false;
    }
    out = candidate;
    return true;
}

bool trySampleOverlayOpen(
    const double elapsedSeconds,
    OverlayPresentationMetrics& out
) noexcept {
    if (!finiteNonNegative(elapsedSeconds)) {
        return false;
    }
    const double progress = clampValue(elapsedSeconds / overlay_transition_seconds, 0.0, 1.0);
    const double eased = easeOutExpo(progress);
    out = {
        eased,
        eased,
        lerp(0.9, 1.0, eased),
        lerp(10.0, 0.0, eased)
    };
    return true;
}

bool trySampleOverlayClose(
    const double elapsedSeconds,
    const OverlayPresentationMetrics& start,
    OverlayPresentationMetrics& out
) noexcept {
    if (!finiteNonNegative(elapsedSeconds) || !validOverlayPresentation(start)) {
        return false;
    }
    const double progress = clampValue(elapsedSeconds / overlay_transition_seconds, 0.0, 1.0);
    const double eased = easeInExpo(progress);
    out = {
        lerp(start.alpha, 0.0, eased),
        lerp(start.dimAlpha, 0.0, eased),
        lerp(start.contentScale, 0.9, eased),
        lerp(start.contentBlur, 10.0, eased)
    };
    return true;
}

bool tryResolveOverlayDialogRenderMetrics(
    const OverlayDialogMetrics& dialog,
    const OverlayPageMetrics& page,
    const double contentScale,
    OverlayDialogRenderMetrics& out
) noexcept {
    if (!finiteRect(dialog.panelRect)
        || !finitePositive(dialog.panelRect.width)
        || !finitePositive(dialog.panelRect.height)
        || !finiteNonNegative(page.footerBottom)
        || !finiteNonNegative(page.interactButtonWidth)
        || !finiteNonNegative(page.interactButtonHeight)
        || !finiteNonNegative(page.interactButtonMargin)
        || !finiteNonNegative(page.interactButtonRadius)
        || !finitePositive(contentScale)) {
        return false;
    }

    const double panelWidth = dialog.panelRect.width * contentScale;
    const double panelHeight = dialog.panelRect.height * contentScale;
    const RoundedRectD panelRect{
        dialog.panelRect.x + ((dialog.panelRect.width - panelWidth) * 0.5),
        dialog.panelRect.y + ((dialog.panelRect.height - panelHeight) * 0.5),
        panelWidth,
        panelHeight,
        dialog.panelRect.radius * contentScale
    };
    const double margin = std::min(
        page.interactButtonMargin * contentScale,
        panelRect.width / 6.0
    );
    const double availableWidth = std::max(
        0.0,
        (panelRect.width - (margin * 3.0)) / 2.0
    );
    const double buttonWidth = std::min(
        page.interactButtonWidth * contentScale,
        availableWidth
    );
    const double buttonHeight = std::min(
        page.interactButtonHeight * contentScale,
        panelRect.height * 0.32
    );
    const double buttonY = panelRect.y
        + panelRect.height
        - (page.footerBottom * contentScale)
        - buttonHeight;
    const double confirmX = panelRect.x + panelRect.width - margin - buttonWidth;
    const double cancelX = confirmX - margin - buttonWidth;
    const double buttonRadius = page.interactButtonRadius * contentScale;
    const OverlayDialogRenderMetrics candidate{
        panelRect,
        {cancelX, buttonY, buttonWidth, buttonHeight, buttonRadius},
        {confirmX, buttonY, buttonWidth, buttonHeight, buttonRadius}
    };
    if (!finiteRect(candidate.panelRect)
        || !finitePositive(candidate.panelRect.width)
        || !finitePositive(candidate.panelRect.height)
        || !finiteRect(candidate.cancelButtonRect)
        || !finitePositive(candidate.cancelButtonRect.width)
        || !finitePositive(candidate.cancelButtonRect.height)
        || !finiteRect(candidate.confirmButtonRect)
        || !finitePositive(candidate.confirmButtonRect.width)
        || !finitePositive(candidate.confirmButtonRect.height)) {
        return false;
    }
    out = candidate;
    return true;
}

bool trySampleTitleEntrance(
    const UiLayoutSnapshot& snapshot,
    const double elapsedSeconds,
    TitleEntranceRenderState& out
) noexcept {
    if (!finiteNonNegative(elapsedSeconds) || !validTitleEntranceSource(snapshot)) {
        return false;
    }

    const ViewportMetrics& viewport = snapshot.viewport;
    const TitleLayoutMetrics& title = snapshot.title;
    const TitleTimelineMetrics& timeline = title.timeline;
    const double sampledRevealElapsed = std::min(
        elapsedSeconds,
        timeline.menuRevealTotalSeconds
    );

    TitleEntranceRenderState candidate{};
    candidate.elapsedSeconds = elapsedSeconds;
    candidate.transitionProgress = sampleTitleTransitionProgress(
        elapsedSeconds,
        timeline
    );
    candidate.transitionEase = easeOutExpo(candidate.transitionProgress);
    candidate.revealClockElapsedSeconds = std::max(
        0.0,
        sampledRevealElapsed - timeline.menuAppearStartDelaySeconds
    );
    candidate.worldScale = lerp(
        title_entrance_start_scale,
        1.0,
        candidate.transitionEase
    );

    const double scaledUiww = viewport.uiww * viewport.uiScale;
    const double screenCenterX = viewport.safeAreaRect.x
        + (viewport.safeAreaRect.width * 0.5);
    const double screenCenterY = viewport.safeAreaRect.y
        + (viewport.safeAreaRect.height * 0.5);
    const double safeRight = viewport.safeAreaRect.x + viewport.safeAreaRect.width;
    for (std::size_t index = 0U; index < title_card_count; ++index) {
        const TitleCardMetrics& card = title.cards[index];
        const TitleCardRevealTiming& reveal = timeline.cardReveal[index];
        const RoundedRectD& settledRect = card.settledRect;
        const double revealProgress = sampleRevealProgress(
            candidate.revealClockElapsedSeconds,
            reveal.delaySeconds,
            reveal.durationSeconds
        );
        const double revealEase = easeOutExpo(revealProgress);
        const double entryScale = lerp(1.0 + reveal.scaleOffset, 1.0, revealEase);
        const double width = settledRect.width * candidate.worldScale * entryScale;
        const double height = settledRect.height * candidate.worldScale * entryScale;
        const double finalCenterX = settledRect.x + (settledRect.width * 0.5);
        const double finalCenterY = settledRect.y + (settledRect.height * 0.5);
        const double baseCenterX = screenCenterX
            + ((finalCenterX - screenCenterX) * candidate.worldScale);
        const double baseCenterY = screenCenterY
            + ((finalCenterY - screenCenterY) * candidate.worldScale);
        const double startOffsetX = scaledUiww
            * (title_entrance_offset_x_ratio + reveal.offsetXRatio);
        const double offscreenStartX = std::max(
            safeRight + (settledRect.width * 0.12),
            finalCenterX + startOffsetX
        );
        const double centerX = lerp(offscreenStartX, baseCenterX, revealEase);
        // 현재 JS oracle은 선언된 per-card Y ratio를 소비하지 않고 X축에서만 진입합니다.
        const double centerY = baseCenterY;
        RoundedRectD panelRect{
            centerX - (width * 0.5),
            centerY - (height * 0.5),
            width,
            height,
            std::max(12.0 * viewport.uiScale, std::min(width, height) * 0.08)
        };
        const TypographyMetrics titleTypography = resolveCardTitleTypography(
            panelRect,
            viewport.uiScale,
            card.slot == TitleCardSlot::records
        );
        candidate.cards[index] = {
            card.slot,
            revealProgress,
            revealEase,
            clampValue((revealProgress - 0.08) / 0.42, 0.0, 1.0),
            entryScale,
            startOffsetX,
            offscreenStartX,
            panelRect,
            titleTypography,
            card.descriptionTypography,
            card.hasDescription
        };
    }

    const double cardPaneDuration = std::max(
        0.28,
        timeline.menuRevealCoreSeconds * 0.54
    );
    const double utilityPaneDelay = std::min(
        0.16,
        timeline.menuRevealCoreSeconds * 0.18
    );
    const double utilityPaneDuration = std::max(
        0.24,
        timeline.menuRevealCoreSeconds * 0.44
    );
    if (!finitePositive(cardPaneDuration)
        || !finiteNonNegative(utilityPaneDelay)
        || !finitePositive(utilityPaneDuration)) {
        return false;
    }
    const double cardPaneProgress = sampleRevealProgress(
        candidate.revealClockElapsedSeconds,
        0.0,
        cardPaneDuration
    );
    const double cardPaneEase = easeOutCubic(cardPaneProgress);
    const double utilityPaneProgress = sampleRevealProgress(
        candidate.revealClockElapsedSeconds,
        utilityPaneDelay,
        utilityPaneDuration
    );
    const double utilityPaneEase = easeOutCubic(utilityPaneProgress);
    candidate.cardPane = samplePaneRenderMetrics(
        title.cardPane,
        cardPaneEase,
        scaledUiww * 0.032,
        0.0
    );
    candidate.utilityPane = samplePaneRenderMetrics(
        title.utilityPane,
        utilityPaneEase,
        scaledUiww * 0.026,
        0.0
    );
    if (title.versionHistoryLink.available) {
        const double linkTranslateX = (1.0 - utilityPaneEase)
            * (scaledUiww * 0.026);
        candidate.versionHistoryLink = {
            true,
            utilityPaneEase,
            {
                title.versionHistoryLink.textAnchor.x + linkTranslateX,
                title.versionHistoryLink.textAnchor.y
            },
            title.versionHistoryLink.iconRect,
            title.versionHistoryLink.hitRect
        };
        candidate.versionHistoryLink.iconRect.x += linkTranslateX;
        candidate.versionHistoryLink.hitRect.x += linkTranslateX;
    }

    const double tileBaseDelay = std::min(
        0.24,
        timeline.menuRevealCoreSeconds * 0.26
    );
    const double tileStepDelay = std::min(
        0.05,
        timeline.menuRevealCoreSeconds * 0.08
    );
    const double tileDuration = std::max(
        0.22,
        timeline.menuRevealCoreSeconds * 0.32
    );
    if (!finiteNonNegative(tileBaseDelay)
        || !finiteNonNegative(tileStepDelay)
        || !finitePositive(tileDuration)) {
        return false;
    }
    const double paneTranslateX = (1.0 - utilityPaneEase) * (scaledUiww * 0.026);
    for (std::size_t index = 0U; index < utility_tile_count; ++index) {
        const UtilityTileMetrics& tile = title.utilityTiles[index];
        const double revealProgress = sampleRevealProgress(
            candidate.revealClockElapsedSeconds,
            tileBaseDelay + (tileStepDelay * static_cast<double>(index)),
            tileDuration
        );
        const double revealEase = easeOutCubic(revealProgress);
        const double translateX = paneTranslateX
            + ((1.0 - revealEase) * std::min(scaledUiww * 0.014, tile.rect.width * 0.28));
        RoundedRectD panelRect = tile.rect;
        panelRect.x += translateX;
        candidate.utilityTiles[index] = {
            tile.slot,
            revealProgress,
            revealEase,
            revealEase,
            translateX,
            0.0,
            panelRect,
            tile.placeholderSize
        };
    }

    if (!validTitleEntranceRenderState(candidate)) {
        return false;
    }
    out = candidate;
    return true;
}

bool tryResolveTitleOverlayIconPlacement(
    const TitleOverlayIconLayoutMetrics& layout,
    const TitleOverlayIconInput& input,
    TitleOverlayIconPlacement& out
) noexcept {
    if (!finitePoint(input.titleOrigin)
        || !finitePositive(input.titleFontSize)
        || !finitePositive(input.aspectRatio)
        || !finitePositive(input.scaleMultiplier)
        || !finitePositive(layout.gap)
        || !finitePositive(layout.maxHeightRatio)
        || !finitePositive(layout.baseScaleMultiplier)
        || !finitePositive(layout.gapMultiplier)) {
        return false;
    }

    const double iconHeight = input.titleFontSize
        * layout.maxHeightRatio
        * layout.baseScaleMultiplier
        * input.scaleMultiplier;
    const double iconWidth = iconHeight * input.aspectRatio;
    TitleOverlayIconPlacement candidate{
        {
            input.titleOrigin.x,
            input.titleOrigin.y + ((input.titleFontSize - iconHeight) * 0.5),
            iconWidth,
            iconHeight,
            0.0
        },
        iconWidth + (layout.gap * layout.gapMultiplier)
    };
    if (!finiteRect(candidate.iconRect)
        || !finitePositive(candidate.iconRect.width)
        || !finitePositive(candidate.iconRect.height)
        || !finitePositive(candidate.titleOffsetX)) {
        return false;
    }
    out = candidate;
    return true;
}

} // namespace cirvivor::ui::layout
