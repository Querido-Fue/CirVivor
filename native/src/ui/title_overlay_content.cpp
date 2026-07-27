#include "ui/title_overlay_content.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace cirvivor::ui {
namespace {

struct PanelRatio final {
    double width = 0.0;
    double height = 0.0;
};

[[nodiscard]] constexpr PanelRatio panelRatioFor(const OverlayKind kind) noexcept {
    switch (kind) {
    case OverlayKind::mapSelect:
        return {0.52, 0.68};
    case OverlayKind::quickStart:
        return {0.42, 0.34};
    case OverlayKind::records:
        return {0.50, 0.42};
    case OverlayKind::deck:
        return {0.65, 0.70};
    case OverlayKind::research:
    case OverlayKind::achievements:
        return {0.54, 0.50};
    case OverlayKind::setting:
        return {0.65, 0.70};
    case OverlayKind::credits:
        return {0.40, 0.55};
    case OverlayKind::debug:
        return {0.36, 0.52};
    case OverlayKind::exitConfirm:
        return {0.30, 0.20};
    case OverlayKind::externalLinkWarning:
        return {0.30, 0.23};
    case OverlayKind::none:
        return {};
    }
    return {};
}

[[nodiscard]] bool finitePositive(const double value) noexcept {
    return std::isfinite(value) && value > 0.0;
}

[[nodiscard]] bool finiteRect(const layout::RoundedRectD& rect) noexcept {
    return std::isfinite(rect.x)
        && std::isfinite(rect.y)
        && finitePositive(rect.width)
        && finitePositive(rect.height)
        && std::isfinite(rect.radius)
        && rect.radius >= 0.0;
}

[[nodiscard]] layout::RoundedRectD centeredPanel(
    const layout::ViewportMetrics& viewport,
    const PanelRatio ratio
) noexcept {
    const double width = viewport.uiww * ratio.width * viewport.uiScale;
    const double height = viewport.safeAreaRect.height
        * ratio.height
        * viewport.uiScale;
    return {
        viewport.safeAreaRect.x + ((viewport.safeAreaRect.width - width) * 0.5),
        viewport.safeAreaRect.y + ((viewport.safeAreaRect.height - height) * 0.5),
        width,
        height,
        viewport.uiww * 0.006 * viewport.uiScale
    };
}

[[nodiscard]] layout::RoundedRectD scaleRectAround(
    const layout::RoundedRectD& rect,
    const layout::PointD center,
    const double scale
) noexcept {
    return {
        center.x + ((rect.x - center.x) * scale),
        center.y + ((rect.y - center.y) * scale),
        rect.width * scale,
        rect.height * scale,
        rect.radius * scale
    };
}

[[nodiscard]] bool appendControl(
    TitleOverlayPresentation& presentation,
    const TitleOverlayControlId id,
    const layout::RoundedRectD& baseRect,
    const layout::PointD center,
    const double scale,
    const TitleOverlayControlAction action = TitleOverlayControlAction::none,
    const double value = 0.0,
    const bool selected = false,
    const bool enabled = true
) noexcept {
    if (presentation.controlCount >= presentation.controls.size()) {
        return false;
    }
    presentation.controls[presentation.controlCount++] = {
        id,
        action,
        scaleRectAround(baseRect, center, scale),
        value,
        enabled,
        selected
    };
    return true;
}

[[nodiscard]] layout::RoundedRectD footerButton(
    const layout::RoundedRectD& panel,
    const layout::OverlayPageMetrics& page,
    const std::size_t reverseIndex
) noexcept {
    return {
        panel.x + panel.width - page.dialogPaddingX - page.interactButtonWidth
            - (static_cast<double>(reverseIndex)
                * (page.interactButtonWidth + page.interactButtonMargin)),
        panel.y + panel.height - page.footerBottom - page.interactButtonHeight,
        page.interactButtonWidth,
        page.interactButtonHeight,
        page.interactButtonRadius
    };
}

[[nodiscard]] bool appendCloseFooter(
    TitleOverlayPresentation& result,
    const layout::RoundedRectD& basePanel,
    const layout::OverlayPageMetrics& page,
    const layout::PointD center,
    const double scale
) noexcept {
    return appendControl(
        result,
        TitleOverlayControlId::close,
        footerButton(basePanel, page, 0U),
        center,
        scale,
        TitleOverlayControlAction::cancelTop
    );
}

[[nodiscard]] bool appendTwoButtonFooter(
    TitleOverlayPresentation& result,
    const layout::RoundedRectD& basePanel,
    const layout::OverlayPageMetrics& page,
    const layout::PointD center,
    const double scale
) noexcept {
    return appendControl(
            result,
            TitleOverlayControlId::cancel,
            footerButton(basePanel, page, 1U),
            center,
            scale,
            TitleOverlayControlAction::cancelTop
        )
        && appendControl(
            result,
            TitleOverlayControlId::confirm,
            footerButton(basePanel, page, 0U),
            center,
            scale,
            TitleOverlayControlAction::confirmTop
        );
}

[[nodiscard]] bool appendDeckControls(
    TitleOverlayPresentation& result,
    const layout::RoundedRectD& panel,
    const layout::OverlayPageMetrics& page,
    const layout::PointD center,
    const double scale
) noexcept {
    const double gap = page.pagePaddingX;
    const double top = result.bodyRect.y + (result.bodyRect.height * 0.04);
    const double height = std::max(1.0, result.bodyRect.height * 0.76);
    const double width = std::max(1.0, (result.bodyRect.width - gap) * 0.5);
    return appendControl(
            result,
            TitleOverlayControlId::deckAchievements,
            {result.bodyRect.x, top, width, height, panel.radius},
            center,
            1.0
        )
        && appendControl(
            result,
            TitleOverlayControlId::deckEncyclopedia,
            {result.bodyRect.x + width + gap, top, width, height, panel.radius},
            center,
            1.0
        )
        && appendCloseFooter(result, panel, page, center, scale);
}

[[nodiscard]] bool appendSettingsControls(
    TitleOverlayPresentation& result,
    const layout::RoundedRectD& basePanel,
    const layout::OverlayPageMetrics& page,
    const layout::PointD center,
    const double scale
) noexcept {
    constexpr std::array leftIds{
        TitleOverlayControlId::settingWindowMode,
        TitleOverlayControlId::settingUltrawide,
        TitleOverlayControlId::settingRenderScale,
        TitleOverlayControlId::settingUiScale,
        TitleOverlayControlId::settingOpaqueUi,
        TitleOverlayControlId::settingBenchmark
    };
    constexpr std::array rightIds{
        TitleOverlayControlId::settingLanguage,
        TitleOverlayControlId::settingTheme,
        TitleOverlayControlId::settingTooltipDelay,
        TitleOverlayControlId::settingBgm,
        TitleOverlayControlId::settingSfx,
        TitleOverlayControlId::settingKeybindings
    };
    constexpr std::array leftValues{0.0, 1.0, 1.0, 1.0, 0.0, 0.0};
    constexpr std::array rightValues{0.0, 1.0, 0.15, 0.25, 0.40, 0.0};
    const double columnGap = result.bodyRect.width * 0.06;
    const double columnWidth = (result.bodyRect.width - columnGap) * 0.5;
    const double rowsTop = result.bodyRect.y + (result.bodyRect.height * 0.09);
    const double rowsHeight = result.bodyRect.height * 0.91;
    const double rowGap = rowsHeight * 0.018;
    const double rowHeight = (rowsHeight - (rowGap * 5.0)) / 6.0;
    for (std::size_t index = 0U; index < leftIds.size(); ++index) {
        const double y = rowsTop
            + (static_cast<double>(index) * (rowHeight + rowGap));
        if (!appendControl(
                result,
                leftIds[index],
                {result.bodyRect.x, y, columnWidth, rowHeight, basePanel.radius * 0.45},
                center,
                1.0,
                TitleOverlayControlAction::none,
                leftValues[index],
                leftValues[index] > 0.5)) {
            return false;
        }
        if (!appendControl(
                result,
                rightIds[index],
                {
                    result.bodyRect.x + columnWidth + columnGap,
                    y,
                    columnWidth,
                    rowHeight,
                    basePanel.radius * 0.45
                },
                center,
                1.0,
                TitleOverlayControlAction::none,
                rightValues[index],
                rightValues[index] > 0.5)) {
            return false;
        }
    }
    return appendControl(
            result,
            TitleOverlayControlId::cancel,
            footerButton(basePanel, page, 1U),
            center,
            scale,
            TitleOverlayControlAction::cancelTop
        )
        && appendControl(
            result,
            TitleOverlayControlId::confirm,
            footerButton(basePanel, page, 0U),
            center,
            scale,
            TitleOverlayControlAction::none,
            0.0,
            false,
            false
        );
}

[[nodiscard]] bool appendCreditsControls(
    TitleOverlayPresentation& result,
    const layout::RoundedRectD& basePanel,
    const layout::OverlayPageMetrics& page,
    const layout::PointD center,
    const double scale
) noexcept {
    constexpr std::array ids{
        TitleOverlayControlId::creditsBlog,
        TitleOverlayControlId::creditsCirvivorGithub,
        TitleOverlayControlId::creditsPretendardGithub,
        TitleOverlayControlId::creditsOutfitGithub,
        TitleOverlayControlId::creditsReactBitsGithub
    };
    const double gap = result.bodyRect.height * 0.025;
    const double rowHeight = (result.bodyRect.height - (gap * 4.0)) / 5.0;
    for (std::size_t index = 0U; index < ids.size(); ++index) {
        if (!appendControl(
                result,
                ids[index],
                {
                    result.bodyRect.x,
                    result.bodyRect.y
                        + (static_cast<double>(index) * (rowHeight + gap)),
                    result.bodyRect.width,
                    rowHeight,
                    basePanel.radius * 0.45
                },
                center,
                1.0,
                TitleOverlayControlAction::openExternalLink)) {
            return false;
        }
    }
    return appendCloseFooter(result, basePanel, page, center, scale);
}

[[nodiscard]] bool appendDebugControls(
    TitleOverlayPresentation& result,
    const layout::RoundedRectD& basePanel,
    const layout::OverlayPageMetrics& page,
    const layout::PointD center,
    const double scale
) noexcept {
    constexpr std::array ids{
        TitleOverlayControlId::debugFrameTime,
        TitleOverlayControlId::debugPoolInfo,
        TitleOverlayControlId::debugHitboxes,
        TitleOverlayControlId::debugAnimation
    };
    const double rowHeight = result.bodyRect.height * 0.13;
    const double gap = result.bodyRect.height * 0.025;
    for (std::size_t index = 0U; index < ids.size(); ++index) {
        if (!appendControl(
                result,
                ids[index],
                {
                    result.bodyRect.x,
                    result.bodyRect.y
                        + (static_cast<double>(index) * (rowHeight + gap)),
                    result.bodyRect.width,
                    rowHeight,
                    basePanel.radius * 0.45
                },
                center,
                1.0,
                TitleOverlayControlAction::none,
                index == 3U ? 0.0 : 1.0,
                index != 3U)) {
            return false;
        }
    }
    const layout::RoundedRectD close = footerButton(basePanel, page, 0U);
    if (!appendControl(
            result,
            TitleOverlayControlId::debugOpenDevTools,
            footerButton(basePanel, page, 1U),
            center,
            scale)) {
        return false;
    }
    return appendControl(
        result,
        TitleOverlayControlId::close,
        close,
        center,
        scale,
        TitleOverlayControlAction::cancelTop
    );
}

[[nodiscard]] bool buildPresentation(
    const OverlaySnapshot& overlay,
    const layout::UiLayoutSnapshot& layoutSnapshot,
    TitleOverlayPresentation& result
) noexcept {
    const PanelRatio ratio = panelRatioFor(overlay.kind);
    if (!finitePositive(ratio.width)
        || !finitePositive(ratio.height)
        || !finitePositive(overlay.contentScale)) {
        return false;
    }
    layout::RoundedRectD basePanel = centeredPanel(layoutSnapshot.viewport, ratio);
    if (overlay.kind == OverlayKind::mapSelect) {
        basePanel = layoutSnapshot.overlays.mapSelect.panelRect;
    } else if (overlay.kind == OverlayKind::exitConfirm) {
        basePanel = layoutSnapshot.overlays.exit.panelRect;
    } else if (overlay.kind == OverlayKind::externalLinkWarning) {
        basePanel = layoutSnapshot.overlays.externalLinkWarning.panelRect;
    }
    if (!finiteRect(basePanel)) {
        return false;
    }

    const layout::PointD center{
        basePanel.x + (basePanel.width * 0.5),
        basePanel.y + (basePanel.height * 0.5)
    };
    const layout::OverlayPageMetrics& page = layoutSnapshot.overlayPage;
    const double headerY = basePanel.y + page.titleTop
        + layoutSnapshot.typography[
            static_cast<std::size_t>(layout::TypographyRole::h1)
        ].lineHeight
        + page.titleDividerGap;
    const double footerTop = basePanel.y + basePanel.height
        - page.footerBottom - page.interactButtonHeight - page.dialogBodyGap;
    const layout::RoundedRectD baseBody{
        basePanel.x + page.pagePaddingX,
        headerY + page.dialogBodyGap,
        std::max(1.0, basePanel.width - (page.pagePaddingX * 2.0)),
        std::max(1.0, footerTop - (headerY + page.dialogBodyGap)),
        0.0
    };
    result = {
        .kind = overlay.kind,
        .sequence = overlay.sequence,
        .layer = overlay.layer,
        .alpha = overlay.alpha,
        .dimAlpha = overlay.dimAlpha,
        .contentScale = overlay.contentScale,
        .contentBlur = overlay.contentBlur,
        .acceptsInput = overlay.acceptsInput,
        .interactionsLocked = overlay.interactionsLocked,
        .panelRect = scaleRectAround(basePanel, center, overlay.contentScale),
        .bodyRect = scaleRectAround(baseBody, center, overlay.contentScale),
        .headerDividerRect = scaleRectAround(
            {
                basePanel.x + page.pagePaddingX,
                headerY,
                std::max(1.0, basePanel.width - (page.pagePaddingX * 2.0)),
                1.0,
                0.0
            },
            center,
            overlay.contentScale
        )
    };

    switch (overlay.kind) {
    case OverlayKind::mapSelect: {
        const layout::RoundedRectD preview{
            baseBody.x,
            baseBody.y + (baseBody.height * 0.16),
            baseBody.width,
            std::min(baseBody.height * 0.58, layoutSnapshot.viewport.safeAreaRect.height * 0.25),
            basePanel.radius
        };
        result.mapPreviewRect = scaleRectAround(
            preview,
            center,
            overlay.contentScale
        );
        return appendTwoButtonFooter(result, basePanel, page, center, overlay.contentScale);
    }
    case OverlayKind::exitConfirm:
    case OverlayKind::externalLinkWarning:
        return appendTwoButtonFooter(result, basePanel, page, center, overlay.contentScale);
    case OverlayKind::deck:
        return appendDeckControls(result, basePanel, page, center, overlay.contentScale);
    case OverlayKind::setting:
        return appendSettingsControls(result, basePanel, page, center, overlay.contentScale);
    case OverlayKind::credits:
        return appendCreditsControls(result, basePanel, page, center, overlay.contentScale);
    case OverlayKind::debug:
        return appendDebugControls(result, basePanel, page, center, overlay.contentScale);
    case OverlayKind::quickStart:
    case OverlayKind::records:
    case OverlayKind::research:
    case OverlayKind::achievements:
        return appendCloseFooter(result, basePanel, page, center, overlay.contentScale);
    case OverlayKind::none:
        return false;
    }
    return false;
}

[[nodiscard]] bool pointInside(
    const layout::PointD& point,
    const layout::RoundedRectD& rect
) noexcept {
    if (!std::isfinite(point.x)
        || !std::isfinite(point.y)
        || point.x < rect.x
        || point.x > rect.x + rect.width
        || point.y < rect.y
        || point.y > rect.y + rect.height) {
        return false;
    }
    const double radius = std::clamp(
        rect.radius,
        0.0,
        std::min(rect.width, rect.height) * 0.5
    );
    if (radius <= 0.0) {
        return true;
    }
    const double localX = point.x - rect.x;
    const double localY = point.y - rect.y;
    const double nearestX = std::clamp(localX, radius, rect.width - radius);
    const double nearestY = std::clamp(localY, radius, rect.height - radius);
    return std::hypot(localX - nearestX, localY - nearestY) <= radius;
}

} // namespace

