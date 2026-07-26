#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace cirvivor::ui::layout {

inline constexpr std::size_t title_card_count = 5U;
inline constexpr std::size_t utility_tile_count = 4U;
inline constexpr std::size_t title_gradient_color_count = 5U;
inline constexpr std::size_t title_loading_halo_stop_count = 8U;
inline constexpr std::size_t title_button_hover_stop_count = 3U;

struct PointD final {
    double x = 0.0;
    double y = 0.0;

    constexpr bool operator==(const PointD&) const noexcept = default;
};

struct RoundedRectD final {
    double x = 0.0;
    double y = 0.0;
    double width = 0.0;
    double height = 0.0;
    double radius = 0.0;

    constexpr bool operator==(const RoundedRectD&) const noexcept = default;
};

struct CircleD final {
    PointD center{};
    double radius = 0.0;
    double outlineWidth = 0.0;

    constexpr bool operator==(const CircleD&) const noexcept = default;
};

/** CSS 색의 8-bit RGB와 손실 없는 실수 alpha를 보존합니다. */
struct ThemeColor final {
    std::uint8_t red = 0U;
    std::uint8_t green = 0U;
    std::uint8_t blue = 0U;
    double alpha = 1.0;

    constexpr bool operator==(const ThemeColor&) const noexcept = default;
};

struct ThemeColorStop final {
    double offset = 0.0;
    ThemeColor color{};

    constexpr bool operator==(const ThemeColorStop&) const noexcept = default;
};

struct TitleLoadingHaloStop final {
    double offset = 0.0;
    ThemeColor color{};
    double alphaScale = 0.0;
    double maxAlpha = 0.0;

    constexpr bool operator==(const TitleLoadingHaloStop&) const noexcept = default;
};

enum class ThemeVariant : std::uint8_t {
    light,
    dark
};

/** JS `LightTheme`/`DarkTheme`에서 title과 settings/overlay가 소비하는 렌더 토큰입니다. */
struct ThemeMetrics final {
    ThemeColor background{};
    ThemeColor titleBackground{};
    std::array<ThemeColor, title_gradient_color_count> titleGradient{};
    std::array<ThemeColor, title_gradient_color_count> titleGradientFallback{};
    ThemeColor logoFill{};
    ThemeColor logoShadow{};
    ThemeColor loadingAccent{};
    std::array<TitleLoadingHaloStop, title_loading_halo_stop_count> loadingHaloStops{};
    ThemeColor loadingRing{};
    ThemeColor loadingRingShadow{};
    double loadingRingAlphaScale = 0.0;
    double loadingRingAlphaMax = 0.0;
    double loadingRingShadowAlphaScale = 0.0;
    double loadingRingShadowAlphaMax = 0.0;
    ThemeColor loadingSurfaceHighlight{};
    double loadingSurfaceHighlightAlpha = 0.0;
    ThemeColor loadingSurfaceShadow{};
    double loadingSurfaceShadowAlpha = 0.0;
    ThemeColor titleShieldShadow{};
    ThemeColor titleShieldLow{};
    ThemeColor titleShieldHigh{};
    ThemeColor titleShieldHighlight{};
    ThemeColor titleText{};
    ThemeColor titleLine{};
    ThemeColor titleShadow{};
    ThemeColor titleEnemy{};
    ThemeColor menuForeground{};
    ThemeColor menuAccent{};
    ThemeColor menuIconFill{};
    ThemeColor menuIconShadow{};
    ThemeColor titleButtonNormal{};
    std::array<ThemeColorStop, title_button_hover_stop_count> titleButtonHover{};
    ThemeColor titleButtonText{};
    ThemeColor overlaySectionText{};
    ThemeColor overlayItemText{};
    ThemeColor overlayControlText{};
    ThemeColor overlayValueText{};
    ThemeColor overlayPanelBackground{};
    ThemeColor overlayPanelBorder{};
    ThemeColor overlayGlassBackground{};
    ThemeColor overlayGlassBorder{};
    ThemeColor overlayGlassTint{};
    ThemeColor overlayGlassEdge{};
    ThemeColor overlayDivider{};
    ThemeColor overlayPanelShadow{};
    bool overlayPanelHasShadow = false;
    ThemeColor overlayControlInactive{};
    ThemeColor overlayControlHover{};
    ThemeColor confirmIdle{};
    ThemeColor confirmHover{};
    ThemeColor confirmText{};
    ThemeColor cancelIdle{};
    ThemeColor cancelHover{};
    ThemeColor cancelText{};
    ThemeColor linkIdle{};
    ThemeColor linkHover{};
    ThemeColor linkText{};
    ThemeColor optionActive{};
    ThemeColor optionActiveText{};
    ThemeColor segmentBackground{};
    ThemeColor segmentThumb{};
    ThemeColor segmentTextActive{};
    ThemeColor segmentTextInactive{};
    ThemeColor toggleActive{};
    ThemeColor toggleInactive{};
    ThemeColor toggleKnob{};
    ThemeColor toggleShadow{};
    ThemeColor sliderTrack{};
    ThemeColor sliderValueActive{};
    ThemeColor sliderValueInactive{};
    ThemeColor sliderKnob{};
    ThemeColor sliderShadow{};
    double overlayGlassTintStrength = 0.0;
    double overlayGlassEdgeStrength = 0.0;
    double overlayDim = 0.0;
    double menuUtilityTextOpacity = 0.0;
    double menuUtilityTextFocusedOpacity = 0.0;
    double menuUtilityBorderFallbackOpacity = 0.0;
    double menuBackfaceDividerOpacity = 0.0;
    double menuBackfaceTagTextOpacity = 0.0;
    double menuPanelBackfaceFillOpacity = 0.0;
    double menuPanelFillOpacity = 0.0;
    double menuPanelStrokeOpacity = 0.0;
    double menuPanelTintOpacity = 0.0;
    double menuPanelEdgeOpacity = 0.0;
    double menuUtilityPanelStrokeOpacity = 0.0;
    double menuPlaceholderOpacity = 0.0;
    double menuCardInnerLineOpacity = 0.0;
    double menuCardInnerLineFocusDelta = 0.0;
    double menuCardRowOpacity = 0.0;

