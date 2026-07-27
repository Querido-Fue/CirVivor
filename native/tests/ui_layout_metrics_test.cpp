#include "ui/layout/ui_layout_metrics.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <string_view>

namespace allocation_probe {

thread_local bool enabled = false;
thread_local std::size_t count = 0U;

} // namespace allocation_probe

void* operator new(const std::size_t size) {
    if (allocation_probe::enabled) {
        ++allocation_probe::count;
    }
    if (void* const memory = std::malloc(size == 0U ? 1U : size)) {
        return memory;
    }
    throw std::bad_alloc();
}

void* operator new[](const std::size_t size) {
    return ::operator new(size);
}

void operator delete(void* const memory) noexcept {
    std::free(memory);
}

void operator delete[](void* const memory) noexcept {
    ::operator delete(memory);
}

void operator delete(void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

void operator delete[](void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

namespace {

using cirvivor::ui::layout::LayoutInput;
using cirvivor::ui::layout::LogicalSafeAreaInsets;
using cirvivor::ui::layout::OverlayDialogRenderMetrics;
using cirvivor::ui::layout::OverlayPresentationMetrics;
using cirvivor::ui::layout::ThemeColor;
using cirvivor::ui::layout::ThemeVariant;
using cirvivor::ui::layout::TitleCardSlot;
using cirvivor::ui::layout::TitleEntranceRenderState;
using cirvivor::ui::layout::TitleOverlayIconInput;
using cirvivor::ui::layout::TitleOverlayIconPlacement;
using cirvivor::ui::layout::TitleVersionHistoryLinkMetrics;
using cirvivor::ui::layout::TypographyMetrics;
using cirvivor::ui::layout::TypographyRole;
using cirvivor::ui::layout::UiLayoutMetrics;
using cirvivor::ui::layout::UiLayoutSnapshot;
using cirvivor::ui::layout::darkThemeMetrics;
using cirvivor::ui::layout::lightThemeMetrics;
using cirvivor::ui::layout::themeMetrics;
using cirvivor::ui::layout::tryResolveTypography;
using cirvivor::ui::layout::tryResolveTitleOverlayIconPlacement;
using cirvivor::ui::layout::tryResolveOverlayDialogRenderMetrics;
using cirvivor::ui::layout::trySampleOverlayClose;
using cirvivor::ui::layout::trySampleOverlayOpen;
using cirvivor::ui::layout::trySampleTitleEntrance;

class TestFailure final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void require(
    const bool condition,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!condition) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

void requireNear(
    const double actual,
    const double expected,
    const double tolerance,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!std::isfinite(actual) || std::abs(actual - expected) > tolerance) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
            + " (actual=" + std::to_string(actual)
            + ", expected=" + std::to_string(expected) + ')'
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)
#define REQUIRE_NEAR(actual, expected, tolerance) \
    requireNear((actual), (expected), (tolerance), #actual " ~= " #expected, __FILE__, __LINE__)

void requireColor(
    const ThemeColor& actual,
    const std::uint8_t red,
    const std::uint8_t green,
    const std::uint8_t blue,
    const double alpha = 1.0
) {
    REQUIRE(actual.red == red);
    REQUIRE(actual.green == green);
    REQUIRE(actual.blue == blue);
    REQUIRE_NEAR(actual.alpha, alpha, 1.0e-15);
}

[[nodiscard]] UiLayoutSnapshot buildGoldenSnapshot() {
    UiLayoutMetrics metrics;
    REQUIRE(metrics.tryUpdate({1'280.0, 720.0, 1.0, true}));
    REQUIRE(metrics.hasSnapshot());
    return metrics.snapshot();
}

void testDarkThemeCorePaletteMatchesOracle() {
    const auto& theme = darkThemeMetrics();
    REQUIRE(&themeMetrics(ThemeVariant::dark) == &theme);
    REQUIRE(&themeMetrics(static_cast<ThemeVariant>(255U)) == &theme);
    requireColor(theme.background, 5U, 3U, 10U);
    requireColor(theme.titleBackground, 5U, 3U, 10U);
    constexpr std::array expectedGradient{
        std::array<std::uint8_t, 3U>{33U, 7U, 51U},
        std::array<std::uint8_t, 3U>{19U, 5U, 31U},
        std::array<std::uint8_t, 3U>{9U, 3U, 16U},
        std::array<std::uint8_t, 3U>{42U, 6U, 39U},
        std::array<std::uint8_t, 3U>{4U, 2U, 8U}
    };
    for (std::size_t index = 0U; index < expectedGradient.size(); ++index) {
        requireColor(
            theme.titleGradient[index],
            expectedGradient[index][0],
            expectedGradient[index][1],
            expectedGradient[index][2]
        );
    }
    requireColor(theme.logoFill, 224U, 224U, 224U);
    requireColor(theme.loadingAccent, 22U, 111U, 251U);
    requireColor(theme.titleEnemy, 240U, 230U, 255U, 0.5);
    requireColor(theme.menuForeground, 255U, 255U, 255U);
    requireColor(theme.overlayPanelBackground, 5U, 8U, 14U);
    requireColor(theme.overlayGlassBackground, 6U, 10U, 18U, 0.9);
    requireColor(theme.overlayGlassBorder, 92U, 112U, 142U, 0.34);
    requireColor(theme.overlayDivider, 255U, 255U, 255U, 0.08);
    requireColor(theme.confirmIdle, 22U, 111U, 251U);
    requireColor(theme.cancelIdle, 255U, 80U, 80U);
    REQUIRE_NEAR(theme.overlayGlassTintStrength, 0.54, 1.0e-15);
    REQUIRE_NEAR(theme.overlayGlassEdgeStrength, 0.13, 1.0e-15);
    REQUIRE_NEAR(theme.overlayDim, 0.5, 1.0e-15);
    REQUIRE_NEAR(theme.menuPanelFillOpacity, 0.048, 1.0e-15);
    REQUIRE_NEAR(theme.menuCardInnerLineOpacity, 0.12, 1.0e-15);

    constexpr std::array expectedFallbackGradient{
        std::array<std::uint8_t, 3U>{26U, 32U, 39U},
        std::array<std::uint8_t, 3U>{19U, 24U, 31U},
        std::array<std::uint8_t, 3U>{14U, 19U, 26U},
        std::array<std::uint8_t, 3U>{10U, 15U, 21U},
        std::array<std::uint8_t, 3U>{6U, 9U, 14U}
    };
    for (std::size_t index = 0U; index < expectedFallbackGradient.size(); ++index) {
        requireColor(
            theme.titleGradientFallback[index],
            expectedFallbackGradient[index][0],
            expectedFallbackGradient[index][1],
            expectedFallbackGradient[index][2]
        );
    }
    constexpr std::array expectedHaloOffsets{0.0, 0.06, 0.14, 0.3, 0.5, 0.72, 0.9, 1.0};
    constexpr std::array expectedHaloAlphaScales{0.0, 0.022, 0.03, 0.032, 0.024, 0.013, 0.004, 0.0};
    constexpr std::array expectedHaloAlphaMaxima{0.0, 0.038, 0.05, 0.054, 0.04, 0.022, 0.008, 0.0};
    for (std::size_t index = 0U; index < theme.loadingHaloStops.size(); ++index) {
        REQUIRE_NEAR(theme.loadingHaloStops[index].offset, expectedHaloOffsets[index], 1.0e-15);
        REQUIRE_NEAR(
            theme.loadingHaloStops[index].alphaScale,
            expectedHaloAlphaScales[index],
            1.0e-15
        );
        REQUIRE_NEAR(
            theme.loadingHaloStops[index].maxAlpha,
            expectedHaloAlphaMaxima[index],
            1.0e-15
        );
    }
    requireColor(theme.loadingHaloStops[1].color, 132U, 204U, 255U);
    requireColor(theme.loadingHaloStops[4].color, 56U, 151U, 255U);
    requireColor(theme.loadingRing, 102U, 188U, 255U);
    requireColor(theme.loadingRingShadow, 48U, 145U, 255U);
    REQUIRE_NEAR(theme.loadingRingAlphaScale, 0.052, 1.0e-15);
    REQUIRE_NEAR(theme.loadingRingAlphaMax, 0.09, 1.0e-15);
    REQUIRE_NEAR(theme.loadingRingShadowAlphaScale, 0.07, 1.0e-15);
    REQUIRE_NEAR(theme.loadingRingShadowAlphaMax, 0.12, 1.0e-15);
    requireColor(theme.loadingSurfaceHighlight, 214U, 248U, 255U);
    REQUIRE_NEAR(theme.loadingSurfaceHighlightAlpha, 0.95, 1.0e-15);
    requireColor(theme.loadingSurfaceShadow, 204U, 244U, 255U);
    REQUIRE_NEAR(theme.loadingSurfaceShadowAlpha, 0.45, 1.0e-15);
    requireColor(theme.titleShieldShadow, 20U, 10U, 40U);
    requireColor(theme.titleShieldLow, 157U, 109U, 255U);
    requireColor(theme.titleShieldHigh, 131U, 201U, 255U);
    requireColor(theme.titleShieldHighlight, 241U, 253U, 255U);
    requireColor(theme.menuIconFill, 255U, 255U, 255U);
    requireColor(theme.menuIconShadow, 26U, 26U, 26U);
    requireColor(theme.titleButtonNormal, 20U, 10U, 28U, 0.0);
    REQUIRE_NEAR(theme.titleButtonHover[1].offset, 0.8, 1.0e-15);
    requireColor(theme.titleButtonHover[1].color, 255U, 255U, 255U, 0.2);
    requireColor(theme.titleButtonHover[2].color, 255U, 255U, 255U, 0.0);
    requireColor(theme.titleButtonText, 255U, 255U, 255U);
    requireColor(theme.overlayPanelShadow, 0U, 0U, 0U, 0.0);
    REQUIRE(!theme.overlayPanelHasShadow);
    requireColor(theme.overlayControlInactive, 255U, 255U, 255U, 0.06);
    requireColor(theme.overlayControlHover, 255U, 255U, 255U, 0.12);
    requireColor(theme.linkIdle, 255U, 255U, 255U, 0.06);
    requireColor(theme.linkHover, 255U, 255U, 255U, 0.12);
    requireColor(theme.linkText, 213U, 213U, 213U);
    requireColor(theme.optionActive, 59U, 130U, 246U);
    requireColor(theme.optionActiveText, 255U, 255U, 255U);
    requireColor(theme.segmentBackground, 255U, 255U, 255U, 0.08);
    requireColor(theme.segmentThumb, 59U, 130U, 246U);
    requireColor(theme.segmentTextActive, 255U, 255U, 255U);
    requireColor(theme.segmentTextInactive, 112U, 112U, 112U);
    requireColor(theme.toggleActive, 59U, 130U, 246U);
    requireColor(theme.toggleInactive, 255U, 255U, 255U, 0.12);
    requireColor(theme.toggleKnob, 255U, 255U, 255U);
    requireColor(theme.toggleShadow, 0U, 0U, 0U, 0.3);
    requireColor(theme.sliderTrack, 255U, 255U, 255U, 0.12);
    requireColor(theme.sliderValueActive, 79U, 163U, 255U);
    requireColor(theme.sliderValueInactive, 112U, 112U, 112U);
    requireColor(theme.sliderKnob, 255U, 255U, 255U);
    requireColor(theme.sliderShadow, 0U, 0U, 0U, 0.3);
    REQUIRE_NEAR(theme.menuUtilityTextOpacity, 0.82, 1.0e-15);
    REQUIRE_NEAR(theme.menuUtilityTextFocusedOpacity, 1.0, 1.0e-15);
    REQUIRE_NEAR(theme.menuUtilityBorderFallbackOpacity, 0.82, 1.0e-15);
    REQUIRE_NEAR(theme.menuBackfaceDividerOpacity, 0.06, 1.0e-15);
    REQUIRE_NEAR(theme.menuBackfaceTagTextOpacity, 1.0, 1.0e-15);
    REQUIRE_NEAR(theme.menuPanelBackfaceFillOpacity, 0.02, 1.0e-15);
    REQUIRE_NEAR(theme.menuPanelStrokeOpacity, 0.26, 1.0e-15);
    REQUIRE_NEAR(theme.menuPanelTintOpacity, 0.13, 1.0e-15);
    REQUIRE_NEAR(theme.menuPanelEdgeOpacity, 0.3, 1.0e-15);
    REQUIRE_NEAR(theme.menuUtilityPanelStrokeOpacity, 0.24, 1.0e-15);
    REQUIRE_NEAR(theme.menuPlaceholderOpacity, 0.92, 1.0e-15);
    REQUIRE_NEAR(theme.menuCardInnerLineFocusDelta, 0.1, 1.0e-15);
    REQUIRE_NEAR(theme.menuCardRowOpacity, 0.1, 1.0e-15);
}

void testLightThemeCompleteTitleSettingsOverlayPalette() {
    const auto& theme = lightThemeMetrics();
    REQUIRE(&themeMetrics(ThemeVariant::light) == &theme);
    requireColor(theme.background, 206U, 206U, 206U);
    requireColor(theme.titleGradient[0], 217U, 217U, 217U);
    requireColor(theme.titleGradient[4], 207U, 207U, 207U);
    REQUIRE(theme.titleGradientFallback == theme.titleGradient);
    requireColor(theme.logoFill, 32U, 32U, 32U);
    requireColor(theme.logoShadow, 206U, 206U, 206U);
    REQUIRE(theme.loadingHaloStops == darkThemeMetrics().loadingHaloStops);
    requireColor(theme.titleShieldShadow, 238U, 242U, 247U);
    requireColor(theme.titleShieldLow, 92U, 147U, 223U);
    requireColor(theme.titleShieldHigh, 141U, 194U, 244U);
    requireColor(theme.titleShieldHighlight, 243U, 247U, 251U);
    requireColor(theme.titleText, 36U, 36U, 36U);
    requireColor(theme.titleLine, 136U, 136U, 136U);
    requireColor(theme.titleShadow, 224U, 224U, 224U);
    requireColor(theme.titleEnemy, 230U, 90U, 90U, 0.85);
    requireColor(theme.menuForeground, 36U, 36U, 36U);
    requireColor(theme.menuIconFill, 36U, 36U, 36U);
    requireColor(theme.menuIconShadow, 104U, 104U, 104U);
    requireColor(theme.titleButtonNormal, 238U, 238U, 238U, 0.0);
    requireColor(theme.titleButtonHover[0].color, 0U, 0U, 0U, 0.1);
    requireColor(theme.titleButtonText, 36U, 36U, 36U);
    requireColor(theme.overlaySectionText, 102U, 102U, 102U);
    requireColor(theme.overlayItemText, 45U, 45U, 45U);
    requireColor(theme.overlayControlText, 102U, 102U, 102U);
    requireColor(theme.overlayValueText, 77U, 77U, 77U);
    requireColor(theme.overlayPanelBackground, 210U, 210U, 210U);
    requireColor(theme.overlayPanelBorder, 200U, 200U, 200U);
    requireColor(theme.overlayGlassBackground, 236U, 237U, 239U, 0.88);
    requireColor(theme.overlayGlassBorder, 222U, 224U, 228U, 0.56);
    requireColor(theme.overlayGlassTint, 236U, 236U, 236U);
    requireColor(theme.overlayGlassEdge, 207U, 213U, 222U);
    requireColor(theme.overlayDivider, 70U, 70U, 70U, 0.08);
    requireColor(theme.overlayPanelShadow, 0U, 0U, 0U, 0.3);
    REQUIRE(theme.overlayPanelHasShadow);
    requireColor(theme.overlayControlInactive, 0U, 0U, 0U, 0.045);
    requireColor(theme.overlayControlHover, 0U, 0U, 0U, 0.08);
    requireColor(theme.linkIdle, 0U, 0U, 0U, 0.045);
    requireColor(theme.linkHover, 0U, 0U, 0U, 0.08);
    requireColor(theme.linkText, 45U, 45U, 45U);
    requireColor(theme.optionActive, 22U, 111U, 251U);
    requireColor(theme.optionActiveText, 244U, 247U, 255U);
    requireColor(theme.segmentBackground, 0U, 0U, 0U, 0.05);
    requireColor(theme.segmentThumb, 236U, 236U, 236U);
    requireColor(theme.segmentTextActive, 22U, 111U, 251U);
    requireColor(theme.segmentTextInactive, 102U, 102U, 102U);
    requireColor(theme.toggleActive, 22U, 111U, 251U);
    requireColor(theme.toggleInactive, 0U, 0U, 0U, 0.1);
    requireColor(theme.toggleKnob, 236U, 236U, 236U);
    requireColor(theme.toggleShadow, 0U, 0U, 0U, 0.3);
    requireColor(theme.sliderTrack, 0U, 0U, 0U, 0.16);
    requireColor(theme.sliderValueActive, 22U, 111U, 251U);
    requireColor(theme.sliderValueInactive, 136U, 136U, 136U);
    requireColor(theme.sliderKnob, 236U, 236U, 236U);
    requireColor(theme.sliderShadow, 0U, 0U, 0U, 0.3);
    REQUIRE_NEAR(theme.overlayGlassTintStrength, 0.18, 1.0e-15);
    REQUIRE_NEAR(theme.overlayGlassEdgeStrength, 0.1, 1.0e-15);
    REQUIRE_NEAR(theme.overlayDim, 0.5, 1.0e-15);
    REQUIRE_NEAR(theme.menuPanelFillOpacity, 0.045, 1.0e-15);
    REQUIRE_NEAR(theme.menuPanelTintOpacity, 0.12, 1.0e-15);
    REQUIRE_NEAR(theme.menuPlaceholderOpacity, 0.92, 1.0e-15);
}

void testResponsiveViewportAndUltrawideUiArea() {
    UiLayoutMetrics metrics;
    REQUIRE(metrics.tryUpdate({1'280.0, 720.0, 1.0, true}));
    auto snapshot = metrics.snapshot();
    REQUIRE_NEAR(snapshot.viewport.ww, 1'280.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.wh, 720.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.uiww, 1'280.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.uiOffsetX, 0.0, 1.0e-12);

    REQUIRE(metrics.tryUpdate({3'440.0, 1'440.0, 1.25, true}));
    snapshot = metrics.snapshot();
    REQUIRE_NEAR(snapshot.viewport.uiww, 2'560.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.uiOffsetX, 440.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.logicalUiRect.x, 440.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.logicalUiRect.width, 2'560.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.logicalUiRect.height, 1'440.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.scaledUiww, 3'200.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.scaledWh, 1'800.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.title.menuLogoAnchor.x, 208.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.title.menuLogoAnchor.y, 198.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.title.cards[0].layoutRect.width, 407.04, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlayPage.pagePaddingX, 57.6, 1.0e-12);
    REQUIRE_NEAR(snapshot.exitDialog.x, 1'240.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.exitDialog.y, 540.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.exitDialog.width, 960.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.exitDialog.height, 360.0, 1.0e-12);
    REQUIRE(snapshot.exitDialog == snapshot.overlays.exit.panelRect);
    REQUIRE_NEAR(snapshot.overlays.exit.baseDim, 0.28, 1.0e-15);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.x, 1'240.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.y, 513.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.width, 960.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.height, 414.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.baseDim, 0.28, 1.0e-15);
    REQUIRE_NEAR(snapshot.overlays.titleBaseDim, 0.28, 1.0e-15);

    // JS oracle의 지원 설정 150%는 1280x720에서 하단 pane을 clamp하지 않는다.
    REQUIRE(metrics.tryUpdate({1'280.0, 720.0, 1.5, true}));
    snapshot = metrics.snapshot();
    REQUIRE_NEAR(
        snapshot.title.utilityPane.y + snapshot.title.utilityPane.height,
        749.185042105263,
        1.0e-10
    );
}

void testAndroidLogicalSafeAreaUsesUsableRect() {
    UiLayoutMetrics metrics;
    const LogicalSafeAreaInsets cutoutInsets{180.0, 48.0, 60.0, 72.0};
    REQUIRE(metrics.tryUpdate({2'400.0, 1'200.0, 1.0, true, cutoutInsets}));
    const UiLayoutSnapshot snapshot = metrics.snapshot();

    REQUIRE(snapshot.viewport.logicalSafeArea == cutoutInsets);
    REQUIRE_NEAR(snapshot.viewport.ww, 2'400.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.wh, 1'200.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.safeAreaRect.x, 180.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.safeAreaRect.y, 48.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.safeAreaRect.width, 2'160.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.safeAreaRect.height, 1'080.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.uiww, 1'920.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.uiOffsetX, 300.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.logicalUiRect.x, 300.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.logicalUiRect.y, 48.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.logicalUiRect.width, 1'920.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.logicalUiRect.height, 1'080.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.scaledUiww, 1'920.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.viewport.scaledWh, 1'080.0, 1.0e-12);

    REQUIRE_NEAR(snapshot.title.menuLogoAnchor.x, 304.8, 1.0e-10);
    REQUIRE_NEAR(snapshot.title.menuLogoAnchor.y, 166.8, 1.0e-10);
    REQUIRE_NEAR(snapshot.title.introCircle.center.x, 1'260.0, 1.0e-10);
    REQUIRE_NEAR(snapshot.title.introCircle.center.y, 588.0, 1.0e-10);
    REQUIRE_NEAR(snapshot.title.settledCircle.center.x, 852.0, 1.0e-10);
    REQUIRE_NEAR(snapshot.title.settledCircle.center.y, 588.0, 1.0e-10);
    REQUIRE(snapshot.title.cardPane.x >= snapshot.viewport.safeAreaRect.x);
    REQUIRE(snapshot.title.cardPane.y >= snapshot.viewport.safeAreaRect.y);
    REQUIRE(
        snapshot.title.utilityPane.x + snapshot.title.utilityPane.width
        <= snapshot.viewport.safeAreaRect.x + snapshot.viewport.safeAreaRect.width
    );
    REQUIRE(
        snapshot.title.utilityPane.y + snapshot.title.utilityPane.height
        <= snapshot.viewport.safeAreaRect.y + snapshot.viewport.safeAreaRect.height
    );

    REQUIRE_NEAR(snapshot.overlays.exit.panelRect.x, 972.0, 1.0e-10);
    REQUIRE_NEAR(snapshot.overlays.exit.panelRect.y, 480.0, 1.0e-10);
    REQUIRE_NEAR(snapshot.overlays.exit.panelRect.width, 576.0, 1.0e-10);
    REQUIRE_NEAR(snapshot.overlays.exit.panelRect.height, 216.0, 1.0e-10);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.y, 463.8, 1.0e-10);

    TitleEntranceRenderState entrance{};
    REQUIRE(trySampleTitleEntrance(snapshot, 0.0, entrance));
    REQUIRE_NEAR(
        entrance.cards[0].offscreenStartX,
        2'340.0 + (snapshot.title.cards[0].settledRect.width * 0.12),
        1.0e-10
    );
}

void testTitleSettledGoldenAnchorsAndRects() {
    const UiLayoutSnapshot snapshot = buildGoldenSnapshot();
    const auto& title = snapshot.title;

    REQUIRE_NEAR(title.menuLogoAnchor.x, 83.2, 1.0e-10);
    REQUIRE_NEAR(title.menuLogoAnchor.y, 79.2, 1.0e-10);
    REQUIRE_NEAR(title.introCircle.center.x, 640.0, 1.0e-10);
    REQUIRE_NEAR(title.settledCircle.center.x, 448.0, 1.0e-10);
    REQUIRE_NEAR(title.settledCircle.center.y, 360.0, 1.0e-10);
    REQUIRE_NEAR(title.settledCircle.radius, 82.8, 1.0e-10);
    REQUIRE_NEAR(title.settledCircle.outlineWidth, 1.0, 1.0e-10);

    REQUIRE_NEAR(title.loadingLogoRect.x, 330.54400000000004, 1.0e-10);
    REQUIRE_NEAR(title.loadingLogoRect.y, 307.8315748218527, 1.0e-10);
    REQUIRE_NEAR(title.loadingLogoRect.width, 208.656, 1.0e-10);
    REQUIRE_NEAR(title.loadingLogoRect.height, 104.33685035629456, 1.0e-10);
    REQUIRE_NEAR(title.settledLogoRect.x, 140.8, 1.0e-10);
    REQUIRE_NEAR(title.settledLogoRect.y, 311.3558737699355, 1.0e-10);
    REQUIRE_NEAR(title.settledLogoRect.width, 194.56, 1.0e-10);
    REQUIRE_NEAR(title.settledLogoRect.height, 97.28825246012896, 1.0e-10);

    REQUIRE_NEAR(title.cardPane.x, 862.62272, 1.0e-10);
    REQUIRE_NEAR(title.cardPane.y, 192.89330526315794, 1.0e-10);
    REQUIRE_NEAR(title.cardPane.width, 386.65728, 1.0e-10);
    REQUIRE_NEAR(title.cardPane.height, 334.2133894736841, 1.0e-10);
    REQUIRE_NEAR(title.cardPane.radius, 20.052803368421046, 1.0e-10);
    REQUIRE_NEAR(title.utilityPane.x, 1'000.56, 1.0e-10);
    REQUIRE_NEAR(title.utilityPane.y, 545.1066947368421, 1.0e-10);
    REQUIRE_NEAR(title.utilityPane.width, 248.72, 1.0e-10);
    REQUIRE_NEAR(title.utilityPane.height, 90.5, 1.0e-10);
    REQUIRE_NEAR(title.versionLabelTop, 145.29330526315795, 1.0e-10);
    REQUIRE_NEAR(title.gapBeforeCardPane, 18.0, 1.0e-10);
    REQUIRE_NEAR(title.gapAfterCardPane, 18.0, 1.0e-10);

    constexpr std::array expectedCards{
        std::array<double, 5U>{886.62272, 216.89330526315794, 162.816, 162.816, 13.02528},
        std::array<double, 5U>{1'062.464, 216.89330526315794, 162.816, 110.3721094736842, 12.0},
        std::array<double, 5U>{1'062.464, 340.29069473684217, 162.816, 39.41861052631579, 12.0},
        std::array<double, 5U>{886.62272, 392.7345852631579, 162.816, 110.3721094736842, 12.0},
        std::array<double, 5U>{1'062.464, 392.7345852631579, 162.816, 110.3721094736842, 12.0}
    };
    constexpr std::array expectedSlots{
        TitleCardSlot::start,
        TitleCardSlot::quickStart,
        TitleCardSlot::records,
        TitleCardSlot::deck,
        TitleCardSlot::research
    };
    for (std::size_t index = 0U; index < expectedCards.size(); ++index) {
        const auto& card = title.cards[index];
        REQUIRE(card.slot == expectedSlots[index]);
        REQUIRE_NEAR(card.settledRect.x, expectedCards[index][0], 1.0e-10);
        REQUIRE_NEAR(card.settledRect.y, expectedCards[index][1], 1.0e-10);
        REQUIRE_NEAR(card.settledRect.width, expectedCards[index][2], 1.0e-10);
        REQUIRE_NEAR(card.settledRect.height, expectedCards[index][3], 1.0e-10);
        REQUIRE_NEAR(card.settledRect.radius, expectedCards[index][4], 1.0e-10);
        REQUIRE_NEAR(card.titleTypography.size, 16.0, 1.0e-10);
        REQUIRE(card.titleTypography.weight == 700U);
    }

    constexpr std::array expectedTileX{1'024.56, 1'077.3, 1'130.04, 1'182.78};
    for (std::size_t index = 0U; index < expectedTileX.size(); ++index) {
        const auto& tile = title.utilityTiles[index];
        REQUIRE_NEAR(tile.rect.x, expectedTileX[index], 1.0e-10);
        REQUIRE_NEAR(tile.rect.y, 569.1066947368421, 1.0e-10);
        REQUIRE_NEAR(tile.rect.width, 42.5, 1.0e-10);
        REQUIRE_NEAR(tile.rect.height, 42.5, 1.0e-10);
        REQUIRE_NEAR(tile.placeholderSize, 14.45, 1.0e-10);
    }
}

void testVersionHistoryLinkAndDialogRenderGeometry() {
    const UiLayoutSnapshot snapshot = buildGoldenSnapshot();
    const TitleVersionHistoryLinkMetrics& link =
        snapshot.title.versionHistoryLink;
    REQUIRE(link.available);
    REQUIRE_NEAR(link.textAnchor.x, 1'249.28, 1.0e-10);
    REQUIRE_NEAR(link.textAnchor.y, 162.09330526315795, 1.0e-10);
    REQUIRE_NEAR(link.iconRect.x, 1'180.53888, 1.0e-10);
    REQUIRE_NEAR(link.iconRect.y, 162.41074526315794, 1.0e-10);
    REQUIRE_NEAR(link.iconRect.width, 12.16512, 1.0e-10);
    REQUIRE_NEAR(link.hitRect.x, 1'174.53888, 1.0e-10);
    REQUIRE_NEAR(link.hitRect.y, 158.09330526315795, 1.0e-10);
    REQUIRE_NEAR(link.hitRect.width, 80.74112, 1.0e-10);
    REQUIRE_NEAR(link.hitRect.height, 20.8, 1.0e-10);

    UiLayoutMetrics measuredMetrics;
    REQUIRE(measuredMetrics.tryUpdate({
        1'280.0,
        720.0,
        1.0,
        true,
        {},
        64.0
    }));
    const TitleVersionHistoryLinkMetrics& measured =
        measuredMetrics.snapshot().title.versionHistoryLink;
    REQUIRE_NEAR(measured.textAnchor.x, link.textAnchor.x, 1.0e-12);
    REQUIRE_NEAR(measured.hitRect.x, 1'162.76288, 1.0e-10);
    REQUIRE_NEAR(measured.hitRect.width, 92.51712, 1.0e-10);

    TitleEntranceRenderState entrance{};
    REQUIRE(trySampleTitleEntrance(snapshot, 0.0, entrance));
    REQUIRE(entrance.versionHistoryLink.available);
    REQUIRE_NEAR(entrance.versionHistoryLink.alpha, 0.0, 1.0e-15);
    REQUIRE_NEAR(
        entrance.versionHistoryLink.hitRect.x,
        link.hitRect.x + 33.28,
        1.0e-10
    );
    REQUIRE(trySampleTitleEntrance(snapshot, 2.0, entrance));
    REQUIRE_NEAR(entrance.versionHistoryLink.alpha, 1.0, 1.0e-15);
    REQUIRE(entrance.versionHistoryLink.hitRect == link.hitRect);

    UiLayoutMetrics noLinkMetrics;
    REQUIRE(noLinkMetrics.tryUpdate({1'280.0, 720.0, 1.0, false}));
    REQUIRE(!noLinkMetrics.snapshot().title.versionHistoryLink.available);
    REQUIRE(trySampleTitleEntrance(noLinkMetrics.snapshot(), 2.0, entrance));
    REQUIRE(!entrance.versionHistoryLink.available);

    OverlayDialogRenderMetrics dialog{};
    REQUIRE(tryResolveOverlayDialogRenderMetrics(
        snapshot.overlays.exit,
        snapshot.overlayPage,
        1.0,
        dialog
    ));
    REQUIRE(dialog.panelRect == snapshot.overlays.exit.panelRect);
    REQUIRE_NEAR(dialog.cancelButtonRect.x, 632.32, 1.0e-10);
    REQUIRE_NEAR(dialog.cancelButtonRect.y, 388.8, 1.0e-10);
    REQUIRE_NEAR(dialog.cancelButtonRect.width, 89.6, 1.0e-10);
    REQUIRE_NEAR(dialog.cancelButtonRect.height, 25.2, 1.0e-10);
    REQUIRE_NEAR(dialog.confirmButtonRect.x, 732.16, 1.0e-10);
    REQUIRE_NEAR(dialog.confirmButtonRect.radius, 3.84, 1.0e-10);

    REQUIRE(tryResolveOverlayDialogRenderMetrics(
        snapshot.overlays.exit,
        snapshot.overlayPage,
        0.9,
        dialog
    ));
    REQUIRE_NEAR(dialog.panelRect.x, 467.2, 1.0e-10);
    REQUIRE_NEAR(dialog.panelRect.y, 295.2, 1.0e-10);
    REQUIRE_NEAR(dialog.panelRect.width, 345.6, 1.0e-10);
    REQUIRE_NEAR(dialog.panelRect.height, 129.6, 1.0e-10);
    REQUIRE_NEAR(dialog.cancelButtonRect.x, 633.088, 1.0e-10);
    REQUIRE_NEAR(dialog.cancelButtonRect.y, 385.92, 1.0e-10);
    REQUIRE_NEAR(dialog.confirmButtonRect.x, 722.944, 1.0e-10);
    REQUIRE_NEAR(dialog.confirmButtonRect.width, 80.64, 1.0e-10);
    REQUIRE_NEAR(dialog.confirmButtonRect.height, 22.68, 1.0e-10);
    REQUIRE_NEAR(dialog.confirmButtonRect.radius, 3.456, 1.0e-10);
}

void testOverlaySpacingTypographyAndExitRatio() {
    const UiLayoutSnapshot snapshot = buildGoldenSnapshot();
    const auto& spacing = snapshot.overlayPage;
    REQUIRE_NEAR(spacing.pagePaddingX, 23.04, 1.0e-12);
    REQUIRE_NEAR(spacing.dialogPaddingX, 19.2, 1.0e-12);
    REQUIRE_NEAR(spacing.titleTop, 18.0, 1.0e-12);
    REQUIRE_NEAR(spacing.titleDividerGap, 10.8, 1.0e-12);
    REQUIRE_NEAR(spacing.dialogBodyGap, 10.08, 1.0e-12);
    REQUIRE_NEAR(spacing.footerBottom, 18.0, 1.0e-12);
    REQUIRE_NEAR(spacing.panelRadius, 7.68, 1.0e-12);
    REQUIRE_NEAR(spacing.interactButtonWidth, 89.6, 1.0e-12);
    REQUIRE_NEAR(spacing.interactButtonHeight, 25.2, 1.0e-12);
    REQUIRE_NEAR(spacing.interactButtonMargin, 10.24, 1.0e-12);
    REQUIRE_NEAR(spacing.interactButtonRadius, 3.84, 1.0e-12);

    const auto h1Index = static_cast<std::size_t>(TypographyRole::h1);
    const auto h2Index = static_cast<std::size_t>(TypographyRole::h2);
    const auto h4Index = static_cast<std::size_t>(TypographyRole::h4);
    const auto labelIndex = static_cast<std::size_t>(TypographyRole::label);
    const auto buttonIndex = static_cast<std::size_t>(TypographyRole::buttonPrimary);
    REQUIRE_NEAR(snapshot.typography[h1Index].size, 25.6, 1.0e-12);
    REQUIRE(snapshot.typography[h1Index].weight == 700U);
    REQUIRE_NEAR(snapshot.typography[h2Index].size, 20.48, 1.0e-12);
    REQUIRE(snapshot.typography[h2Index].weight == 600U);
    REQUIRE_NEAR(snapshot.typography[h4Index].size, 14.08, 1.0e-12);
    REQUIRE(snapshot.typography[h4Index].weight == 300U);
    REQUIRE_NEAR(snapshot.typography[labelIndex].size, 12.8, 1.0e-12);
    REQUIRE(snapshot.typography[labelIndex].weight == 700U);
    REQUIRE_NEAR(snapshot.typography[buttonIndex].size, 12.8, 1.0e-12);
    REQUIRE(snapshot.typography[buttonIndex].weight == 600U);

    REQUIRE_NEAR(snapshot.exitDialog.x, 448.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.exitDialog.y, 288.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.exitDialog.width, 384.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.exitDialog.height, 144.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.exitDialog.radius, 7.68, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.x, 448.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.y, 277.2, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.width, 384.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.height, 165.6, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.externalLinkWarning.panelRect.radius, 7.68, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.titleIcon.gap, 2.816, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays.titleIcon.maxHeightRatio, 0.92, 1.0e-15);
    REQUIRE_NEAR(snapshot.overlays.titleIcon.baseScaleMultiplier, 1.08, 1.0e-15);
    REQUIRE_NEAR(snapshot.overlays.titleIcon.gapMultiplier, 2.5, 1.0e-15);

    TitleOverlayIconPlacement placement{};
    REQUIRE(tryResolveTitleOverlayIconPlacement(
        snapshot.overlays.titleIcon,
        TitleOverlayIconInput{{80.0, 100.0}, 25.6, 2.0, 1.0},
        placement
    ));
    REQUIRE_NEAR(placement.iconRect.x, 80.0, 1.0e-12);
    REQUIRE_NEAR(placement.iconRect.y, 100.08192, 1.0e-12);
    REQUIRE_NEAR(placement.iconRect.width, 50.87232, 1.0e-12);
    REQUIRE_NEAR(placement.iconRect.height, 25.43616, 1.0e-12);
    REQUIRE_NEAR(placement.titleOffsetX, 57.91232, 1.0e-12);
}

void testTitleEntranceSamplerBoundariesAndMidpoints() {
    const UiLayoutSnapshot snapshot = buildGoldenSnapshot();
    TitleEntranceRenderState state{};

    REQUIRE(trySampleTitleEntrance(snapshot, 0.0, state));
    REQUIRE_NEAR(state.elapsedSeconds, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.transitionProgress, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.transitionEase, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.revealClockElapsedSeconds, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.worldScale, 1.12, 1.0e-15);
    REQUIRE_NEAR(state.cards[0].revealProgress, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.cards[0].alpha, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.cards[0].entryScale, 1.06, 1.0e-15);
    REQUIRE_NEAR(state.cards[0].startOffsetX, 108.8, 1.0e-12);
    REQUIRE_NEAR(state.cards[0].offscreenStartX, 1'299.53792, 1.0e-10);
    REQUIRE_NEAR(state.cards[2].startOffsetX, 147.2, 1.0e-12);
    REQUIRE_NEAR(state.cards[0].panelRect.x, 1'202.8903424, 1.0e-9);
    REQUIRE_NEAR(state.cards[0].panelRect.y, 194.24988429473685, 1.0e-9);
    REQUIRE_NEAR(state.cards[0].panelRect.width, 193.2951552, 1.0e-9);
    REQUIRE_NEAR(state.cards[0].panelRect.height, 193.2951552, 1.0e-9);
    REQUIRE_NEAR(state.cards[0].panelRect.radius, 15.463612416, 1.0e-9);
    REQUIRE_NEAR(state.cards[0].titleTypography.size, 18.363039744, 1.0e-9);
    REQUIRE_NEAR(state.cardPane.alpha, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.cardPane.panelRect.x, 903.58272, 1.0e-10);
    REQUIRE_NEAR(state.utilityPane.alpha, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.utilityPane.panelRect.x, 1'033.84, 1.0e-10);
    REQUIRE_NEAR(state.utilityTiles[0].alpha, 0.0, 1.0e-15);
    REQUIRE_NEAR(state.utilityTiles[0].translateX, 45.18, 1.0e-10);
    REQUIRE_NEAR(state.utilityTiles[0].panelRect.x, 1'069.74, 1.0e-10);

    REQUIRE(trySampleTitleEntrance(snapshot, 0.15, state));
    REQUIRE_NEAR(state.transitionProgress, 0.00294228936108243, 1.0e-15);

    REQUIRE(trySampleTitleEntrance(snapshot, 0.3, state));
    REQUIRE_NEAR(state.transitionProgress, 0.0941532595546378, 1.0e-15);
    REQUIRE_NEAR(state.worldScale, 1.06248153535505, 1.0e-14);
    REQUIRE_NEAR(state.revealClockElapsedSeconds, 0.0, 1.0e-15);
    for (const auto& card : state.cards) {
        REQUIRE_NEAR(card.revealProgress, 0.0, 1.0e-15);
        REQUIRE_NEAR(card.alpha, 0.0, 1.0e-15);
    }

    // start 카드 alpha gate의 정확한 중간점: reveal progress 0.29 -> alpha 0.5.
    REQUIRE(trySampleTitleEntrance(snapshot, 0.4682, state));
    REQUIRE_NEAR(state.revealClockElapsedSeconds, 0.1682, 1.0e-15);
    REQUIRE_NEAR(state.cards[0].revealProgress, 0.29, 1.0e-12);
    REQUIRE_NEAR(state.cards[0].revealEase, 0.866028317182963, 1.0e-15);
    REQUIRE_NEAR(state.cards[0].alpha, 0.5, 1.0e-12);
    REQUIRE_NEAR(state.cards[4].revealProgress, 0.0, 1.0e-15);

    REQUIRE(trySampleTitleEntrance(snapshot, 0.5, state));
    REQUIRE_NEAR(state.transitionProgress, 0.529233702226811, 1.0e-15);
    REQUIRE_NEAR(state.worldScale, 1.00306216829211, 1.0e-14);

    // card pane의 easeOutCubic 중간점입니다.
    REQUIRE(trySampleTitleEntrance(snapshot, 0.5943, state));
    REQUIRE_NEAR(state.revealClockElapsedSeconds, 0.2943, 1.0e-15);
    REQUIRE_NEAR(state.cardPane.alpha, 0.875, 1.0e-12);
    REQUIRE_NEAR(state.cardPane.panelRect.x, 867.74272, 1.0e-10);

    // utility pane의 독립 delay 뒤 easeOutCubic 중간점입니다.
    REQUIRE(trySampleTitleEntrance(snapshot, 0.6998, state));
    REQUIRE_NEAR(state.revealClockElapsedSeconds, 0.3998, 1.0e-15);
    REQUIRE_NEAR(state.utilityPane.alpha, 0.875, 1.0e-12);
    REQUIRE_NEAR(state.utilityPane.panelRect.x, 1'004.72, 1.0e-10);

    // 세 번째 utility tile의 stagger 중간점입니다.
    REQUIRE(trySampleTitleEntrance(snapshot, 0.8144, state));
    REQUIRE_NEAR(state.utilityTiles[2].revealProgress, 0.5, 1.0e-12);
    REQUIRE_NEAR(state.utilityTiles[2].revealEase, 0.875, 1.0e-12);
    REQUIRE_NEAR(state.utilityTiles[2].alpha, 0.875, 1.0e-12);
    REQUIRE_NEAR(state.utilityTiles[2].translateX, 2.07955053917787, 1.0e-10);
    REQUIRE_NEAR(state.utilityTiles[2].panelRect.x, 1'132.1195505391778, 1.0e-10);

    REQUIRE(trySampleTitleEntrance(snapshot, 1.25, state));
    REQUIRE_NEAR(state.transitionProgress, 0.985288553194588, 1.0e-15);
    REQUIRE_NEAR(state.worldScale, 1.00012976786428, 1.0e-14);

    REQUIRE(trySampleTitleEntrance(snapshot, 2.0, state));
    REQUIRE_NEAR(state.transitionProgress, 1.0, 1.0e-15);
    REQUIRE_NEAR(state.transitionEase, 1.0, 1.0e-15);
    REQUIRE_NEAR(state.revealClockElapsedSeconds, 1.09, 1.0e-15);
    REQUIRE_NEAR(state.worldScale, 1.0, 1.0e-15);
    REQUIRE(state.cardPane.panelRect == snapshot.title.cardPane);
    REQUIRE(state.utilityPane.panelRect == snapshot.title.utilityPane);
    REQUIRE_NEAR(state.cardPane.alpha, 1.0, 1.0e-15);
    REQUIRE_NEAR(state.utilityPane.alpha, 1.0, 1.0e-15);
    for (std::size_t index = 0U; index < state.cards.size(); ++index) {
        REQUIRE_NEAR(
            state.cards[index].panelRect.x,
            snapshot.title.cards[index].settledRect.x,
            1.0e-10
        );
        REQUIRE_NEAR(
            state.cards[index].panelRect.y,
            snapshot.title.cards[index].settledRect.y,
            1.0e-10
        );
        REQUIRE_NEAR(
            state.cards[index].panelRect.width,
            snapshot.title.cards[index].settledRect.width,
            1.0e-10
        );
        REQUIRE_NEAR(
            state.cards[index].panelRect.height,
            snapshot.title.cards[index].settledRect.height,
            1.0e-10
        );
        REQUIRE_NEAR(
            state.cards[index].panelRect.radius,
            snapshot.title.cards[index].settledRect.radius,
            1.0e-10
        );
        REQUIRE(state.cards[index].titleTypography == snapshot.title.cards[index].titleTypography);
        REQUIRE_NEAR(state.cards[index].alpha, 1.0, 1.0e-15);
    }
    for (std::size_t index = 0U; index < state.utilityTiles.size(); ++index) {
        REQUIRE(state.utilityTiles[index].panelRect == snapshot.title.utilityTiles[index].rect);
        REQUIRE_NEAR(state.utilityTiles[index].alpha, 1.0, 1.0e-15);
        REQUIRE_NEAR(state.utilityTiles[index].translateX, 0.0, 1.0e-15);
    }
}

void testRevealAndCommonOverlayPresentationContract() {
    const UiLayoutSnapshot snapshot = buildGoldenSnapshot();
    const auto& timeline = snapshot.title.timeline;
    REQUIRE_NEAR(timeline.introStartDelaySeconds, 1.5, 1.0e-15);
    REQUIRE_NEAR(timeline.logoPlaybackSeconds, 3.0, 1.0e-15);
    REQUIRE_NEAR(timeline.transitionAccelSeconds, 0.3, 1.0e-15);
    REQUIRE_NEAR(timeline.transitionCruiseSeconds, 0.2, 1.0e-15);
    REQUIRE_NEAR(timeline.transitionDecelSeconds, 1.5, 1.0e-15);
    REQUIRE_NEAR(timeline.transitionTotalSeconds, 2.0, 1.0e-15);
    REQUIRE_NEAR(timeline.menuAppearStartDelaySeconds, 0.3, 1.0e-15);
    REQUIRE_NEAR(timeline.menuDeclaredDurationSeconds, 1.29, 1.0e-15);
    REQUIRE_NEAR(timeline.menuRevealTotalSeconds, 1.39, 1.0e-15);
    REQUIRE_NEAR(timeline.menuRevealCoreSeconds, 1.09, 1.0e-15);
    REQUIRE_NEAR(timeline.cardReveal[4].delaySeconds, 0.19, 1.0e-15);
    REQUIRE_NEAR(timeline.cardReveal[4].durationSeconds, 0.9, 1.0e-15);

    OverlayPresentationMetrics open{};
    REQUIRE(trySampleOverlayOpen(0.0, open));
    REQUIRE(open == OverlayPresentationMetrics{});
    REQUIRE(trySampleOverlayOpen(0.25, open));
    REQUIRE_NEAR(open.alpha, 0.96875, 1.0e-15);
    REQUIRE_NEAR(open.dimAlpha, 0.96875, 1.0e-15);
    REQUIRE_NEAR(snapshot.overlays.exit.baseDim * open.dimAlpha, 0.27125, 1.0e-15);
    REQUIRE_NEAR(open.contentScale, 0.996875, 1.0e-15);
    REQUIRE_NEAR(open.contentBlur, 0.3125, 1.0e-15);
    REQUIRE(trySampleOverlayOpen(0.5, open));
    REQUIRE_NEAR(open.alpha, 1.0, 1.0e-15);
    REQUIRE_NEAR(open.contentScale, 1.0, 1.0e-15);
    REQUIRE_NEAR(open.contentBlur, 0.0, 1.0e-15);

    OverlayPresentationMetrics close{};
    REQUIRE(trySampleOverlayClose(0.25, open, close));
    REQUIRE_NEAR(close.alpha, 0.96875, 1.0e-15);
    REQUIRE_NEAR(close.dimAlpha, 0.96875, 1.0e-15);
    REQUIRE_NEAR(close.contentScale, 0.996875, 1.0e-15);
    REQUIRE_NEAR(close.contentBlur, 0.3125, 1.0e-15);
    REQUIRE(trySampleOverlayClose(0.5, open, close));
    REQUIRE_NEAR(close.alpha, 0.0, 1.0e-15);
    REQUIRE_NEAR(close.contentScale, 0.9, 1.0e-15);
    REQUIRE_NEAR(close.contentBlur, 10.0, 1.0e-15);
}

void testInvalidInputsPreservePreviousState() {
    UiLayoutMetrics metrics;
    REQUIRE(metrics.tryUpdate({1'280.0, 720.0, 1.0, true}));
    const UiLayoutSnapshot before = metrics.snapshot();
    const double nan = std::numeric_limits<double>::quiet_NaN();
    const double infinity = std::numeric_limits<double>::infinity();
    const std::array invalidInputs{
        LayoutInput{nan, 720.0, 1.0, true},
        LayoutInput{1'280.0, infinity, 1.0, true},
        LayoutInput{0.0, 720.0, 1.0, true},
        LayoutInput{1'280.0, -720.0, 1.0, true},
        LayoutInput{1'280.0, 720.0, 0.0, true},
        LayoutInput{1'280.0, 720.0, nan, true},
        LayoutInput{1'280.0, 720.0, 1.0, true, {}, -1.0},
        LayoutInput{1'280.0, 720.0, 1.0, true, {}, nan},
        LayoutInput{
            1'280.0,
            720.0,
            1.0,
            true,
            LogicalSafeAreaInsets{nan, 0.0, 0.0, 0.0}
        },
        LayoutInput{
            1'280.0,
            720.0,
            1.0,
            true,
            LogicalSafeAreaInsets{-1.0, 0.0, 0.0, 0.0}
        },
        LayoutInput{
            1'280.0,
            720.0,
            1.0,
            true,
            LogicalSafeAreaInsets{640.0, 0.0, 640.0, 0.0}
        },
        LayoutInput{
            1'280.0,
            720.0,
            1.0,
            true,
            LogicalSafeAreaInsets{0.0, 360.0, 0.0, 360.0}
        },
        LayoutInput{
            std::numeric_limits<double>::max(),
            std::numeric_limits<double>::max(),
            2.0,
            true
        }
    };
    for (const LayoutInput& input : invalidInputs) {
        REQUIRE(!metrics.tryUpdate(input));
        REQUIRE(metrics.snapshot() == before);
        REQUIRE(metrics.hasSnapshot());
    }

    TypographyMetrics typography{17.0, 19.0, 333U};
    const TypographyMetrics typographyBefore = typography;
    REQUIRE(!tryResolveTypography(
        TypographyRole::count,
        before.viewport,
        typography
    ));
    REQUIRE(typography == typographyBefore);

    OverlayPresentationMetrics presentation{0.4, 0.3, 0.95, 4.0};
    const OverlayPresentationMetrics presentationBefore = presentation;
    REQUIRE(!trySampleOverlayOpen(-0.01, presentation));
    REQUIRE(presentation == presentationBefore);
    REQUIRE(!trySampleOverlayOpen(nan, presentation));
    REQUIRE(presentation == presentationBefore);

    const OverlayPresentationMetrics invalidStart{2.0, 0.3, 0.95, 4.0};
    REQUIRE(!trySampleOverlayClose(0.1, invalidStart, presentation));
    REQUIRE(presentation == presentationBefore);

    OverlayDialogRenderMetrics dialog{
        {1.0, 2.0, 3.0, 4.0, 5.0},
        {6.0, 7.0, 8.0, 9.0, 10.0},
        {11.0, 12.0, 13.0, 14.0, 15.0}
    };
    const OverlayDialogRenderMetrics dialogBefore = dialog;
    REQUIRE(!tryResolveOverlayDialogRenderMetrics(
        before.overlays.exit,
        before.overlayPage,
        0.0,
        dialog
    ));
    REQUIRE(dialog == dialogBefore);

    TitleEntranceRenderState entrance{};
    REQUIRE(trySampleTitleEntrance(before, 0.75, entrance));
    const TitleEntranceRenderState entranceBefore = entrance;
    REQUIRE(!trySampleTitleEntrance(before, -0.01, entrance));
    REQUIRE(entrance == entranceBefore);
    REQUIRE(!trySampleTitleEntrance(before, nan, entrance));
    REQUIRE(entrance == entranceBefore);
    UiLayoutSnapshot invalidSnapshot = before;
    invalidSnapshot.title.timeline.transitionTotalSeconds = 0.0;
    REQUIRE(!trySampleTitleEntrance(invalidSnapshot, 0.75, entrance));
    REQUIRE(entrance == entranceBefore);
    invalidSnapshot = before;
    invalidSnapshot.title.cards[0].settledRect.width = infinity;
    REQUIRE(!trySampleTitleEntrance(invalidSnapshot, 0.75, entrance));
    REQUIRE(entrance == entranceBefore);

    TitleOverlayIconPlacement iconPlacement{{1.0, 2.0, 3.0, 4.0, 0.0}, 5.0};
    const TitleOverlayIconPlacement iconPlacementBefore = iconPlacement;
    REQUIRE(!tryResolveTitleOverlayIconPlacement(
        before.overlays.titleIcon,
        TitleOverlayIconInput{{0.0, 0.0}, 25.6, 0.0, 1.0},
        iconPlacement
    ));
    REQUIRE(iconPlacement == iconPlacementBefore);
    REQUIRE(!tryResolveTitleOverlayIconPlacement(
        before.overlays.titleIcon,
        TitleOverlayIconInput{{nan, 0.0}, 25.6, 1.0, 1.0},
        iconPlacement
    ));
    REQUIRE(iconPlacement == iconPlacementBefore);
}

void testUpdateAndSamplingPerformNoHeapAllocation() {
    UiLayoutMetrics metrics;
    REQUIRE(metrics.tryUpdate({1'280.0, 720.0, 1.0, true}));
    OverlayPresentationMetrics presentation{};
    TitleEntranceRenderState entrance{};
    TitleOverlayIconPlacement iconPlacement{};
    OverlayDialogRenderMetrics dialog{};

    allocation_probe::count = 0U;
    allocation_probe::enabled = true;
    for (std::size_t index = 0U; index < 2'000U; ++index) {
        const double width = (index % 2U) == 0U ? 1'280.0 : 3'440.0;
        const double height = (index % 2U) == 0U ? 720.0 : 1'440.0;
        const double uiScale = (index % 3U) == 0U ? 1.25 : 1.0;
        const LogicalSafeAreaInsets safeArea = (index % 2U) == 0U
            ? LogicalSafeAreaInsets{12.0, 18.0, 24.0, 30.0}
            : LogicalSafeAreaInsets{};
        if (!metrics.tryUpdate({width, height, uiScale, true, safeArea})) {
            std::abort();
        }
        if (!trySampleOverlayOpen(0.25, presentation)) {
            std::abort();
        }
        if (!trySampleOverlayClose(0.25, presentation, presentation)) {
            std::abort();
        }
        if (!trySampleTitleEntrance(metrics.snapshot(), 0.8144, entrance)) {
            std::abort();
        }
        if (!tryResolveTitleOverlayIconPlacement(
                metrics.snapshot().overlays.titleIcon,
                TitleOverlayIconInput{{80.0, 100.0}, 25.6, 2.0, 1.0},
                iconPlacement
            )) {
            std::abort();
        }
        if (!tryResolveOverlayDialogRenderMetrics(
                metrics.snapshot().overlays.exit,
                metrics.snapshot().overlayPage,
                0.95,
                dialog
            )) {
            std::abort();
        }
    }
    allocation_probe::enabled = false;
    REQUIRE(allocation_probe::count == 0U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"dark theme core palette", testDarkThemeCorePaletteMatchesOracle},
        TestCase{"light theme complete render palette", testLightThemeCompleteTitleSettingsOverlayPalette},
        TestCase{"responsive viewport and ultrawide", testResponsiveViewportAndUltrawideUiArea},
        TestCase{"android logical safe area", testAndroidLogicalSafeAreaUsesUsableRect},
        TestCase{"title settled golden anchors", testTitleSettledGoldenAnchorsAndRects},
        TestCase{"version link and dialog geometry", testVersionHistoryLinkAndDialogRenderGeometry},
        TestCase{"overlay spacing typography exit", testOverlaySpacingTypographyAndExitRatio},
        TestCase{"title entrance sampler", testTitleEntranceSamplerBoundariesAndMidpoints},
        TestCase{"title reveal and overlay motion", testRevealAndCommonOverlayPresentationContract},
        TestCase{"invalid input transaction", testInvalidInputsPreservePreviousState},
        TestCase{"zero allocation layout path", testUpdateAndSamplingPerformNoHeapAllocation}
    };

    std::size_t passed = 0U;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            allocation_probe::enabled = false;
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }

    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