bool tryBuildTitleOverlayPresentationSet(
    const UiStateSnapshot& state,
    const layout::UiLayoutSnapshot& layoutSnapshot,
    TitleOverlayPresentationSet& out
) noexcept {
    if (state.overlayCount > maximum_overlay_count
        || layoutSnapshot.revision == 0U
        || !finiteRect(layoutSnapshot.viewport.safeAreaRect)
        || !finitePositive(layoutSnapshot.viewport.uiww)
        || !finitePositive(layoutSnapshot.viewport.uiScale)) {
        return false;
    }
    TitleOverlayPresentationSet candidate{};
    candidate.overlayCount = state.overlayCount;
    candidate.stateRevision = state.revision;
    candidate.layoutRevision = layoutSnapshot.revision;
    for (std::size_t index = 0U; index < state.overlayCount; ++index) {
        if (!buildPresentation(
                state.overlays[index],
                layoutSnapshot,
                candidate.overlays[index])) {
            return false;
        }
    }
    out = candidate;
    return true;
}

const TitleOverlayPresentation* findTitleOverlayPresentation(
    const TitleOverlayPresentationSet& presentations,
    const std::uint32_t sequence
) noexcept {
    if (sequence == 0U || presentations.overlayCount > maximum_overlay_count) {
        return nullptr;
    }
    for (std::size_t index = 0U; index < presentations.overlayCount; ++index) {
        if (presentations.overlays[index].sequence == sequence) {
            return &presentations.overlays[index];
        }
    }
    return nullptr;
}

const TitleOverlayPresentation* findLatestTitleOverlayPresentation(
    const TitleOverlayPresentationSet& presentations
) noexcept {
    if (presentations.overlayCount > maximum_overlay_count) {
        return nullptr;
    }
    const TitleOverlayPresentation* result = nullptr;
    for (std::size_t index = 0U; index < presentations.overlayCount; ++index) {
        const TitleOverlayPresentation& candidate = presentations.overlays[index];
        if (result == nullptr || candidate.sequence > result->sequence) {
            result = &candidate;
        }
    }
    return result;
}

const TitleOverlayControl* hitTestTitleOverlayControl(
    const TitleOverlayPresentation& presentation,
    const layout::PointD& point
) noexcept {
    const std::size_t count = std::min<std::size_t>(
        presentation.controlCount,
        presentation.controls.size()
    );
    for (std::size_t reverse = count; reverse > 0U; --reverse) {
        const TitleOverlayControl& control = presentation.controls[reverse - 1U];
        if (control.enabled
            && control.action != TitleOverlayControlAction::none
            && pointInside(point, control.rect)) {
            return &control;
        }
    }
    return nullptr;
}

} // namespace cirvivor::ui