    constexpr bool operator==(const ThemeMetrics&) const noexcept = default;
};

using DarkThemeMetrics = ThemeMetrics;

/** `render::LogicalUiViewport::safeArea`와 같은 logical-unit inset 순서입니다. */
struct LogicalSafeAreaInsets final {
    double left = 0.0;
    double top = 0.0;
    double right = 0.0;
    double bottom = 0.0;

    constexpr bool operator==(const LogicalSafeAreaInsets&) const noexcept = default;
};

struct LayoutInput final {
    double logicalWidth = 0.0;
    double logicalHeight = 0.0;
    double uiScale = 1.0;
    bool hasVersionHistoryLink = true;
    LogicalSafeAreaInsets logicalSafeArea{};

    constexpr bool operator==(const LayoutInput&) const noexcept = default;
};

/** ScreenHandler가 노출하던 WW/WH/UIWW와 모바일 safe-area 사용 영역입니다. */
struct ViewportMetrics final {
    double ww = 0.0;
    double wh = 0.0;
    double uiww = 0.0;
    /** full logical viewport 원점 기준의 16:9 contain UI 좌측 X입니다. */
    double uiOffsetX = 0.0;
    double uiScale = 1.0;
    double scaledUiww = 0.0;
    double scaledWh = 0.0;
    LogicalSafeAreaInsets logicalSafeArea{};
    /** safe-area inset을 제외한 full logical viewport 원점 기준 사용 영역입니다. */
    RoundedRectD safeAreaRect{};
    /** safeAreaRect 안에 16:9 폭으로 contain한 UI 영역입니다. */
    RoundedRectD logicalUiRect{};

    constexpr bool operator==(const ViewportMetrics&) const noexcept = default;
};

enum class TypographyRole : std::uint8_t {
    h1,
    h2,
    h3,
    h4,
    h5,
    h6,
    progressValue,
    label,
    control,
    settingsDescription,
    sliderValue,
    buttonPrimary,
    buttonLink,
    linkPreview,
    displayIcon,
    tooltipTitle,
    tooltipBody,
    cardDescription,
    count
};

