#include "render/frontend/global_debug_overlay.h"

#include "render/frontend/title_overlay_presenter.h"
#include "render/frontend/title_scene.h"
#include "render/text/title_text_catalog.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace cirvivor::render::frontend {
namespace {

constexpr double debug_dim = 0.16;
constexpr std::size_t debug_control_count = 6U;
constexpr std::size_t debug_text_count = 8U;

constexpr RenderLayerMask backdrop_source_layers = static_cast<RenderLayerMask>(
    renderLayerMask(RenderLayer::background)
    | renderLayerMask(RenderLayer::object)
    | renderLayerMask(RenderLayer::effect)
    | renderLayerMask(RenderLayer::textEffect)
    | renderLayerMask(RenderLayer::ui)
    | renderLayerMask(RenderLayer::vignette)
);

constexpr StableElementId overlay_dim_session_id = stableResourceId(
    "title.overlay.dim"
);
constexpr StableElementId overlay_effect_session_id = stableResourceId(
    "title.overlay.effect"
);
constexpr StableElementId overlay_effect_destination_id = stableResourceId(
    "title.overlay.effect.destination"
);
constexpr StableElementId overlay_ui_session_id = stableResourceId(
    "title.overlay.ui"
);

constexpr std::array debug_text_semantics{
    UiTextSemanticId::debugTitle,
    UiTextSemanticId::debugFrameTime,
    UiTextSemanticId::debugPoolInfo,
    UiTextSemanticId::debugHitboxes,
    UiTextSemanticId::debugAnimation,
    UiTextSemanticId::debugHint,
    UiTextSemanticId::debugDevTools,
    UiTextSemanticId::debugClose
};
static_assert(debug_text_semantics.size() == debug_text_count);

constexpr std::array debug_control_ids{
    ui::TitleOverlayControlId::debugFrameTime,
    ui::TitleOverlayControlId::debugPoolInfo,
    ui::TitleOverlayControlId::debugHitboxes,
    ui::TitleOverlayControlId::debugAnimation,
    ui::TitleOverlayControlId::debugOpenDevTools,
    ui::TitleOverlayControlId::close
};
static_assert(debug_control_ids.size() == debug_control_count);

enum class DebugSelectionStatus : std::uint8_t {
    none,
    valid,
    invalid
};

struct ResolvedDebugOverlay final {
    const ui::OverlaySnapshot* overlay = nullptr;
    const ui::TitleOverlayPresentation* presentation = nullptr;
    OverlaySurfaceLayerOrders orders{};
    FramePacketCapacity capacity{};
};

[[nodiscard]] CommandHeader makeHeader(
    const std::int32_t layerOrder
) noexcept {
    return {
        RenderLayer::dynamicOverlay,
        CoordinateSpace::logicalUi,
        BlendMode::premultipliedAlpha,
        0U,
        layerOrder,
        0U
    };
}

[[nodiscard]] double clampUnit(const double value) noexcept {
    return std::isfinite(value) ? std::clamp(value, 0.0, 1.0) : 0.0;
}

[[nodiscard]] float finiteFloat(const double value) noexcept {
    const double maximum = static_cast<double>(std::numeric_limits<float>::max());
    if (!std::isfinite(value) || value > maximum || value < -maximum) {
        return std::numeric_limits<float>::quiet_NaN();
    }
    return static_cast<float>(value);
}

[[nodiscard]] PremultipliedRgba renderColor(
    const ui::layout::ThemeColor color,
    const double alphaScale = 1.0
) noexcept {
    constexpr float byte_scale = 1.0F / 255.0F;
    const float alpha = static_cast<float>(clampUnit(color.alpha * alphaScale));
    return PremultipliedRgba::fromStraight(
        static_cast<float>(color.red) * byte_scale,
        static_cast<float>(color.green) * byte_scale,
        static_cast<float>(color.blue) * byte_scale,
        alpha
    );
}

[[nodiscard]] RectF renderRect(
    const ui::layout::RoundedRectD& rect
) noexcept {
    return {
        finiteFloat(rect.x),
        finiteFloat(rect.y),
        finiteFloat(rect.width),
        finiteFloat(rect.height)
    };
}

[[nodiscard]] bool tryResolveFullDrawableLogicalBounds(
    const ViewportState& viewport,
    RectF& output
) noexcept {
    const float scaleX = viewport.logicalUi.drawablePixelsPerLogicalUnitX;
    const float scaleY = viewport.logicalUi.drawablePixelsPerLogicalUnitY;
    const RectI drawableContent = viewport.drawable.contentRect;
    const RectF logicalContent = viewport.logicalUi.contentRect;
    if (viewport.drawable.size.width <= 0
        || viewport.drawable.size.height <= 0
        || drawableContent.width <= 0
        || drawableContent.height <= 0
        || !std::isfinite(scaleX)
        || !std::isfinite(scaleY)
        || scaleX <= 0.0F
        || scaleY <= 0.0F
        || !std::isfinite(logicalContent.x)
        || !std::isfinite(logicalContent.y)) {
        return false;
    }

    const RectF candidate{
        logicalContent.x - static_cast<float>(drawableContent.x) / scaleX,
        logicalContent.y - static_cast<float>(drawableContent.y) / scaleY,
        static_cast<float>(viewport.drawable.size.width) / scaleX,
        static_cast<float>(viewport.drawable.size.height) / scaleY
    };
    if (!std::isfinite(candidate.x)
        || !std::isfinite(candidate.y)
        || !std::isfinite(candidate.width)
        || !std::isfinite(candidate.height)
        || candidate.width <= 0.0F
        || candidate.height <= 0.0F) {
        return false;
    }
    output = candidate;
    return true;
}

[[nodiscard]] StableElementId instanceId(
    const StableElementId base,
    const std::uint32_t sequence
) noexcept {
    StableElementId value = base
        ^ (static_cast<StableElementId>(sequence) * 0x9e37'79b9'7f4a'7c15ULL);
    if (value == 0U) {
        value = base == 0U ? 1U : base;
    }
    return value;
}

[[nodiscard]] bool finiteUnit(const double value) noexcept {
    return std::isfinite(value) && value >= 0.0 && value <= 1.0;
}

[[nodiscard]] bool finitePositive(const double value) noexcept {
    return std::isfinite(value) && value > 0.0;
}

[[nodiscard]] bool finiteNonNegative(const double value) noexcept {
    return std::isfinite(value) && value >= 0.0;
}

[[nodiscard]] bool finiteRect(
    const ui::layout::RoundedRectD& rect
) noexcept {
    return std::isfinite(rect.x)
        && std::isfinite(rect.y)
        && finitePositive(rect.width)
        && finitePositive(rect.height)
        && finiteNonNegative(rect.radius);
}

[[nodiscard]] bool themeColorIsValid(
    const ui::layout::ThemeColor& color
) noexcept {
    return finiteUnit(color.alpha);
}

[[nodiscard]] bool requiredThemeIsValid(
    const ui::layout::ThemeMetrics& theme
) noexcept {
    return themeColorIsValid(theme.titleText)
        && themeColorIsValid(theme.overlayValueText)
        && themeColorIsValid(theme.overlayPanelBackground)
        && themeColorIsValid(theme.overlayPanelBorder)
        && themeColorIsValid(theme.overlayGlassBackground)
        && themeColorIsValid(theme.overlayGlassBorder)
        && themeColorIsValid(theme.overlayGlassTint)
        && themeColorIsValid(theme.overlayGlassEdge)
        && themeColorIsValid(theme.overlayDivider)
        && themeColorIsValid(theme.overlayPanelShadow)
        && themeColorIsValid(theme.overlayControlInactive)
        && themeColorIsValid(theme.overlayControlHover)
        && themeColorIsValid(theme.overlayControlText)
        && themeColorIsValid(theme.toggleActive)
        && themeColorIsValid(theme.sliderValueActive)
        && finiteNonNegative(theme.overlayGlassTintStrength)
        && finiteNonNegative(theme.overlayGlassEdgeStrength);
}

[[nodiscard]] constexpr bool isTitleUiTarget(
    const ui::TitleUiTarget target
) noexcept {
    switch (target) {
    case ui::TitleUiTarget::cardStart:
    case ui::TitleUiTarget::cardQuickStart:
    case ui::TitleUiTarget::cardRecords:
    case ui::TitleUiTarget::cardDeck:
    case ui::TitleUiTarget::cardResearch:
    case ui::TitleUiTarget::utilitySetting:
    case ui::TitleUiTarget::utilityCredits:
    case ui::TitleUiTarget::utilityAchievements:
    case ui::TitleUiTarget::utilityExit:
    case ui::TitleUiTarget::versionHistoryLink:
    case ui::TitleUiTarget::overlayCancel:
    case ui::TitleUiTarget::overlayConfirm:
        return true;
    case ui::TitleUiTarget::none:
        return false;
    }
    return false;
}

[[nodiscard]] bool interactionTableIsValid(
    const ui::TitleUiControllerSnapshot& interaction
) noexcept {
    for (std::size_t index = 0U; index < interaction.targets.size(); ++index) {
        if (!isTitleUiTarget(interaction.targets[index].target)) {
            return false;
        }
        for (std::size_t previous = 0U; previous < index; ++previous) {
            if (interaction.targets[previous].target
                == interaction.targets[index].target) {
                return false;
            }
        }
    }
    return true;
}

[[nodiscard]] bool glyphIsValid(const GlyphInstance& glyph) noexcept {
    const auto finiteVec = [](const Vec2F value) noexcept {
        return std::isfinite(value.x) && std::isfinite(value.y);
    };
    const RectF uv = glyph.uv;
    return finiteVec(glyph.position)
        && finiteVec(glyph.advance)
        && finiteVec(glyph.offset)
        && std::isfinite(uv.x)
        && std::isfinite(uv.y)
        && std::isfinite(uv.width)
        && std::isfinite(uv.height)
        && uv.x >= 0.0F
        && uv.y >= 0.0F
        && uv.width >= 0.0F
        && uv.height >= 0.0F
        && uv.x + uv.width <= 1.0F
        && uv.y + uv.height <= 1.0F;
}

[[nodiscard]] bool addGlyphCapacity(
    FramePacketCapacity& capacity,
    const GlobalDebugOverlayInput& input,
    const UiTextSemanticId semantic
) noexcept {
    const PreShapedTextRunView* const run = input.textResources.find(
        text::titleTextKey(semantic, input.locale)
    );
    if (run == nullptr
        || run->glyphs.empty()
        || run->rasterPixelSize == 0U
        || run->key.weight < 1
        || run->key.weight > 1'000
        || !std::isfinite(run->advance)
        || !std::isfinite(run->ascent)
        || !std::isfinite(run->descent)
        || run->glyphs.size()
            > maximumGlobalDebugOverlayCapacity().glyphInstanceCount
                - capacity.glyphInstanceCount) {
        return false;
    }
    for (const GlyphInstance& glyph : run->glyphs) {
        if (!glyphIsValid(glyph)) {
            return false;
        }
    }
    ++capacity.glyphRunCount;
    capacity.glyphInstanceCount += run->glyphs.size();
    return true;
}

[[nodiscard]] bool presentationIsValid(
    const ui::OverlaySnapshot& overlay,
    const ui::TitleOverlayPresentation& presentation
) noexcept {
    if (presentation.kind != ui::OverlayKind::debug
        || presentation.kind != overlay.kind
        || presentation.sequence != overlay.sequence
        || presentation.layer != overlay.layer
        || presentation.alpha != overlay.alpha
        || presentation.dimAlpha != overlay.dimAlpha
        || presentation.contentScale != overlay.contentScale
        || presentation.contentBlur != overlay.contentBlur
        || presentation.acceptsInput != overlay.acceptsInput
        || presentation.interactionsLocked != overlay.interactionsLocked
        || presentation.controlCount != debug_control_count
        || !finiteUnit(presentation.alpha)
        || !finiteUnit(presentation.dimAlpha)
        || !finitePositive(presentation.contentScale)
        || !finiteNonNegative(presentation.contentBlur)
        || !finiteRect(presentation.panelRect)
        || !finiteRect(presentation.bodyRect)
        || !finiteRect(presentation.headerDividerRect)) {
        return false;
    }
    for (std::size_t index = 0U; index < debug_control_ids.size(); ++index) {
        const ui::TitleOverlayControl& control = presentation.controls[index];
        const ui::TitleOverlayControlAction expectedAction = index < 4U
            ? ui::TitleOverlayControlAction::activateApplicationControl
            : index == 4U
                ? ui::TitleOverlayControlAction::none
                : ui::TitleOverlayControlAction::cancelTop;
        if (control.id != debug_control_ids[index]
            || control.action != expectedAction
            || !finiteRect(control.rect)
            || !finiteRect(control.valueRect)
            || !finiteUnit(control.value)) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] DebugSelectionStatus resolveDebugOverlay(
    const GlobalDebugOverlayInput& input,
    ResolvedDebugOverlay& out
) noexcept {
    if (input.uiState.overlayCount > input.uiState.overlays.size()) {
        return DebugSelectionStatus::invalid;
    }

    const ui::OverlaySnapshot* overlay = nullptr;
    for (std::size_t index = 0U; index < input.uiState.overlayCount; ++index) {
        if (input.uiState.overlays[index].kind != ui::OverlayKind::debug) {
            continue;
        }
        if (overlay != nullptr) {
            return DebugSelectionStatus::invalid;
        }
        overlay = &input.uiState.overlays[index];
    }
    if (overlay == nullptr) {
        return DebugSelectionStatus::none;
    }

    ResolvedDebugOverlay candidate{};
    candidate.overlay = overlay;
    if (overlay->key != ui::OverlayKey::debugPanel
        || !finiteUnit(overlay->alpha)
        || !finiteUnit(overlay->dimAlpha)
        || !finitePositive(overlay->contentScale)
        || !finiteNonNegative(overlay->contentBlur)
        || !tryResolveOverlaySurfaceLayerOrders(*overlay, candidate.orders)
        || input.overlayPresentations.overlayCount
            > input.overlayPresentations.overlays.size()
        || input.overlayPresentations.overlayCount != input.uiState.overlayCount
        || input.overlayPresentations.stateRevision != input.uiState.revision
        || input.overlayPresentations.layoutRevision != input.layout.revision
        || input.layout.revision == 0U
        || !finitePositive(input.layout.viewport.ww)
        || !finitePositive(input.layout.viewport.wh)
        || !finiteNonNegative(input.layout.overlayPage.titleTop)
        || !interactionTableIsValid(input.interaction)
        || !requiredThemeIsValid(input.theme)
        || !input.textResources.isValid()) {
        return DebugSelectionStatus::invalid;
    }
    for (const ui::layout::TypographyRole role : std::array{
            ui::layout::TypographyRole::h2,
            ui::layout::TypographyRole::control,
            ui::layout::TypographyRole::settingsDescription,
            ui::layout::TypographyRole::buttonPrimary
        }) {
        if (!finitePositive(input.layout.typography[
                static_cast<std::size_t>(role)
            ].size)) {
            return DebugSelectionStatus::invalid;
        }
    }

    candidate.presentation = ui::findTitleOverlayPresentation(
        input.overlayPresentations,
        overlay->sequence
    );
    if (candidate.presentation == nullptr
        || !presentationIsValid(*overlay, *candidate.presentation)) {
        return DebugSelectionStatus::invalid;
    }

    candidate.capacity.shapeCount = 1U;
    candidate.capacity.uiCount = 7U;
    candidate.capacity.overlayCount = 5U;
    candidate.capacity.clipCount = 2U;
    candidate.capacity.passCount = input.disableTransparency ? 0U : 4U;
    for (const UiTextSemanticId semantic : debug_text_semantics) {
        if (!addGlyphCapacity(candidate.capacity, input, semantic)) {
            return DebugSelectionStatus::invalid;
        }
    }
    candidate.capacity.commandCount = candidate.capacity.shapeCount
        + candidate.capacity.uiCount
        + candidate.capacity.overlayCount
        + candidate.capacity.glyphRunCount
        + candidate.capacity.clipCount
        + candidate.capacity.passCount;
    out = candidate;
    return DebugSelectionStatus::valid;
}

[[nodiscard]] bool addDimSession(
    FramePacketBuilder& builder,
    const GlobalDebugOverlayInput& input,
    const ResolvedDebugOverlay& resolved,
    const RectF dimBounds,
    std::uint32_t& anchorSequence
) {
    const ui::OverlaySnapshot& overlay = *resolved.overlay;
    OverlayCommand begin{};
    begin.header = makeHeader(resolved.orders.dim);
    begin.operation = OverlayOperation::beginSession;
    begin.sessionId = instanceId(overlay_dim_session_id, overlay.sequence);
    if (!builder.addOverlay(begin)) {
        return false;
    }

    OverlayCommand dim = begin;
    dim.operation = OverlayOperation::dim;
    dim.sourceLayers = backdrop_source_layers;
    dim.sourceRevision = input.backdropRevision;
    dim.sourceBounds = dimBounds;
    dim.destinationBounds = dim.sourceBounds;
    dim.opacity = static_cast<float>(clampUnit(debug_dim * overlay.dimAlpha));
    dim.tintColor = PremultipliedRgba::opaque(0.0F, 0.0F, 0.0F);
    if (!builder.addOverlay(dim)) {
        return false;
    }

    OverlayCommand end = begin;
    end.operation = OverlayOperation::endSession;
    anchorSequence = builder.nextSequence();
    return builder.addOverlay(end);
}

[[nodiscard]] bool addGlassPass(
    FramePacketBuilder& builder,
    const GlobalDebugOverlayInput& input,
    const ResolvedDebugOverlay& resolved,
    const std::uint32_t anchorSequence
) {
    const ui::OverlaySnapshot& overlay = *resolved.overlay;
    PassCommand pass{};
    pass.header = makeHeader(resolved.orders.effect);
    pass.sessionId = instanceId(overlay_effect_session_id, overlay.sequence);
    pass.destinationId = instanceId(
        overlay_effect_destination_id,
        overlay.sequence
    );
    pass.sourceRevision = input.backdropRevision;
    pass.sourceAnchorLayer = RenderLayer::dynamicOverlay;
    pass.sourceAnchorLayerOrder = resolved.orders.dim;
    pass.sourceAnchorSequence = anchorSequence;
    pass.sourceBounds = renderRect(resolved.presentation->panelRect);
    pass.destinationBounds = pass.sourceBounds;
    pass.opacity = static_cast<float>(clampUnit(overlay.alpha));
    pass.contentBlurRadius = finiteFloat(overlay.contentBlur);
    pass.glassBlurRadius = 18.0F;
    pass.refractionStrength = 0.015F;
    pass.edgeStrength = finiteFloat(input.theme.overlayGlassEdgeStrength);
    pass.tintColor = renderColor(
        input.theme.overlayGlassTint,
        input.theme.overlayGlassTintStrength * overlay.alpha
    );
    pass.edgeColor = renderColor(input.theme.overlayGlassEdge, overlay.alpha);
    pass.shadowColor = renderColor(input.theme.overlayPanelShadow, overlay.alpha);

    pass.operation = PassOperation::beginSession;
    if (!builder.addPass(pass)) {
        return false;
    }
    pass.operation = PassOperation::capture;
    if (!builder.addPass(pass)) {
        return false;
    }
    pass.operation = PassOperation::composite;
    if (!builder.addPass(pass)) {
        return false;
    }
    pass.operation = PassOperation::endSession;
    return builder.addPass(pass);
}

[[nodiscard]] bool addUiSession(
    FramePacketBuilder& builder,
    const GlobalDebugOverlayInput& input,
    const ResolvedDebugOverlay& resolved
) {
    const ui::OverlaySnapshot& overlay = *resolved.overlay;
    OverlayCommand begin{};
    begin.header = makeHeader(resolved.orders.ui);
    begin.operation = OverlayOperation::beginSession;
    begin.sessionId = instanceId(overlay_ui_session_id, overlay.sequence);
    if (!builder.addOverlay(begin)) {
        return false;
    }

    ClipCommand clip{};
    clip.header = begin.header;
    clip.operation = ClipOperation::pushRoundedRect;
    clip.antialias = 1U;
    clip.bounds = renderRect(resolved.presentation->panelRect);
    clip.cornerRadius = finiteFloat(resolved.presentation->panelRect.radius);
    if (!builder.addClip(clip)
        || !addTitleOverlayPresentation(
            builder,
            {
                *resolved.presentation,
                overlay,
                input.interaction,
                input.layout,
                input.theme,
                input.textResources,
                input.locale,
                begin.header,
                input.disableTransparency
            })) {
        return false;
    }

    ClipCommand pop = clip;
    pop.operation = ClipOperation::pop;
    if (!builder.addClip(pop)) {
        return false;
    }

    OverlayCommand end = begin;
    end.operation = OverlayOperation::endSession;
    return builder.addOverlay(end);
}

} // namespace

FramePacketCapacity globalDebugOverlayCapacity(
    const GlobalDebugOverlayInput& input
) noexcept {
    ResolvedDebugOverlay resolved{};
    return resolveDebugOverlay(input, resolved) == DebugSelectionStatus::valid
        ? resolved.capacity
        : FramePacketCapacity{};
}

bool addGlobalDebugOverlay(
    FramePacketBuilder& builder,
    const GlobalDebugOverlayInput& input
) {
    ResolvedDebugOverlay resolved{};
    const DebugSelectionStatus status = resolveDebugOverlay(input, resolved);
    if (status == DebugSelectionStatus::none) {
        return true;
    }
    if (status != DebugSelectionStatus::valid || !builder.isBuilding()) {
        return false;
    }
    const ViewportState* const viewport = builder.activeViewport();
    RectF dimBounds{};
    if (viewport == nullptr
        || !tryResolveFullDrawableLogicalBounds(*viewport, dimBounds)) {
        return false;
    }

    std::uint32_t anchorSequence = 0U;
    return addDimSession(builder, input, resolved, dimBounds, anchorSequence)
        && (input.disableTransparency
            || addGlassPass(builder, input, resolved, anchorSequence))
        && addUiSession(builder, input, resolved);
}

} // namespace cirvivor::render::frontend