inline constexpr std::size_t typography_role_count =
    static_cast<std::size_t>(TypographyRole::count);

struct TypographyMetrics final {
    double size = 0.0;
    double lineHeight = 0.0;
    std::uint16_t weight = 0U;

    constexpr bool operator==(const TypographyMetrics&) const noexcept = default;
};

struct OverlayPageMetrics final {
    double pagePaddingX = 0.0;
    double dialogPaddingX = 0.0;
    double titleTop = 0.0;
    double titleDividerGap = 0.0;
    double dialogBodyGap = 0.0;
    double footerBottom = 0.0;
    double panelRadius = 0.0;
    double interactButtonWidth = 0.0;
    double interactButtonHeight = 0.0;
    double interactButtonMargin = 0.0;
    double interactButtonRadius = 0.0;

    constexpr bool operator==(const OverlayPageMetrics&) const noexcept = default;
};

struct OverlayDialogMetrics final {
    RoundedRectD panelRect{};
    double baseDim = 0.0;

    constexpr bool operator==(const OverlayDialogMetrics&) const noexcept = default;
};

struct TitleOverlayIconLayoutMetrics final {
    double gap = 0.0;
    double maxHeightRatio = 0.0;
    double baseScaleMultiplier = 0.0;
    double gapMultiplier = 0.0;

    constexpr bool operator==(const TitleOverlayIconLayoutMetrics&) const noexcept = default;
};

struct TitleOverlayIconInput final {
    PointD titleOrigin{};
    double titleFontSize = 0.0;
    double aspectRatio = 1.0;
    double scaleMultiplier = 1.0;

    constexpr bool operator==(const TitleOverlayIconInput&) const noexcept = default;
};

struct TitleOverlayIconPlacement final {
    RoundedRectD iconRect{};
    double titleOffsetX = 0.0;

    constexpr bool operator==(const TitleOverlayIconPlacement&) const noexcept = default;
};

struct OverlayLayoutMetrics final {
    OverlayDialogMetrics exit{};
    OverlayDialogMetrics externalLinkWarning{};
    double titleBaseDim = 0.0;
    TitleOverlayIconLayoutMetrics titleIcon{};

    constexpr bool operator==(const OverlayLayoutMetrics&) const noexcept = default;
};

enum class TitleCardSlot : std::uint8_t {
    start,
    quickStart,
    records,
    deck,
    research
};

enum class UtilityTileSlot : std::uint8_t {
    setting,
    credits,
    achievements,
    exit
};

struct TitleCardRevealTiming final {
    TitleCardSlot slot = TitleCardSlot::start;
    double delaySeconds = 0.0;
    double durationSeconds = 0.0;
    double offsetXRatio = 0.0;
    double offsetYRatio = 0.0;
    double scaleOffset = 0.0;

    constexpr bool operator==(const TitleCardRevealTiming&) const noexcept = default;
};

struct TitleTimelineMetrics final {
    double introStartDelaySeconds = 0.0;
    double introBlurStart = 0.0;
    double introBlurDurationSeconds = 0.0;
    double logoPlaybackSeconds = 0.0;
    double transitionAccelSeconds = 0.0;
    double transitionCruiseSeconds = 0.0;
    double transitionDecelSeconds = 0.0;
    double transitionTotalSeconds = 0.0;
    double menuAppearStartDelaySeconds = 0.0;
    double menuDeclaredDurationSeconds = 0.0;
    double menuRevealTotalSeconds = 0.0;
    double menuRevealCoreSeconds = 0.0;
    double pointerTransitionThreshold = 0.0;
    std::array<TitleCardRevealTiming, title_card_count> cardReveal{};

    constexpr bool operator==(const TitleTimelineMetrics&) const noexcept = default;
};

struct TitleCardMetrics final {
    TitleCardSlot slot = TitleCardSlot::start;
    RoundedRectD layoutRect{};
    RoundedRectD settledRect{};
    TypographyMetrics titleTypography{};
    TypographyMetrics descriptionTypography{};
    bool hasDescription = false;

    constexpr bool operator==(const TitleCardMetrics&) const noexcept = default;
};

struct UtilityTileMetrics final {
    UtilityTileSlot slot = UtilityTileSlot::setting;
    RoundedRectD rect{};
    double placeholderSize = 0.0;

    constexpr bool operator==(const UtilityTileMetrics&) const noexcept = default;
};

struct TitleLayoutMetrics final {
    PointD menuLogoAnchor{};
    CircleD introCircle{};
    CircleD settledCircle{};
    RoundedRectD loadingLogoRect{};
    RoundedRectD settledLogoRect{};
    RoundedRectD cardPane{};
    RoundedRectD utilityPane{};
    double versionLabelTop = 0.0;
    double gapBeforeCardPane = 0.0;
    double gapAfterCardPane = 0.0;
    std::array<TitleCardMetrics, title_card_count> cards{};
    std::array<UtilityTileMetrics, utility_tile_count> utilityTiles{};
    TitleTimelineMetrics timeline{};

    constexpr bool operator==(const TitleLayoutMetrics&) const noexcept = default;
};

struct OverlayPresentationMetrics final {
    double alpha = 0.0;
    double dimAlpha = 0.0;
    double contentScale = 0.9;
    double contentBlur = 10.0;

    constexpr bool operator==(const OverlayPresentationMetrics&) const noexcept = default;
};

struct UiLayoutSnapshot final {
    ViewportMetrics viewport{};
    OverlayPageMetrics overlayPage{};
    OverlayLayoutMetrics overlays{};
    std::array<TypographyMetrics, typography_role_count> typography{};
    TitleLayoutMetrics title{};
    /** `overlays.exit.panelRect`의 기존 source 호환 복사본입니다. */
    RoundedRectD exitDialog{};
    std::uint64_t revision = 0U;

    constexpr bool operator==(const UiLayoutSnapshot&) const noexcept = default;
};

struct TitlePaneRenderMetrics final {
    RoundedRectD panelRect{};
    double alpha = 0.0;

    constexpr bool operator==(const TitlePaneRenderMetrics&) const noexcept = default;
};

struct TitleCardRenderMetrics final {
    TitleCardSlot slot = TitleCardSlot::start;
    double revealProgress = 0.0;
    double revealEase = 0.0;
    double alpha = 0.0;
    double entryScale = 1.0;
    double startOffsetX = 0.0;
    double offscreenStartX = 0.0;
    RoundedRectD panelRect{};
    TypographyMetrics titleTypography{};
    TypographyMetrics descriptionTypography{};
    bool hasDescription = false;

    constexpr bool operator==(const TitleCardRenderMetrics&) const noexcept = default;
};

struct UtilityTileRenderMetrics final {
    UtilityTileSlot slot = UtilityTileSlot::setting;
    double revealProgress = 0.0;
    double revealEase = 0.0;
    double alpha = 0.0;
    double translateX = 0.0;
    double translateY = 0.0;
    RoundedRectD panelRect{};
    double placeholderSize = 0.0;

    constexpr bool operator==(const UtilityTileRenderMetrics&) const noexcept = default;
};

struct TitleEntranceRenderState final {
    double elapsedSeconds = 0.0;
    double transitionProgress = 0.0;
    double transitionEase = 0.0;
    double revealClockElapsedSeconds = 0.0;
    double worldScale = 1.0;
    TitlePaneRenderMetrics cardPane{};
    TitlePaneRenderMetrics utilityPane{};
    std::array<TitleCardRenderMetrics, title_card_count> cards{};
    std::array<UtilityTileRenderMetrics, utility_tile_count> utilityTiles{};

    constexpr bool operator==(const TitleEntranceRenderState&) const noexcept = default;
};

/**
 * 고정 크기 snapshot만 소유합니다. update는 후보 snapshot을 스택에 완성한 뒤
 * commit하므로 유효하지 않은 입력이 기존 상태를 부분 변경하지 않습니다.
 */
class UiLayoutMetrics final {
public:
    [[nodiscard]] bool tryUpdate(const LayoutInput& input) noexcept;
    [[nodiscard]] bool hasSnapshot() const noexcept;
    [[nodiscard]] const UiLayoutSnapshot& snapshot() const noexcept;

private:
    UiLayoutSnapshot snapshot_{};
    bool hasSnapshot_ = false;
};

[[nodiscard]] const DarkThemeMetrics& darkThemeMetrics() noexcept;
[[nodiscard]] const ThemeMetrics& lightThemeMetrics() noexcept;
/** 알 수 없는 enum 값은 JS registry의 기본 key와 같은 dark로 fallback합니다. */
[[nodiscard]] const ThemeMetrics& themeMetrics(ThemeVariant variant) noexcept;

/** 유효하지 않은 입력에서는 out을 변경하지 않습니다. */
[[nodiscard]] bool tryResolveTypography(
    TypographyRole role,
    const ViewportMetrics& viewport,
    TypographyMetrics& out
) noexcept;

/** JS `uiAnimation` open 트랙을 샘플링하며 실패 시 out을 보존합니다. */
[[nodiscard]] bool trySampleOverlayOpen(
    double elapsedSeconds,
    OverlayPresentationMetrics& out
) noexcept;

/** 현재 presentation에서 시작하는 close 트랙을 샘플링하며 실패 시 out을 보존합니다. */
[[nodiscard]] bool trySampleOverlayClose(
    double elapsedSeconds,
    const OverlayPresentationMetrics& start,
    OverlayPresentationMetrics& out
) noexcept;

/** 타이틀 전환 시작 뒤의 clean elapsed seconds에서 카드/pane/tile 렌더 상태를 샘플링합니다. */
[[nodiscard]] bool trySampleTitleEntrance(
    const UiLayoutSnapshot& snapshot,
    double elapsedSeconds,
    TitleEntranceRenderState& out
) noexcept;

/** 제목 텍스트 원점과 font size를 기준으로 공통 타이틀 overlay 아이콘을 배치합니다. */
[[nodiscard]] bool tryResolveTitleOverlayIconPlacement(
    const TitleOverlayIconLayoutMetrics& layout,
    const TitleOverlayIconInput& input,
    TitleOverlayIconPlacement& out
) noexcept;

static_assert(std::is_trivially_copyable_v<ThemeColor>);
static_assert(std::is_trivially_copyable_v<ThemeMetrics>);
static_assert(std::is_trivially_copyable_v<LogicalSafeAreaInsets>);
static_assert(std::is_trivially_copyable_v<LayoutInput>);
static_assert(std::is_trivially_copyable_v<ViewportMetrics>);
static_assert(std::is_trivially_copyable_v<OverlayLayoutMetrics>);
static_assert(std::is_trivially_copyable_v<TitleOverlayIconInput>);
static_assert(std::is_trivially_copyable_v<TitleOverlayIconPlacement>);
static_assert(std::is_trivially_copyable_v<TitleLayoutMetrics>);
static_assert(std::is_trivially_copyable_v<TitleEntranceRenderState>);
static_assert(std::is_trivially_copyable_v<UiLayoutSnapshot>);
static_assert(std::is_standard_layout_v<ThemeColor>);
static_assert(std::is_standard_layout_v<ThemeMetrics>);
static_assert(std::is_standard_layout_v<LogicalSafeAreaInsets>);
static_assert(std::is_standard_layout_v<LayoutInput>);
static_assert(std::is_standard_layout_v<ViewportMetrics>);
static_assert(std::is_standard_layout_v<OverlayLayoutMetrics>);
static_assert(std::is_standard_layout_v<TitleOverlayIconInput>);
static_assert(std::is_standard_layout_v<TitleOverlayIconPlacement>);
static_assert(std::is_standard_layout_v<TitleLayoutMetrics>);
static_assert(std::is_standard_layout_v<TitleEntranceRenderState>);
static_assert(std::is_standard_layout_v<UiLayoutSnapshot>);

} // namespace cirvivor::ui::layout
