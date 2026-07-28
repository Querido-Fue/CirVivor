#include "render/frontend/title_scene.h"

#include "render/frontend/title_overlay_presenter.h"
#include "render/text/title_text_catalog.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string_view>

namespace cirvivor::render::frontend {

namespace {

constexpr std::size_t base_title_shape_count = 3U;
constexpr std::size_t base_title_ui_count = 15U;
constexpr std::size_t base_title_gradient_count = 1U;
constexpr std::size_t base_title_clip_count = 4U;
constexpr std::size_t base_title_command_count = base_title_shape_count
    + base_title_ui_count
    + base_title_gradient_count
    + base_title_clip_count;
constexpr std::size_t dim_session_command_count = 3U;
constexpr std::size_t glass_pass_command_count = 4U;
constexpr std::size_t shell_overlay_command_count = 2U;
constexpr std::size_t shell_clip_command_count = 2U;
constexpr std::size_t map_select_shell_ui_count = 3U;
constexpr std::size_t exit_shell_ui_count = 3U;
constexpr std::size_t external_shell_ui_count = 4U;
constexpr std::size_t placeholder_geometry_count = 7U;
constexpr std::size_t version_history_link_ui_count = 1U;
constexpr std::size_t version_history_link_line_count = 3U;
constexpr std::size_t version_history_link_command_count =
    version_history_link_ui_count + version_history_link_line_count;
constexpr ui::layout::ThemeColor title_letterbox_clear_color{
    0x20U,
    0x20U,
    0x20U,
    1.0
};

constexpr RenderLayerMask backdrop_source_layers = static_cast<RenderLayerMask>(
    renderLayerMask(RenderLayer::background)
    | renderLayerMask(RenderLayer::object)
    | renderLayerMask(RenderLayer::effect)
    | renderLayerMask(RenderLayer::textEffect)
    | renderLayerMask(RenderLayer::ui)
    | renderLayerMask(RenderLayer::vignette)
);

constexpr StableElementId card_pane_id = stableResourceId("title.shell.card-pane");
constexpr StableElementId utility_pane_id = stableResourceId("title.shell.utility-pane");
constexpr StableElementId card_id_base = stableResourceId("title.shell.card");
constexpr StableElementId utility_id_base = stableResourceId("title.shell.utility");
constexpr StableElementId utility_icon_id_base = stableResourceId("title.shell.utility-icon");
constexpr StableElementId version_history_link_id = stableResourceId(
    "title.shell.version-history-link"
);
constexpr StableElementId overlay_dim_session_id = stableResourceId("title.overlay.dim");
constexpr StableElementId overlay_effect_session_id = stableResourceId("title.overlay.effect");
constexpr StableElementId overlay_effect_destination_id = stableResourceId(
    "title.overlay.effect.destination"
);
constexpr StableElementId overlay_ui_session_id = stableResourceId("title.overlay.ui");
constexpr StableElementId overlay_panel_id = stableResourceId("title.overlay.panel");
constexpr StableElementId overlay_cancel_id = stableResourceId("title.overlay.cancel");
constexpr StableElementId overlay_confirm_id = stableResourceId("title.overlay.confirm");
constexpr StableElementId overlay_link_id = stableResourceId("title.overlay.link");

enum class TextHorizontalAnchor : std::uint8_t {
    left,
    center,
    right
};

enum class TextVerticalAnchor : std::uint8_t {
    top,
    middle
};

[[nodiscard]] CommandHeader makeHeader(
    const RenderLayer layer,
    const std::int32_t layerOrder,
    const CoordinateSpace coordinateSpace = CoordinateSpace::logicalUi,
    const BlendMode blendMode = BlendMode::premultipliedAlpha
) noexcept {
    return {layer, coordinateSpace, blendMode, 0U, layerOrder, 0U};
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
    const float alpha = static_cast<float>(clampUnit(color.alpha * alphaScale));
    constexpr float byteScale = 1.0F / 255.0F;
    return PremultipliedRgba::fromStraight(
        static_cast<float>(color.red) * byteScale,
        static_cast<float>(color.green) * byteScale,
        static_cast<float>(color.blue) * byteScale,
        alpha
    );
}

[[nodiscard]] bool hasTextResources(const TitleSceneInput& input) noexcept {
    return input.textResources.isValid();
}

[[nodiscard]] const PreShapedTextRunView* textRunFor(
    const TitleSceneInput& input,
    const UiTextSemanticId semantic
) noexcept {
    return input.textResources.find(text::titleTextKey(semantic, input.locale));
}

[[nodiscard]] float typographySize(
    const TitleSceneInput& input,
    const ui::layout::TypographyRole role
) noexcept {
    return finiteFloat(input.layout.typography[static_cast<std::size_t>(role)].size);
}

[[nodiscard]] bool addShapedText(
    FramePacketBuilder& builder,
    const TitleSceneInput& input,
    const UiTextSemanticId semantic,
    const float targetLogicalPixelSize,
    const CommandHeader header,
    const Vec2F anchor,
    const TextHorizontalAnchor horizontal,
    const TextVerticalAnchor vertical,
    const PremultipliedRgba color
) {
    const PreShapedTextRunView* const run = textRunFor(input, semantic);
    if (run == nullptr || !std::isfinite(targetLogicalPixelSize)
        || !(targetLogicalPixelSize > 0.0F) || run->rasterPixelSize == 0U) {
        return false;
    }
    const float scale = targetLogicalPixelSize
        / static_cast<float>(run->rasterPixelSize);
    Vec2F origin = anchor;
    if (horizontal == TextHorizontalAnchor::center) {
        origin.x -= run->advance * scale * 0.5F;
    } else if (horizontal == TextHorizontalAnchor::right) {
        origin.x -= run->advance * scale;
    }
    if (vertical == TextVerticalAnchor::top) {
        origin.y += run->ascent * scale;
    } else {
        origin.y += (run->ascent - run->descent) * scale * 0.5F;
    }

    GlyphRunCommand command{};
    command.header = header;
    command.fontId = run->fontId;
    command.glyphAtlasId = run->glyphAtlasId;
    command.origin = origin;
    command.pixelsPerEm = targetLogicalPixelSize;
    command.weight = run->key.weight;
    command.color = color;
    command.transform.elements = {
        scale, 0.0F, origin.x * (1.0F - scale),
        0.0F, scale, origin.y * (1.0F - scale),
        0.0F, 0.0F, 1.0F
    };
    command.sampling = SamplingMode::linear;
    return builder.addGlyphRun(command, run->glyphs);
}

[[nodiscard]] constexpr UiTextSemanticId cardTitleSemantic(
    const ui::layout::TitleCardSlot slot
) noexcept {
    switch (slot) {
    case ui::layout::TitleCardSlot::start:
        return UiTextSemanticId::titleCardStart;
    case ui::layout::TitleCardSlot::quickStart:
        return UiTextSemanticId::titleCardQuickStart;
    case ui::layout::TitleCardSlot::records:
        return UiTextSemanticId::titleCardRecords;
    case ui::layout::TitleCardSlot::deck:
        return UiTextSemanticId::titleCardDeck;
    case ui::layout::TitleCardSlot::research:
        return UiTextSemanticId::titleCardResearch;
    }
    return UiTextSemanticId::titleCardStart;
}

[[nodiscard]] bool cardDescriptionSemantic(
    const ui::layout::TitleCardSlot slot,
    UiTextSemanticId& semantic
) noexcept {
    switch (slot) {
    case ui::layout::TitleCardSlot::quickStart:
        semantic = UiTextSemanticId::titleCardQuickStartDescription;
        return true;
    case ui::layout::TitleCardSlot::deck:
        semantic = UiTextSemanticId::titleCardDeckDescription;
        return true;
    case ui::layout::TitleCardSlot::research:
        semantic = UiTextSemanticId::titleCardResearchDescription;
        return true;
    case ui::layout::TitleCardSlot::start:
    case ui::layout::TitleCardSlot::records:
        return false;
    }
    return false;
}

[[nodiscard]] bool hasRequiredTextRuns(const TitleSceneInput& input) noexcept {
    if (!hasTextResources(input)) {
        return false;
    }
    for (const text::TitleTextCatalogEntry& entry : text::title_text_catalog) {
        if (textRunFor(input, entry.semantic) == nullptr) {
            return false;
        }
    }
    return input.uiState.overlayCount <= input.uiState.overlays.size();
}

[[nodiscard]] RectF renderRect(const ui::layout::RoundedRectD rect) noexcept {
    return {
        finiteFloat(rect.x),
        finiteFloat(rect.y),
        finiteFloat(rect.width),
        finiteFloat(rect.height)
    };
}

[[nodiscard]] double interpolate(
    const double start,
    const double end,
    const double progress
) noexcept {
    return start + (end - start) * progress;
}

[[nodiscard]] ui::layout::RoundedRectD interpolateRect(
    const ui::layout::RoundedRectD start,
    const ui::layout::RoundedRectD end,
    const double progress
) noexcept {
    return {
        interpolate(start.x, end.x, progress),
        interpolate(start.y, end.y, progress),
        interpolate(start.width, end.width, progress),
        interpolate(start.height, end.height, progress),
        interpolate(start.radius, end.radius, progress)
    };
}

[[nodiscard]] RectF fullLogicalBounds(
    const ui::layout::UiLayoutSnapshot& layout
) noexcept {
    return {
        0.0F,
        0.0F,
        finiteFloat(layout.viewport.ww),
        finiteFloat(layout.viewport.wh)
    };
}

[[nodiscard]] StableElementId instanceId(
    const StableElementId base,
    const std::uint32_t sequence,
    const std::uint32_t ordinal = 0U
) noexcept {
    StableElementId value = base
        ^ (static_cast<StableElementId>(sequence) * 0x9e37'79b9'7f4a'7c15ULL)
        ^ (static_cast<StableElementId>(ordinal) * 0xbf58'476d'1ce4'e5b9ULL);
    if (value == 0U) {
        value = base == 0U ? 1U : base;
    }
    return value;
}

[[nodiscard]] std::int32_t positiveDimension(const std::int32_t value) noexcept {
    return std::max(value, 1);
}

[[nodiscard]] float positiveFiniteOr(
    const float value,
    const float fallback,
    const float maximum
) noexcept {
    return std::isfinite(value) && value > 0.0F
        ? std::min(value, maximum)
        : fallback;
}

[[nodiscard]] std::int32_t insetInsideContent(
    const std::int32_t outerInset,
    const std::int32_t letterboxInset,
    const std::int32_t maximum
) noexcept {
    const std::int64_t inset = static_cast<std::int64_t>(outerInset)
        - static_cast<std::int64_t>(letterboxInset);
    return static_cast<std::int32_t>(std::clamp<std::int64_t>(inset, 0, maximum));
}

[[nodiscard]] InsetsI mapSafeAreaToContent(
    const InsetsI outerSafeArea,
    const SizeI drawableSize,
    const RectI contentRect
) noexcept {
    const std::int32_t rightLetterbox = drawableSize.width
        - contentRect.x - contentRect.width;
    const std::int32_t bottomLetterbox = drawableSize.height
        - contentRect.y - contentRect.height;
    InsetsI result{};
    result.left = insetInsideContent(
        outerSafeArea.left,
        contentRect.x,
        contentRect.width
    );
    result.right = insetInsideContent(
        outerSafeArea.right,
        rightLetterbox,
        contentRect.width - result.left
    );
    result.top = insetInsideContent(
        outerSafeArea.top,
        contentRect.y,
        contentRect.height
    );
    result.bottom = insetInsideContent(
        outerSafeArea.bottom,
        bottomLetterbox,
        contentRect.height - result.top
    );
    return result;
}

[[nodiscard]] TitleSceneMissingCapability missingCapabilityFor(
    const ui::OverlayKind kind
) noexcept {
    switch (kind) {
    case ui::OverlayKind::mapSelect:
        return TitleSceneMissingCapability::mapSelectContent;
    case ui::OverlayKind::deck:
        return TitleSceneMissingCapability::deckContent;
    case ui::OverlayKind::setting:
        return TitleSceneMissingCapability::settingContent;
    case ui::OverlayKind::credits:
        return TitleSceneMissingCapability::creditsContent;
    case ui::OverlayKind::quickStart:
        return TitleSceneMissingCapability::quickStartContent;
    case ui::OverlayKind::records:
        return TitleSceneMissingCapability::recordsContent;
    case ui::OverlayKind::research:
        return TitleSceneMissingCapability::researchContent;
    case ui::OverlayKind::achievements:
        return TitleSceneMissingCapability::achievementsContent;
    case ui::OverlayKind::debug:
        return TitleSceneMissingCapability::debugOverlayShell;
    case ui::OverlayKind::exitConfirm:
    case ui::OverlayKind::externalLinkWarning:
        return TitleSceneMissingCapability::none;
    case ui::OverlayKind::none:
        return TitleSceneMissingCapability::unsupportedOverlay;
    }
    return TitleSceneMissingCapability::unsupportedOverlay;
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

[[nodiscard]] bool hasValidInteractionTargetTable(
    const ui::TitleUiControllerSnapshot& interaction
) noexcept {
    for (std::size_t index = 0U; index < interaction.targets.size(); ++index) {
        const ui::TitleUiTarget target = interaction.targets[index].target;
        if (!isTitleUiTarget(target)) {
            return false;
        }
        for (std::size_t previous = 0U; previous < index; ++previous) {
            if (interaction.targets[previous].target == target) {
                return false;
            }
        }
    }
    return true;
}

[[nodiscard]] const ui::TitleUiTargetInteraction& interactionFor(
    const ui::TitleUiControllerSnapshot& interaction,
    const ui::TitleUiTarget target
) noexcept {
    for (const ui::TitleUiTargetInteraction& candidate : interaction.targets) {
        if (candidate.target == target) {
            return candidate;
        }
    }
    return interaction.targets.front();
}

[[nodiscard]] constexpr ui::TitleUiTarget targetFor(
    const ui::layout::TitleCardSlot slot
) noexcept {
    switch (slot) {
    case ui::layout::TitleCardSlot::start:
        return ui::TitleUiTarget::cardStart;
    case ui::layout::TitleCardSlot::quickStart:
        return ui::TitleUiTarget::cardQuickStart;
    case ui::layout::TitleCardSlot::records:
        return ui::TitleUiTarget::cardRecords;
    case ui::layout::TitleCardSlot::deck:
        return ui::TitleUiTarget::cardDeck;
    case ui::layout::TitleCardSlot::research:
        return ui::TitleUiTarget::cardResearch;
    }
    return ui::TitleUiTarget::none;
}

[[nodiscard]] constexpr ui::TitleUiTarget targetFor(
    const ui::layout::UtilityTileSlot slot
) noexcept {
    switch (slot) {
    case ui::layout::UtilityTileSlot::setting:
        return ui::TitleUiTarget::utilitySetting;
    case ui::layout::UtilityTileSlot::credits:
        return ui::TitleUiTarget::utilityCredits;
    case ui::layout::UtilityTileSlot::achievements:
        return ui::TitleUiTarget::utilityAchievements;
    case ui::layout::UtilityTileSlot::exit:
        return ui::TitleUiTarget::utilityExit;
    }
    return ui::TitleUiTarget::none;
}

[[nodiscard]] std::uint16_t stateFlagsFor(
    const ui::TitleUiTargetInteraction& interaction
) noexcept {
    std::uint16_t result = uiStateBits(UiStateFlag::none);
    if (interaction.hovered) {
        result |= uiStateBits(UiStateFlag::hovered);
    }
    if (interaction.pressed) {
        result |= uiStateBits(UiStateFlag::pressed);
    }
    return result;
}

[[nodiscard]] ui::layout::ThemeColor shellBackgroundFor(
    const ui::layout::ThemeMetrics& theme,
    const ui::TitleUiTargetInteraction& interaction
) noexcept {
    if (interaction.pressed) {
        return theme.titleButtonHover[1U].color;
    }
    if (interaction.hovered) {
        return theme.titleButtonHover[0U].color;
    }
    return theme.titleButtonNormal;
}

[[nodiscard]] bool hasVersionHistoryLink(
    const TitleSceneInput& input
) noexcept {
    return input.layout.title.versionHistoryLink.available
        && input.entrance.versionHistoryLink.available;
}

[[nodiscard]] TitleSceneMissingCapabilities missingCapabilitiesFor(
    const TitleSceneInput& input
) noexcept {
    TitleSceneMissingCapabilities result = hasRequiredTextRuns(input)
        ? 0U
        : titleSceneCapabilityBit(
              TitleSceneMissingCapability::preShapedTextResources
          );
    const std::size_t overlayCount = std::min<std::size_t>(
        input.uiState.overlayCount,
        input.uiState.overlays.size()
    );
    const bool fullOverlayContent = hasRequiredTextRuns(input);
    for (std::size_t index = 0U; index < overlayCount; ++index) {
        if (!fullOverlayContent) {
            result |= titleSceneCapabilityBit(
                missingCapabilityFor(input.uiState.overlays[index].kind)
            );
        }
        if (input.uiState.overlays[index].kind
                == ui::OverlayKind::externalLinkWarning) {
            UiTextSemanticId ignored{};
            if (!text::titleExternalUrlSemantic(
                    input.uiState.overlays[index].externalUrl.view(),
                    ignored
                )) {
                result |= titleSceneCapabilityBit(
                    TitleSceneMissingCapability::preShapedTextResources
                );
            }
        }
    }
    return result;
}

[[nodiscard]] TitleSceneCommandStats commandStatsFor(
    const TitleSceneInput& input,
    const FramePacketCapacity capacity
) noexcept {
    TitleSceneCommandStats result{};
    result.totalCommands = capacity.commandCount;
    const std::size_t versionLinkCount = hasVersionHistoryLink(input)
        ? version_history_link_command_count
        : 0U;
    result.titleShellCommands = base_title_command_count + versionLinkCount;
    result.placeholderGeometryCommands = placeholder_geometry_count;
    result.shapedTextCommands = capacity.glyphRunCount;
    result.resourceBackedCommands = capacity.glyphRunCount;
    const std::size_t overlayCount = std::min<std::size_t>(
        input.uiState.overlayCount,
        input.uiState.overlays.size()
    );
    result.overlayDimCommands = overlayCount * dim_session_command_count;
    const std::size_t glassPassCommands = input.disableTransparency
        ? 0U
        : glass_pass_command_count;
    if (hasRequiredTextRuns(input)) {
        result.titleOverlayContentCommands = capacity.commandCount
            - result.titleShellCommands
            - result.overlayDimCommands;
    }
    for (std::size_t index = 0U; index < overlayCount; ++index) {
        const ui::OverlayKind kind = input.uiState.overlays[index].kind;
        if (kind == ui::OverlayKind::mapSelect) {
            result.overlayPassCommands += glassPassCommands;
            result.mapSelectShellCommands += glassPassCommands
                + shell_overlay_command_count
                + shell_clip_command_count
                + map_select_shell_ui_count;
        } else if (kind == ui::OverlayKind::exitConfirm) {
            result.overlayPassCommands += glassPassCommands;
            result.exitShellCommands += glassPassCommands
                + shell_overlay_command_count
                + shell_clip_command_count
                + exit_shell_ui_count;
        } else if (kind == ui::OverlayKind::externalLinkWarning) {
            result.overlayPassCommands += glassPassCommands;
            result.externalLinkShellCommands += glassPassCommands
                + shell_overlay_command_count
                + shell_clip_command_count
                + external_shell_ui_count;
        }
    }
    return result;
}

[[nodiscard]] bool inputCanBuild(const TitleSceneInput& input) noexcept {
    if (input.uiState.overlayCount > input.uiState.overlays.size()
        || !hasValidInteractionTargetTable(input.interaction)
        || input.layout.title.versionHistoryLink.available
            != input.entrance.versionHistoryLink.available
        || !std::isfinite(input.layout.viewport.ww)
        || !std::isfinite(input.layout.viewport.wh)
        || input.layout.viewport.ww <= 0.0
        || input.layout.viewport.wh <= 0.0
        || !std::isfinite(input.uiState.title.elapsedSeconds)
        || input.uiState.title.elapsedSeconds < 0.0) {
        return false;
    }
    if (hasTextResources(input) && !hasRequiredTextRuns(input)) {
        return false;
    }
    if (input.overlayPresentations != nullptr
        && (input.overlayPresentations->stateRevision != input.uiState.revision
            || input.overlayPresentations->layoutRevision != input.layout.revision
            || input.overlayPresentations->overlayCount
                != input.uiState.overlayCount)) {
        return false;
    }
    const std::size_t overlayCount = std::min<std::size_t>(
        input.uiState.overlayCount,
        input.uiState.overlays.size()
    );
    for (std::size_t index = 0U; index < overlayCount; ++index) {
        OverlaySurfaceLayerOrders orders{};
        if (!tryResolveOverlaySurfaceLayerOrders(
                input.uiState.overlays[index],
                orders
            )) {
            return false;
        }
        if (input.overlayPresentations != nullptr) {
            const ui::TitleOverlayPresentation* const presentation =
                ui::findTitleOverlayPresentation(
                    *input.overlayPresentations,
                    input.uiState.overlays[index].sequence
                );
            if (presentation == nullptr
                || presentation->kind != input.uiState.overlays[index].kind) {
                return false;
            }
        }
    }
    return true;
}

void addTextCapacity(
    FramePacketCapacity& capacity,
    const TitleSceneInput& input,
    const UiTextSemanticId semantic
) noexcept {
    const PreShapedTextRunView* const run = textRunFor(input, semantic);
    if (run == nullptr) {
        return;
    }
    ++capacity.glyphRunCount;
    capacity.glyphInstanceCount += run->glyphs.size();
}

void addTitleTextCapacity(
    FramePacketCapacity& capacity,
    const TitleSceneInput& input
) noexcept {
    if (!hasTextResources(input)) {
        return;
    }
    for (const ui::layout::TitleCardRenderMetrics& card : input.entrance.cards) {
        addTextCapacity(capacity, input, cardTitleSemantic(card.slot));
        UiTextSemanticId description{};
        if (cardDescriptionSemantic(card.slot, description)) {
            addTextCapacity(capacity, input, description);
        }
    }
    if (hasVersionHistoryLink(input)) {
        addTextCapacity(capacity, input, UiTextSemanticId::versionLabel);
        addTextCapacity(capacity, input, UiTextSemanticId::versionHistoryLink);
    }
    const std::size_t overlayCount = std::min<std::size_t>(
        input.uiState.overlayCount,
        input.uiState.overlays.size()
    );
    for (std::size_t index = 0U; index < overlayCount; ++index) {
        const ui::OverlaySnapshot& overlay = input.uiState.overlays[index];
        switch (overlay.kind) {
        case ui::OverlayKind::mapSelect:
            addTextCapacity(capacity, input, UiTextSemanticId::mapSelectTitle);
            addTextCapacity(capacity, input, UiTextSemanticId::mapName);
            addTextCapacity(capacity, input, UiTextSemanticId::mapSelected);
            addTextCapacity(capacity, input, UiTextSemanticId::mapDescription);
            addTextCapacity(capacity, input, UiTextSemanticId::mapCancel);
            addTextCapacity(capacity, input, UiTextSemanticId::mapStart);
            break;
        case ui::OverlayKind::exitConfirm:
            addTextCapacity(capacity, input, UiTextSemanticId::exitTitle);
            addTextCapacity(capacity, input, UiTextSemanticId::exitBody);
            addTextCapacity(capacity, input, UiTextSemanticId::exitNo);
            addTextCapacity(capacity, input, UiTextSemanticId::exitYes);
            break;
        case ui::OverlayKind::externalLinkWarning: {
            addTextCapacity(capacity, input, UiTextSemanticId::externalTitle);
            addTextCapacity(capacity, input, UiTextSemanticId::externalBody);
            addTextCapacity(capacity, input, UiTextSemanticId::externalNo);
            addTextCapacity(capacity, input, UiTextSemanticId::externalYes);
            UiTextSemanticId urlSemantic{};
            if (text::titleExternalUrlSemantic(
                    overlay.externalUrl.view(),
                    urlSemantic
                )) {
                addTextCapacity(capacity, input, urlSemantic);
            }
            break;
        }
        case ui::OverlayKind::deck:
            addTextCapacity(capacity, input, UiTextSemanticId::deckTitle);
            addTextCapacity(capacity, input, UiTextSemanticId::deckAchievements);
            addTextCapacity(capacity, input, UiTextSemanticId::deckZeroPercent);
            addTextCapacity(capacity, input, UiTextSemanticId::deckEncyclopedia);
            addTextCapacity(capacity, input, UiTextSemanticId::deckZeroPercent);
            addTextCapacity(capacity, input, UiTextSemanticId::overlayClose);
            break;
        case ui::OverlayKind::quickStart:
            addTextCapacity(capacity, input, UiTextSemanticId::quickStartTitle);
            addTextCapacity(capacity, input, UiTextSemanticId::comingSoon);
            addTextCapacity(capacity, input, UiTextSemanticId::quickStartBody);
            addTextCapacity(capacity, input, UiTextSemanticId::overlayClose);
            break;
        case ui::OverlayKind::records:
            addTextCapacity(capacity, input, UiTextSemanticId::recordsTitle);
            addTextCapacity(capacity, input, UiTextSemanticId::comingSoon);
            addTextCapacity(capacity, input, UiTextSemanticId::recordsBody);
            addTextCapacity(capacity, input, UiTextSemanticId::overlayClose);
            break;
        case ui::OverlayKind::research:
            addTextCapacity(capacity, input, UiTextSemanticId::researchTitle);
            addTextCapacity(capacity, input, UiTextSemanticId::comingSoon);
            addTextCapacity(capacity, input, UiTextSemanticId::researchBody);
            addTextCapacity(capacity, input, UiTextSemanticId::overlayClose);
            break;
        case ui::OverlayKind::achievements:
            addTextCapacity(capacity, input, UiTextSemanticId::achievementsTitle);
            addTextCapacity(capacity, input, UiTextSemanticId::comingSoon);
            addTextCapacity(capacity, input, UiTextSemanticId::achievementsBody);
            addTextCapacity(capacity, input, UiTextSemanticId::overlayClose);
            break;
        case ui::OverlayKind::setting:
            for (const UiTextSemanticId semantic : std::array{
                    UiTextSemanticId::settingsTitle,
                    UiTextSemanticId::settingsDisplaySection,
                    UiTextSemanticId::settingsUiSection,
                    UiTextSemanticId::settingWindowMode,
                    UiTextSemanticId::settingUltrawide,
                    UiTextSemanticId::settingRenderScale,
                    UiTextSemanticId::settingUiScale,
                    UiTextSemanticId::settingOpaqueUi,
                    UiTextSemanticId::settingBenchmark,
                    UiTextSemanticId::settingLanguage,
                    UiTextSemanticId::settingTheme,
                    UiTextSemanticId::settingTooltipDelay,
                    UiTextSemanticId::settingBgm,
                    UiTextSemanticId::settingSfx,
                    UiTextSemanticId::settingKeybindings,
                    UiTextSemanticId::settingUltrawideDescription,
                    UiTextSemanticId::settingRenderScaleDescription,
                    UiTextSemanticId::settingUiScaleDescription,
                    UiTextSemanticId::settingOpaqueUiDescription,
                    UiTextSemanticId::settingTooltipDelayDescription,
                    UiTextSemanticId::settingsSoundSection,
                    UiTextSemanticId::settingsControlsSection,
                    UiTextSemanticId::settingsCancel,
                    UiTextSemanticId::settingsSave
                }) {
                addTextCapacity(capacity, input, semantic);
            }
            break;
        case ui::OverlayKind::credits:
            for (const UiTextSemanticId semantic : std::array{
                    UiTextSemanticId::creditsTitle,
                    UiTextSemanticId::creditsMadeBy,
                    UiTextSemanticId::creditsBlog,
                    UiTextSemanticId::creditsCirvivor,
                    UiTextSemanticId::creditsAssets,
                    UiTextSemanticId::creditsPretendard,
                    UiTextSemanticId::creditsOutfit,
                    UiTextSemanticId::creditsReactBits,
                    UiTextSemanticId::overlayClose
                }) {
                addTextCapacity(capacity, input, semantic);
            }
            break;
        case ui::OverlayKind::debug:
            for (const UiTextSemanticId semantic : std::array{
                    UiTextSemanticId::debugTitle,
                    UiTextSemanticId::debugFrameTime,
                    UiTextSemanticId::debugPoolInfo,
                    UiTextSemanticId::debugHitboxes,
                    UiTextSemanticId::debugAnimation,
                    UiTextSemanticId::debugHint,
                    UiTextSemanticId::debugDevTools,
                    UiTextSemanticId::debugClose
                }) {
                addTextCapacity(capacity, input, semantic);
            }
            break;
        case ui::OverlayKind::none:
            break;
        }
    }
}

[[nodiscard]] bool addCardText(
    FramePacketBuilder& builder,
    const TitleSceneInput& input,
    const ui::layout::TitleCardRenderMetrics& card,
    const CommandHeader header
) {
    const double uiScale = std::isfinite(input.layout.viewport.uiScale)
            && input.layout.viewport.uiScale > 0.0
        ? input.layout.viewport.uiScale
        : 1.0;
    const double inset = std::max(16.0 * uiScale, card.panelRect.width * 0.08);
    const bool compact = card.slot == ui::layout::TitleCardSlot::records;
    double titleX = card.panelRect.x + inset;
    double titleY = 0.0;
    if (compact) {
        const double iconSize = std::max(20.0, card.panelRect.width * 0.14);
        titleX += iconSize + std::max(14.0 * uiScale, card.panelRect.width * 0.06);
        titleY = card.panelRect.y
            + (card.panelRect.height - card.titleTypography.lineHeight) * 0.5;
    } else {
        const double bottomPadding = inset * 0.8;
        const double descriptionY = card.panelRect.y + card.panelRect.height
            - bottomPadding - card.descriptionTypography.lineHeight;
        titleY = card.hasDescription
            ? descriptionY
                - card.descriptionTypography.lineHeight * 0.4928
                - card.titleTypography.lineHeight
            : card.panelRect.y + card.panelRect.height
                - bottomPadding - card.titleTypography.lineHeight;
    }
    if (!addShapedText(
            builder,
            input,
            cardTitleSemantic(card.slot),
            finiteFloat(card.titleTypography.size),
            header,
            {finiteFloat(titleX), finiteFloat(titleY)},
            TextHorizontalAnchor::left,
            TextVerticalAnchor::top,
            renderColor(input.theme.titleButtonText, card.alpha)
        )) {
        return false;
    }

    UiTextSemanticId description{};
    if (!cardDescriptionSemantic(card.slot, description)) {
        return true;
    }
    const double descriptionY = card.panelRect.y + card.panelRect.height
        - inset * 0.8 - card.descriptionTypography.lineHeight;
    return addShapedText(
        builder,
        input,
        description,
        finiteFloat(card.descriptionTypography.size),
        header,
        {finiteFloat(card.panelRect.x + inset), finiteFloat(descriptionY)},
        TextHorizontalAnchor::left,
        TextVerticalAnchor::top,
        renderColor(input.theme.overlayItemText, card.alpha)
    );
}

[[nodiscard]] bool addVersionText(
    FramePacketBuilder& builder,
    const TitleSceneInput& input,
    const CommandHeader header
) {
    if (!hasVersionHistoryLink(input)) {
        return true;
    }
    const ui::layout::TitleVersionHistoryLinkRenderMetrics& metrics =
        input.entrance.versionHistoryLink;
    const ui::TitleUiTargetInteraction& interaction = interactionFor(
        input.interaction,
        ui::TitleUiTarget::versionHistoryLink
    );
    if (!addShapedText(
            builder,
            input,
            UiTextSemanticId::versionLabel,
            typographySize(input, ui::layout::TypographyRole::h5),
            header,
            {
                finiteFloat(metrics.textAnchor.x),
                finiteFloat(input.layout.title.versionLabelTop)
            },
            TextHorizontalAnchor::right,
            TextVerticalAnchor::top,
            renderColor(input.theme.menuForeground, 0.62 * metrics.alpha)
        )) {
        return false;
    }
    return addShapedText(
        builder,
        input,
        UiTextSemanticId::versionHistoryLink,
        typographySize(input, ui::layout::TypographyRole::label),
        header,
        {finiteFloat(metrics.textAnchor.x), finiteFloat(metrics.textAnchor.y)},
        TextHorizontalAnchor::right,
        TextVerticalAnchor::top,
        renderColor(
            input.theme.menuForeground,
            (interaction.hovered ? 1.0 : 0.72) * metrics.alpha
        )
    );
}

[[nodiscard]] bool addBaseTitleShell(
    FramePacketBuilder& builder,
    const TitleSceneInput& input
) {
    std::array<GradientStop, ui::layout::title_gradient_color_count> stops{};
    for (std::size_t index = 0U; index < stops.size(); ++index) {
        stops[index].offset = static_cast<float>(index)
            / static_cast<float>(stops.size() - 1U);
        stops[index].color = renderColor(input.theme.titleGradient[index]);
    }

    GradientCommand background{};
    background.header = makeHeader(
        RenderLayer::background,
        title_effect_surface_layer_order
    );
    background.type = GradientType::linear;
    background.bounds = fullLogicalBounds(input.layout);
    background.start = {0.0F, 0.0F};
    background.end = {
        background.bounds.width,
        background.bounds.height
    };
    if (!builder.addGradient(background, stops)) {
        return false;
    }

    const double transition = clampUnit(input.entrance.transitionEase);
    const ui::layout::CircleD introCircle = input.layout.title.introCircle;
    const ui::layout::CircleD settledCircle = input.layout.title.settledCircle;
    const double circleCenterX = interpolate(
        introCircle.center.x,
        settledCircle.center.x,
        transition
    );
    const double circleCenterY = interpolate(
        introCircle.center.y,
        settledCircle.center.y,
        transition
    );
    const double circleRadius = interpolate(
        introCircle.radius,
        settledCircle.radius,
        transition
    );
    ShapeCommand circle{};
    circle.header = makeHeader(
        RenderLayer::effect,
        title_effect_surface_layer_order
    );
    circle.shape = ShapeType::circle;
    circle.fillEnabled = 0U;
    circle.strokeEnabled = 1U;
    circle.bounds = {
        finiteFloat(circleCenterX - circleRadius),
        finiteFloat(circleCenterY - circleRadius),
        finiteFloat(circleRadius * 2.0),
        finiteFloat(circleRadius * 2.0)
    };
    circle.strokeWidth = finiteFloat(interpolate(
        introCircle.outlineWidth,
        settledCircle.outlineWidth,
        transition
    ));
    circle.fill = PremultipliedRgba::transparent();
    circle.stroke = renderColor(input.theme.titleLine, 0.86);
    if (!builder.addShape(circle)) {
        return false;
    }

    const ui::layout::RoundedRectD logoRect = interpolateRect(
        input.layout.title.loadingLogoRect,
        input.layout.title.settledLogoRect,
        transition
    );
    ShapeCommand logoShadow{};
    logoShadow.header = circle.header;
    logoShadow.shape = ShapeType::hexagon;
    logoShadow.bounds = renderRect(logoRect);
    logoShadow.fill = renderColor(input.theme.logoShadow, 0.34);
    if (!builder.addShape(logoShadow)) {
        return false;
    }

    ShapeCommand logoFill = logoShadow;
    logoFill.shape = ShapeType::pentagon;
    logoFill.bounds.x += logoFill.bounds.width * 0.08F;
    logoFill.bounds.y += logoFill.bounds.height * 0.08F;
    logoFill.bounds.width *= 0.84F;
    logoFill.bounds.height *= 0.84F;
    logoFill.fill = renderColor(input.theme.logoFill);
    if (!builder.addShape(logoFill)) {
        return false;
    }

    const CommandHeader uiHeader = makeHeader(
        RenderLayer::ui,
        title_ui_surface_layer_order
    );
    UiCommand cardPane{};
    cardPane.header = uiHeader;
    cardPane.primitive = UiPrimitive::panel;
    cardPane.elementId = card_pane_id;
    cardPane.bounds = renderRect(input.entrance.cardPane.panelRect);
    cardPane.cornerRadius = finiteFloat(input.entrance.cardPane.panelRect.radius);
    cardPane.backgroundColor = renderColor(
        input.theme.menuForeground,
        input.theme.menuPanelFillOpacity * input.entrance.cardPane.alpha
    );
    cardPane.borderColor = renderColor(
        input.theme.menuAccent,
        input.theme.menuPanelStrokeOpacity * input.entrance.cardPane.alpha
    );
    cardPane.accentColor = renderColor(input.theme.menuAccent);
    if (!builder.addUi(cardPane)) {
        return false;
    }

    UiCommand utilityPane = cardPane;
    utilityPane.elementId = utility_pane_id;
    utilityPane.bounds = renderRect(input.entrance.utilityPane.panelRect);
    utilityPane.cornerRadius = finiteFloat(
        input.entrance.utilityPane.panelRect.radius
    );
    utilityPane.backgroundColor = renderColor(
        input.theme.menuForeground,
        input.theme.menuPanelFillOpacity * input.entrance.utilityPane.alpha
    );
    utilityPane.borderColor = renderColor(
        input.theme.menuAccent,
        input.theme.menuUtilityPanelStrokeOpacity
            * input.entrance.utilityPane.alpha
    );
    if (!builder.addUi(utilityPane)) {
        return false;
    }

    ClipCommand cardClip{};
    cardClip.header = uiHeader;
    cardClip.operation = ClipOperation::pushRoundedRect;
    cardClip.antialias = 1U;
    cardClip.bounds = cardPane.bounds;
    cardClip.cornerRadius = cardPane.cornerRadius;
    if (!builder.addClip(cardClip)) {
        return false;
    }
    for (std::size_t index = 0U; index < input.entrance.cards.size(); ++index) {
        const ui::layout::TitleCardRenderMetrics& metrics = input.entrance.cards[index];
        const ui::TitleUiTargetInteraction& interaction = interactionFor(
            input.interaction,
            targetFor(metrics.slot)
        );
        UiCommand card{};
        card.header = uiHeader;
        card.primitive = UiPrimitive::button;
        card.stateFlags = stateFlagsFor(interaction);
        card.elementId = instanceId(card_id_base, 0U, static_cast<std::uint32_t>(index));
        card.bounds = renderRect(metrics.panelRect);
        card.cornerRadius = finiteFloat(metrics.panelRect.radius);
        card.value = finiteFloat(metrics.revealProgress);
        card.backgroundColor = renderColor(
            shellBackgroundFor(input.theme, interaction),
            metrics.alpha
        );
        card.borderColor = renderColor(
            input.theme.menuAccent,
            input.theme.menuCardInnerLineOpacity * metrics.alpha
        );
        card.accentColor = renderColor(input.theme.titleButtonText, metrics.alpha);
        if (!builder.addUi(card)) {
            return false;
        }
    }
    if (hasTextResources(input)) {
        for (const ui::layout::TitleCardRenderMetrics& card : input.entrance.cards) {
            if (!addCardText(builder, input, card, uiHeader)) {
                return false;
            }
        }
    }
    ClipCommand cardClipPop = cardClip;
    cardClipPop.operation = ClipOperation::pop;
    if (!builder.addClip(cardClipPop)) {
        return false;
    }

    ClipCommand utilityClip{};
    utilityClip.header = uiHeader;
    utilityClip.operation = ClipOperation::pushRoundedRect;
    utilityClip.antialias = 1U;
    utilityClip.bounds = utilityPane.bounds;
    utilityClip.cornerRadius = utilityPane.cornerRadius;
    if (!builder.addClip(utilityClip)) {
        return false;
    }
    for (std::size_t index = 0U; index < input.entrance.utilityTiles.size(); ++index) {
        const ui::layout::UtilityTileRenderMetrics& metrics =
            input.entrance.utilityTiles[index];
        const ui::TitleUiTargetInteraction& interaction = interactionFor(
            input.interaction,
            targetFor(metrics.slot)
        );
        UiCommand tile{};
        tile.header = uiHeader;
        tile.primitive = UiPrimitive::button;
        tile.stateFlags = stateFlagsFor(interaction);
        tile.elementId = instanceId(
            utility_id_base,
            0U,
            static_cast<std::uint32_t>(index)
        );
        tile.bounds = renderRect(metrics.panelRect);
        tile.cornerRadius = finiteFloat(metrics.panelRect.radius);
        tile.value = finiteFloat(metrics.revealProgress);
        tile.backgroundColor = renderColor(
            shellBackgroundFor(input.theme, interaction),
            metrics.alpha
        );
        tile.borderColor = renderColor(
            input.theme.menuAccent,
            input.theme.menuUtilityPanelStrokeOpacity * metrics.alpha
        );
        tile.accentColor = renderColor(input.theme.menuIconFill, metrics.alpha);
        if (!builder.addUi(tile)) {
            return false;
        }
    }
    for (std::size_t index = 0U; index < input.entrance.utilityTiles.size(); ++index) {
        const ui::layout::UtilityTileRenderMetrics& metrics =
            input.entrance.utilityTiles[index];
        const double size = std::min({
            metrics.placeholderSize,
            metrics.panelRect.width,
            metrics.panelRect.height
        });
        UiCommand icon{};
        icon.header = uiHeader;
        icon.primitive = UiPrimitive::custom;
        icon.elementId = instanceId(
            utility_icon_id_base,
            0U,
            static_cast<std::uint32_t>(index)
        );
        icon.bounds = {
            finiteFloat(metrics.panelRect.x + (metrics.panelRect.width - size) * 0.5),
            finiteFloat(metrics.panelRect.y + (metrics.panelRect.height - size) * 0.5),
            finiteFloat(size),
            finiteFloat(size)
        };
        icon.cornerRadius = finiteFloat(size * 0.22);
        icon.backgroundColor = renderColor(
            input.theme.menuIconFill,
            input.theme.menuPlaceholderOpacity * metrics.alpha
        );
        icon.borderColor = renderColor(input.theme.menuIconShadow, metrics.alpha);
        icon.accentColor = renderColor(input.theme.menuAccent, metrics.alpha);
        if (!builder.addUi(icon)) {
            return false;
        }
    }
    ClipCommand utilityClipPop = utilityClip;
    utilityClipPop.operation = ClipOperation::pop;
    if (!builder.addClip(utilityClipPop)) {
        return false;
    }

    if (hasVersionHistoryLink(input)) {
        const ui::layout::TitleVersionHistoryLinkRenderMetrics& metrics =
            input.entrance.versionHistoryLink;
        const ui::TitleUiTargetInteraction& interaction = interactionFor(
            input.interaction,
            ui::TitleUiTarget::versionHistoryLink
        );
        UiCommand link{};
        link.header = uiHeader;
        link.primitive = UiPrimitive::custom;
        link.stateFlags = stateFlagsFor(interaction);
        link.elementId = version_history_link_id;
        link.bounds = renderRect(metrics.hitRect);
        link.backgroundColor = PremultipliedRgba::transparent();
        link.borderColor = PremultipliedRgba::transparent();
        link.accentColor = PremultipliedRgba::transparent();
        if (!builder.addUi(link)) {
            return false;
        }

        const ui::layout::RoundedRectD& icon = metrics.iconRect;
        const double centerX = icon.x + (icon.width * 0.5);
        const double centerY = icon.y + (icon.height * 0.5);
        const double iconSize = std::min(icon.width, icon.height);
        const double halfSpan = iconSize * 0.308;
        const double headLength = halfSpan * 0.88;
        const double hoverAlpha = interaction.hovered ? 1.0 : 0.42;
        LineCommand arrow{};
        arrow.header = uiHeader;
        arrow.width = finiteFloat(std::max(iconSize * 0.1, 1.0));
        arrow.color = renderColor(
            input.theme.menuForeground,
            hoverAlpha * metrics.alpha
        );
        arrow.cap = LineCap::round;
        arrow.start = {
            finiteFloat(centerX - halfSpan),
            finiteFloat(centerY)
        };
        arrow.end = {
            finiteFloat(centerX + halfSpan),
            finiteFloat(centerY)
        };
        if (!builder.addLine(arrow)) {
            return false;
        }
        arrow.start = {
            finiteFloat(centerX + halfSpan - headLength),
            finiteFloat(centerY - headLength)
        };
        if (!builder.addLine(arrow)) {
            return false;
        }
        arrow.start.y = finiteFloat(centerY + headLength);
        if (!builder.addLine(arrow)) {
            return false;
        }
        if (hasTextResources(input)
            && !addVersionText(builder, input, uiHeader)) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] double baseDimFor(
    const ui::OverlayKind kind,
    const TitleSceneInput& input
) noexcept {
    if (kind == ui::OverlayKind::debug) {
        return 0.16;
    }
    if (ui::isTitleOverlayKind(kind)) {
        return input.layout.overlays.titleBaseDim;
    }
    if (kind == ui::OverlayKind::exitConfirm) {
        return input.layout.overlays.exit.baseDim;
    }
    if (kind == ui::OverlayKind::externalLinkWarning) {
        return input.layout.overlays.externalLinkWarning.baseDim;
    }
    return input.theme.overlayDim;
}

[[nodiscard]] bool addDimSession(
    FramePacketBuilder& builder,
    const TitleSceneInput& input,
    const ui::OverlaySnapshot& overlay,
    const OverlaySurfaceLayerOrders orders,
    std::uint32_t& anchorSequence,
    const std::uint64_t backdropRevision
) {
    OverlayCommand begin{};
    begin.header = makeHeader(RenderLayer::dynamicOverlay, orders.dim);
    begin.operation = OverlayOperation::beginSession;
    begin.sessionId = instanceId(overlay_dim_session_id, overlay.sequence);
    if (!builder.addOverlay(begin)) {
        return false;
    }

    OverlayCommand dim = begin;
    dim.operation = OverlayOperation::dim;
    dim.sourceLayers = backdrop_source_layers;
    dim.sourceRevision = backdropRevision;
    dim.sourceBounds = fullLogicalBounds(input.layout);
    dim.destinationBounds = dim.sourceBounds;
    dim.opacity = static_cast<float>(clampUnit(
        baseDimFor(overlay.kind, input) * overlay.dimAlpha
    ));
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
    const TitleSceneInput& input,
    const ui::OverlaySnapshot& overlay,
    const OverlaySurfaceLayerOrders orders,
    const RectF panelBounds,
    const std::uint32_t anchorSequence,
    const std::uint64_t backdropRevision
) {
    PassCommand pass{};
    pass.header = makeHeader(RenderLayer::dynamicOverlay, orders.effect);
    pass.sessionId = instanceId(overlay_effect_session_id, overlay.sequence);
    pass.destinationId = instanceId(
        overlay_effect_destination_id,
        overlay.sequence
    );
    pass.sourceRevision = backdropRevision;
    pass.sourceAnchorLayer = RenderLayer::dynamicOverlay;
    pass.sourceAnchorLayerOrder = orders.dim;
    pass.sourceAnchorSequence = anchorSequence;
    pass.sourceBounds = panelBounds;
    pass.destinationBounds = panelBounds;
    pass.opacity = static_cast<float>(clampUnit(overlay.alpha));
    pass.contentBlurRadius = finiteFloat(std::max(overlay.contentBlur, 0.0));
    pass.glassBlurRadius = 18.0F;
    pass.refractionStrength = 0.015F;
    pass.edgeStrength = finiteFloat(input.theme.overlayGlassEdgeStrength);
    pass.tintColor = renderColor(
        input.theme.overlayGlassTint,
        input.theme.overlayGlassTintStrength * overlay.alpha
    );
    pass.edgeColor = renderColor(
        input.theme.overlayGlassEdge,
        overlay.alpha
    );
    pass.shadowColor = renderColor(
        input.theme.overlayPanelShadow,
        overlay.alpha
    );

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

[[nodiscard]] bool addOverlayText(
    FramePacketBuilder& builder,
    const TitleSceneInput& input,
    const ui::OverlaySnapshot& overlay,
    const ui::layout::OverlayDialogRenderMetrics& dialog,
    const CommandHeader header
) {
    const double scale = std::isfinite(overlay.contentScale)
            && overlay.contentScale > 0.0
        ? overlay.contentScale
        : 1.0;
    const double paddingX = input.layout.overlayPage.dialogPaddingX * scale;
    const double left = dialog.panelRect.x + paddingX;
    const double right = dialog.panelRect.x + dialog.panelRect.width - paddingX;
    const double titleTop = dialog.panelRect.y
        + input.layout.overlayPage.titleTop * scale;
    const double alpha = clampUnit(overlay.alpha);
    const Vec2F cancelCenter{
        finiteFloat(dialog.cancelButtonRect.x + dialog.cancelButtonRect.width * 0.5),
        finiteFloat(dialog.cancelButtonRect.y + dialog.cancelButtonRect.height * 0.5)
    };
    const Vec2F confirmCenter{
        finiteFloat(dialog.confirmButtonRect.x + dialog.confirmButtonRect.width * 0.5),
        finiteFloat(dialog.confirmButtonRect.y + dialog.confirmButtonRect.height * 0.5)
    };

    if (overlay.kind == ui::OverlayKind::mapSelect) {
        const double h1Line = input.layout.typography[
            static_cast<std::size_t>(ui::layout::TypographyRole::h1)
        ].lineHeight * scale;
        const double h3Line = input.layout.typography[
            static_cast<std::size_t>(ui::layout::TypographyRole::h3)
        ].lineHeight * scale;
        const double nameTop = titleTop + h1Line
            + input.layout.overlayPage.titleDividerGap * scale
            + scale
            + input.layout.viewport.wh * 0.024 * scale;
        const double descriptionTop = nameTop + h3Line
            + input.layout.viewport.wh * (0.012 + 0.25 + 0.014) * scale;
        return addShapedText(
                   builder,
                   input,
                   UiTextSemanticId::mapSelectTitle,
                   typographySize(input, ui::layout::TypographyRole::h1)
                       * finiteFloat(scale),
                   header,
                   {finiteFloat(left), finiteFloat(titleTop)},
                   TextHorizontalAnchor::left,
                   TextVerticalAnchor::top,
                   renderColor(input.theme.titleText, alpha)
               )
            && addShapedText(
                builder,
                input,
                UiTextSemanticId::mapName,
                typographySize(input, ui::layout::TypographyRole::h3)
                    * finiteFloat(scale),
                header,
                {finiteFloat(left), finiteFloat(nameTop)},
                TextHorizontalAnchor::left,
                TextVerticalAnchor::top,
                renderColor(input.theme.titleText, alpha)
            )
            && addShapedText(
                builder,
                input,
                UiTextSemanticId::mapSelected,
                typographySize(input, ui::layout::TypographyRole::h5)
                    * finiteFloat(scale),
                header,
                {finiteFloat(right), finiteFloat(nameTop + h3Line * 0.5)},
                TextHorizontalAnchor::right,
                TextVerticalAnchor::middle,
                renderColor(input.theme.optionActive, alpha)
            )
            && addShapedText(
                builder,
                input,
                UiTextSemanticId::mapDescription,
                typographySize(input, ui::layout::TypographyRole::h5)
                    * finiteFloat(scale),
                header,
                {finiteFloat(left), finiteFloat(descriptionTop)},
                TextHorizontalAnchor::left,
                TextVerticalAnchor::top,
                renderColor(input.theme.overlayItemText, alpha)
            )
            && addShapedText(
                builder,
                input,
                UiTextSemanticId::mapCancel,
                typographySize(input, ui::layout::TypographyRole::buttonPrimary)
                    * finiteFloat(scale),
                header,
                cancelCenter,
                TextHorizontalAnchor::center,
                TextVerticalAnchor::middle,
                renderColor(input.theme.cancelText, alpha)
            )
            && addShapedText(
                builder,
                input,
                UiTextSemanticId::mapStart,
                typographySize(input, ui::layout::TypographyRole::buttonPrimary)
                    * finiteFloat(scale),
                header,
                confirmCenter,
                TextHorizontalAnchor::center,
                TextVerticalAnchor::middle,
                renderColor(input.theme.confirmText, alpha)
            );
    }

    const bool isExit = overlay.kind == ui::OverlayKind::exitConfirm;
    const UiTextSemanticId titleSemantic = isExit
        ? UiTextSemanticId::exitTitle
        : UiTextSemanticId::externalTitle;
    const UiTextSemanticId bodySemantic = isExit
        ? UiTextSemanticId::exitBody
        : UiTextSemanticId::externalBody;
    const UiTextSemanticId cancelSemantic = isExit
        ? UiTextSemanticId::exitNo
        : UiTextSemanticId::externalNo;
    const UiTextSemanticId confirmSemantic = isExit
        ? UiTextSemanticId::exitYes
        : UiTextSemanticId::externalYes;
    const double bodyTop = titleTop + input.layout.typography[
        static_cast<std::size_t>(ui::layout::TypographyRole::h2)
    ].lineHeight * scale
        + input.layout.overlayPage.dialogBodyGap * scale;
    if (!addShapedText(
            builder,
            input,
            titleSemantic,
            typographySize(input, ui::layout::TypographyRole::h2)
                * finiteFloat(scale),
            header,
            {finiteFloat(left), finiteFloat(titleTop)},
            TextHorizontalAnchor::left,
            TextVerticalAnchor::top,
            renderColor(input.theme.titleText, alpha)
        )
        || !addShapedText(
            builder,
            input,
            bodySemantic,
            typographySize(input, ui::layout::TypographyRole::h4)
                * finiteFloat(scale),
            header,
            {finiteFloat(left), finiteFloat(bodyTop)},
            TextHorizontalAnchor::left,
            TextVerticalAnchor::top,
            renderColor(input.theme.overlayItemText, alpha)
        )) {
        return false;
    }
    if (!isExit) {
        UiTextSemanticId urlSemantic{};
        // 고정 catalog 밖의 URL도 경고/취소/확인 effect는 그대로 유지한다. 다만
        // display URL은 frame 중 transient shaping하지 않고 capability missing으로 남긴다.
        if (text::titleExternalUrlSemantic(
                overlay.externalUrl.view(),
                urlSemantic
            )
            && !addShapedText(
                builder,
                input,
                urlSemantic,
                typographySize(input, ui::layout::TypographyRole::linkPreview)
                    * finiteFloat(scale),
                header,
                {
                    finiteFloat(left),
                    finiteFloat(
                        bodyTop + input.layout.typography[
                            static_cast<std::size_t>(ui::layout::TypographyRole::h4)
                        ].lineHeight * scale
                            + input.layout.viewport.wh * 0.008 * scale
                    )
                },
                TextHorizontalAnchor::left,
                TextVerticalAnchor::top,
                renderColor(input.theme.linkText, alpha)
            )) {
            return false;
        }
    }
    return addShapedText(
               builder,
               input,
               cancelSemantic,
               typographySize(input, ui::layout::TypographyRole::buttonPrimary)
                   * finiteFloat(scale),
               header,
               cancelCenter,
               TextHorizontalAnchor::center,
               TextVerticalAnchor::middle,
               renderColor(input.theme.cancelText, alpha)
           )
        && addShapedText(
            builder,
            input,
            confirmSemantic,
            typographySize(input, ui::layout::TypographyRole::buttonPrimary)
                * finiteFloat(scale),
            header,
            confirmCenter,
            TextHorizontalAnchor::center,
            TextVerticalAnchor::middle,
            renderColor(input.theme.confirmText, alpha)
        );
}

[[nodiscard]] bool addOverlayUiShell(
    FramePacketBuilder& builder,
    const TitleSceneInput& input,
    const ui::OverlaySnapshot& overlay,
    const OverlaySurfaceLayerOrders orders,
    const ui::layout::OverlayDialogRenderMetrics& dialog,
    const bool includeLinkPreview
) {
    OverlayCommand begin{};
    begin.header = makeHeader(RenderLayer::dynamicOverlay, orders.ui);
    begin.operation = OverlayOperation::beginSession;
    begin.sessionId = instanceId(overlay_ui_session_id, overlay.sequence);
    if (!builder.addOverlay(begin)) {
        return false;
    }

    const RectF panelBounds = renderRect(dialog.panelRect);
    const float panelRadius = finiteFloat(dialog.panelRect.radius);
    const double scale = std::isfinite(overlay.contentScale)
            && overlay.contentScale > 0.0
        ? overlay.contentScale
        : 1.0;
    ClipCommand clip{};
    clip.header = begin.header;
    clip.operation = ClipOperation::pushRoundedRect;
    clip.antialias = 1U;
    clip.bounds = panelBounds;
    clip.cornerRadius = panelRadius;
    if (!builder.addClip(clip)) {
        return false;
    }

    const double alpha = clampUnit(overlay.alpha);
    UiCommand panel{};
    panel.header = begin.header;
    panel.primitive = UiPrimitive::panel;
    panel.elementId = instanceId(overlay_panel_id, overlay.sequence);
    panel.bounds = panelBounds;
    panel.cornerRadius = panelRadius;
    panel.borderWidth = 1.0F;
    panel.backgroundColor = renderColor(
        input.disableTransparency
            ? input.theme.overlayPanelBackground
            : input.theme.overlayGlassBackground,
        alpha
    );
    panel.borderColor = renderColor(
        input.disableTransparency
            ? input.theme.overlayPanelBorder
            : input.theme.overlayGlassBorder,
        alpha
    );
    panel.accentColor = renderColor(input.theme.overlayGlassEdge, alpha);
    if (!builder.addUi(panel)) {
        return false;
    }

    const RectF cancelBounds = renderRect(dialog.cancelButtonRect);
    const RectF confirmBounds = renderRect(dialog.confirmButtonRect);
    const bool buttonsDisabled = !overlay.acceptsInput
        || overlay.interactionsLocked;
    const bool interactionMatchesOverlay = input.interaction.overlaySequence
        == overlay.sequence;
    const ui::TitleUiTargetInteraction& cancelInteraction = interactionFor(
        input.interaction,
        ui::TitleUiTarget::overlayCancel
    );
    const ui::TitleUiTargetInteraction& confirmInteraction = interactionFor(
        input.interaction,
        ui::TitleUiTarget::overlayConfirm
    );
    const std::uint16_t cancelState = buttonsDisabled
        ? uiStateBits(UiStateFlag::disabled)
        : interactionMatchesOverlay
            ? stateFlagsFor(cancelInteraction)
            : uiStateBits(UiStateFlag::none);
    const std::uint16_t confirmState = buttonsDisabled
        ? uiStateBits(UiStateFlag::disabled)
        : interactionMatchesOverlay
            ? stateFlagsFor(confirmInteraction)
            : uiStateBits(UiStateFlag::none);
    const bool cancelHighlighted = !buttonsDisabled
        && interactionMatchesOverlay
        && (cancelInteraction.hovered || cancelInteraction.pressed);
    const bool confirmHighlighted = !buttonsDisabled
        && interactionMatchesOverlay
        && (confirmInteraction.hovered || confirmInteraction.pressed);

    UiCommand cancel{};
    cancel.header = begin.header;
    cancel.primitive = UiPrimitive::button;
    cancel.stateFlags = cancelState;
    cancel.elementId = instanceId(overlay_cancel_id, overlay.sequence);
    cancel.bounds = cancelBounds;
    cancel.cornerRadius = finiteFloat(dialog.cancelButtonRect.radius);
    cancel.backgroundColor = renderColor(
        cancelHighlighted
            ? input.theme.cancelHover
            : input.theme.cancelIdle,
        alpha
    );
    cancel.borderColor = renderColor(input.theme.cancelHover, alpha);
    cancel.accentColor = renderColor(input.theme.cancelText, alpha);
    if (!builder.addUi(cancel)) {
        return false;
    }

    UiCommand confirm = cancel;
    confirm.stateFlags = confirmState;
    confirm.elementId = instanceId(overlay_confirm_id, overlay.sequence);
    confirm.bounds = confirmBounds;
    confirm.cornerRadius = finiteFloat(dialog.confirmButtonRect.radius);
    confirm.backgroundColor = renderColor(
        confirmHighlighted
            ? input.theme.confirmHover
            : input.theme.confirmIdle,
        alpha
    );
    confirm.borderColor = renderColor(input.theme.confirmHover, alpha);
    confirm.accentColor = renderColor(input.theme.confirmText, alpha);
    if (!builder.addUi(confirm)) {
        return false;
    }

    if (includeLinkPreview) {
        const float horizontalPadding = std::min(
            finiteFloat(input.layout.overlayPage.dialogPaddingX * scale),
            panelBounds.width * 0.24F
        );
        UiCommand link{};
        link.header = begin.header;
        link.primitive = UiPrimitive::custom;
        link.elementId = instanceId(overlay_link_id, overlay.sequence);
        link.bounds = {
            panelBounds.x + horizontalPadding,
            panelBounds.y + panelBounds.height * 0.48F,
            std::max(0.0F, panelBounds.width - horizontalPadding * 2.0F),
            std::max(0.0F, cancelBounds.height * 0.62F)
        };
        link.cornerRadius = cancel.cornerRadius;
        link.backgroundColor = renderColor(input.theme.linkIdle, alpha);
        link.borderColor = renderColor(input.theme.linkHover, alpha);
        link.accentColor = renderColor(input.theme.linkText, alpha);
        if (!builder.addUi(link)) {
            return false;
        }
    }

    if (hasTextResources(input)
        && !addOverlayText(builder, input, overlay, dialog, begin.header)) {
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

[[nodiscard]] bool addPresentationUiShell(
    FramePacketBuilder& builder,
    const TitleSceneInput& input,
    const ui::OverlaySnapshot& overlay,
    const OverlaySurfaceLayerOrders orders,
    const ui::TitleOverlayPresentation& presentation
) {
    OverlayCommand begin{};
    begin.header = makeHeader(RenderLayer::dynamicOverlay, orders.ui);
    begin.operation = OverlayOperation::beginSession;
    begin.sessionId = instanceId(overlay_ui_session_id, overlay.sequence);
    if (!builder.addOverlay(begin)) {
        return false;
    }

    ClipCommand clip{};
    clip.header = begin.header;
    clip.operation = ClipOperation::pushRoundedRect;
    clip.antialias = 1U;
    clip.bounds = renderRect(presentation.panelRect);
    clip.cornerRadius = finiteFloat(presentation.panelRect.radius);
    if (!builder.addClip(clip)
        || !addTitleOverlayPresentation(
            builder,
            {
                presentation,
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

[[nodiscard]] bool addOverlayShells(
    FramePacketBuilder& builder,
    const TitleSceneInput& input,
    const TitleSceneConfig& config
) {
    ui::TitleOverlayPresentationSet localPresentations{};
    const ui::TitleOverlayPresentationSet* presentations =
        input.overlayPresentations;
    if (presentations == nullptr) {
        if (!ui::tryBuildTitleOverlayPresentationSet(
                input.uiState,
                input.layout,
                localPresentations)) {
            return false;
        }
        presentations = &localPresentations;
    }
    if (presentations->stateRevision != input.uiState.revision
        || presentations->layoutRevision != input.layout.revision
        || presentations->overlayCount != input.uiState.overlayCount) {
        return false;
    }
    const std::size_t overlayCount = std::min<std::size_t>(
        input.uiState.overlayCount,
        input.uiState.overlays.size()
    );
    const bool fullOverlayContent = hasRequiredTextRuns(input);
    for (std::size_t index = 0U; index < overlayCount; ++index) {
        const ui::OverlaySnapshot& overlay = input.uiState.overlays[index];
        OverlaySurfaceLayerOrders orders{};
        if (!tryResolveOverlaySurfaceLayerOrders(overlay, orders)) {
            return false;
        }
        std::uint32_t anchorSequence = 0U;
        if (!addDimSession(
                builder,
                input,
                overlay,
                orders,
                anchorSequence,
                config.backdropRevision
            )) {
            return false;
        }
        if (!fullOverlayContent) {
            const bool isMapSelect = overlay.kind == ui::OverlayKind::mapSelect;
            const bool isExit = overlay.kind == ui::OverlayKind::exitConfirm;
            const bool isExternal = overlay.kind
                == ui::OverlayKind::externalLinkWarning;
            if (!isMapSelect && !isExit && !isExternal) {
                continue;
            }
            const ui::layout::OverlayDialogMetrics& sourceDialog = isMapSelect
                ? input.layout.overlays.mapSelect
                : isExit
                    ? input.layout.overlays.exit
                    : input.layout.overlays.externalLinkWarning;
            ui::layout::OverlayDialogRenderMetrics dialog{};
            if (!ui::layout::tryResolveOverlayDialogRenderMetrics(
                    sourceDialog,
                    input.layout.overlayPage,
                    overlay.contentScale,
                    dialog
                )
                || (!input.disableTransparency
                    && !addGlassPass(
                        builder,
                        input,
                        overlay,
                        orders,
                        renderRect(dialog.panelRect),
                        anchorSequence,
                        config.backdropRevision
                    ))
                || !addOverlayUiShell(
                    builder,
                    input,
                    overlay,
                    orders,
                    dialog,
                    isExternal
                )) {
                return false;
            }
            continue;
        }
        const ui::TitleOverlayPresentation* const presentation =
            ui::findTitleOverlayPresentation(*presentations, overlay.sequence);
        if (presentation == nullptr
            || presentation->kind != overlay.kind) {
            return false;
        }
        const RectF panelBounds = renderRect(presentation->panelRect);
        if ((!input.disableTransparency
                && !addGlassPass(
                    builder,
                    input,
                    overlay,
                    orders,
                    panelBounds,
                    anchorSequence,
                    config.backdropRevision
                ))
            || !addPresentationUiShell(
                builder,
                input,
                overlay,
                orders,
                *presentation
            )) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] TitleSceneResult failedResult(
    const FrameBuildError error,
    const TitleSceneMissingCapabilities missingCapabilities,
    const FramePacketCapacity requiredCapacity
) noexcept {
    return {
        false,
        error,
        missingCapabilities,
        requiredCapacity,
        {}
    };
}

} // namespace

bool tryResolveOverlaySurfaceLayerOrders(
    const ui::OverlaySnapshot& overlay,
    OverlaySurfaceLayerOrders& out
) noexcept {
    if (overlay.layer < 0 || overlay.sequence == 0U) {
        return false;
    }
    const std::uint64_t base = static_cast<std::uint64_t>(overlay.layer) * 1'000U
        + static_cast<std::uint64_t>(overlay.sequence) * 10U;
    constexpr std::uint64_t maximumBase = static_cast<std::uint64_t>(
        std::numeric_limits<std::int32_t>::max() - 3
    );
    if (base == 0U || base > maximumBase) {
        return false;
    }
    const auto resolvedBase = static_cast<std::int32_t>(base);
    const OverlaySurfaceLayerOrders candidate{
        resolvedBase - 1,
        resolvedBase,
        resolvedBase + 1,
        resolvedBase + 2,
        resolvedBase + 3
    };
    out = candidate;
    return true;
}

FramePacketCapacity titleSceneCapacity(const TitleSceneInput& input) noexcept {
    FramePacketCapacity capacity{};
    capacity.shapeCount = base_title_shape_count;
    capacity.uiCount = base_title_ui_count
        + (hasVersionHistoryLink(input) ? version_history_link_ui_count : 0U);
    capacity.lineCount = hasVersionHistoryLink(input)
        ? version_history_link_line_count
        : 0U;
    capacity.gradientCount = base_title_gradient_count;
    capacity.gradientStopCount = ui::layout::title_gradient_color_count;
    capacity.clipCount = base_title_clip_count;

    const std::size_t overlayCount = std::min<std::size_t>(
        input.uiState.overlayCount,
        input.uiState.overlays.size()
    );
    const bool fullOverlayContent = hasRequiredTextRuns(input);
    const std::size_t glassPassCount = input.disableTransparency
        ? 0U
        : glass_pass_command_count;
    for (std::size_t index = 0U; index < overlayCount; ++index) {
        capacity.overlayCount += dim_session_command_count;
        const ui::OverlayKind kind = input.uiState.overlays[index].kind;
        if (!fullOverlayContent) {
            if (kind == ui::OverlayKind::mapSelect) {
                capacity.overlayCount += shell_overlay_command_count;
                capacity.passCount += glassPassCount;
                capacity.clipCount += shell_clip_command_count;
                capacity.uiCount += map_select_shell_ui_count;
            } else if (kind == ui::OverlayKind::exitConfirm) {
                capacity.overlayCount += shell_overlay_command_count;
                capacity.passCount += glassPassCount;
                capacity.clipCount += shell_clip_command_count;
                capacity.uiCount += exit_shell_ui_count;
            } else if (kind == ui::OverlayKind::externalLinkWarning) {
                capacity.overlayCount += shell_overlay_command_count;
                capacity.passCount += glassPassCount;
                capacity.clipCount += shell_clip_command_count;
                capacity.uiCount += external_shell_ui_count;
            }
            continue;
        }
        capacity.overlayCount += shell_overlay_command_count;
        capacity.passCount += glassPassCount;
        capacity.clipCount += shell_clip_command_count;
        capacity.shapeCount += 1U; // header divider
        capacity.uiCount += 1U; // panel
        switch (kind) {
        case ui::OverlayKind::mapSelect:
            capacity.shapeCount += 24U; // preview background + 23 floor cells
            capacity.lineCount += 16U; // complete 9x5 grid
            capacity.uiCount += 2U;
            break;
        case ui::OverlayKind::deck:
            capacity.shapeCount += 2U;
            capacity.uiCount += 5U; // 3 controls + 2 progress bars
            break;
        case ui::OverlayKind::setting:
            capacity.uiCount += 14U;
            break;
        case ui::OverlayKind::credits:
            capacity.uiCount += 6U;
            break;
        case ui::OverlayKind::quickStart:
        case ui::OverlayKind::records:
        case ui::OverlayKind::research:
        case ui::OverlayKind::achievements:
            capacity.uiCount += 1U;
            break;
        case ui::OverlayKind::debug:
            capacity.uiCount += 6U;
            break;
        case ui::OverlayKind::exitConfirm:
        case ui::OverlayKind::externalLinkWarning:
            capacity.uiCount += 2U;
            break;
        case ui::OverlayKind::none:
            break;
        }
    }
    addTitleTextCapacity(capacity, input);
    capacity.commandCount = capacity.spriteCount
        + capacity.shapeCount
        + capacity.lineCount
        + capacity.textCount
        + capacity.effectCount
        + capacity.uiCount
        + capacity.overlayCount
        + capacity.glyphRunCount
        + capacity.texturedMeshCount
        + capacity.gradientCount
        + capacity.clipCount
        + capacity.passCount;
    return capacity;
}

ViewportState makeTitleViewport(
    const ui::layout::UiLayoutSnapshot& layout,
    const TitleSceneConfig& config
) noexcept {
    const std::int32_t drawableWidth = positiveDimension(config.drawableSize.width);
    const std::int32_t drawableHeight = positiveDimension(config.drawableSize.height);
    const double logicalWidth = std::isfinite(layout.viewport.ww)
            && layout.viewport.ww > 0.0
        ? layout.viewport.ww
        : 1.0;
    const double logicalHeight = std::isfinite(layout.viewport.wh)
            && layout.viewport.wh > 0.0
        ? layout.viewport.wh
        : 1.0;
    const double scaleDouble = std::min(
        static_cast<double>(drawableWidth) / logicalWidth,
        static_cast<double>(drawableHeight) / logicalHeight
    );
    const std::int32_t contentWidth = std::clamp(
        static_cast<std::int32_t>(logicalWidth * scaleDouble),
        1,
        drawableWidth
    );
    const std::int32_t contentHeight = std::clamp(
        static_cast<std::int32_t>(logicalHeight * scaleDouble),
        1,
        drawableHeight
    );
    const RectI contentRect{
        (drawableWidth - contentWidth) / 2,
        (drawableHeight - contentHeight) / 2,
        contentWidth,
        contentHeight
    };
    const double fittedScaleDouble = std::min(
        static_cast<double>(contentWidth) / logicalWidth,
        static_cast<double>(contentHeight) / logicalHeight
    );
    float logicalScale = positiveFiniteOr(
        static_cast<float>(fittedScaleDouble),
        1.0F,
        static_cast<float>(std::numeric_limits<std::int32_t>::max())
    );
    if (static_cast<double>(logicalScale) * logicalWidth
            > static_cast<double>(contentWidth)
        || static_cast<double>(logicalScale) * logicalHeight
            > static_cast<double>(contentHeight)) {
        logicalScale = std::nextafter(logicalScale, 0.0F);
    }
    const InsetsI contentSafeArea = mapSafeAreaToContent(
        config.drawableSafeArea,
        {drawableWidth, drawableHeight},
        contentRect
    );

    ViewportState viewport{};
    viewport.physical.displaySize = {
        positiveDimension(config.physicalDisplaySize.width),
        positiveDimension(config.physicalDisplaySize.height)
    };
    viewport.physical.windowBounds = {
        config.physicalWindowBounds.x,
        config.physicalWindowBounds.y,
        std::max(config.physicalWindowBounds.width, 0),
        std::max(config.physicalWindowBounds.height, 0)
    };
    viewport.physical.dpiScale = positiveFiniteOr(config.dpiScale, 1.0F, 16.0F);

    viewport.drawable.size = {drawableWidth, drawableHeight};
    viewport.drawable.contentRect = contentRect;
    viewport.drawable.safeArea = contentSafeArea;
    viewport.drawable.worldRenderTargetSize = {contentWidth, contentHeight};
    viewport.drawable.worldRenderScale = 1.0F;

    viewport.logicalUi.size = {
        finiteFloat(logicalWidth),
        finiteFloat(logicalHeight)
    };
    viewport.logicalUi.contentRect = {
        0.0F,
        0.0F,
        finiteFloat(logicalWidth),
        finiteFloat(logicalHeight)
    };
    viewport.logicalUi.drawablePixelsPerLogicalUnitX = logicalScale;
    viewport.logicalUi.drawablePixelsPerLogicalUnitY = logicalScale;
    viewport.logicalUi.uiScale = positiveFiniteOr(
        finiteFloat(layout.viewport.uiScale),
        1.0F,
        16.0F
    );
    viewport.logicalUi.safeArea = {
        finiteFloat(layout.viewport.logicalSafeArea.left),
        finiteFloat(layout.viewport.logicalSafeArea.top),
        finiteFloat(layout.viewport.logicalSafeArea.right),
        finiteFloat(layout.viewport.logicalSafeArea.bottom)
    };

    const float worldScale = logicalScale;
    const float inverseWorldScale = 1.0F / worldScale;
    const float worldOffsetX = static_cast<float>(contentRect.x);
    const float worldOffsetY = static_cast<float>(contentRect.y);
    viewport.world.visibleBounds = {
        0.0F,
        0.0F,
        finiteFloat(logicalWidth),
        finiteFloat(logicalHeight)
    };
    viewport.world.drawablePixelsPerWorldUnit = worldScale;
    viewport.world.worldToDrawable.elements = {
        worldScale, 0.0F, worldOffsetX,
        0.0F, worldScale, worldOffsetY,
        0.0F, 0.0F, 1.0F
    };
    viewport.world.drawableToWorld.elements = {
        inverseWorldScale, 0.0F, -worldOffsetX * inverseWorldScale,
        0.0F, inverseWorldScale, -worldOffsetY * inverseWorldScale,
        0.0F, 0.0F, 1.0F
    };
    viewport.world.projectionRevision = config.projectionRevision;
    return viewport;
}

TitleSceneResult buildTitleScene(
    FramePacket& packet,
    const TitleSceneInput& input,
    const TitleSceneConfig& config
) {
    const FramePacketCapacity requiredCapacity = titleSceneCapacity(input);
    const TitleSceneMissingCapabilities missingCapabilities =
        missingCapabilitiesFor(input);
    FrameMetadata metadata{};
    metadata.frameId = config.frameId;
    metadata.simulationTick = config.simulationTick;
    metadata.presentationTimeSeconds = std::isfinite(config.presentationTimeSeconds)
            && config.presentationTimeSeconds >= 0.0
        ? config.presentationTimeSeconds
        : input.uiState.title.elapsedSeconds;
    metadata.interpolationAlpha = static_cast<float>(clampUnit(
        config.interpolationAlpha
    ));
    metadata.clearColor = renderColor(title_letterbox_clear_color);

    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    if (!builder.begin(metadata, makeTitleViewport(input.layout, config))) {
        return failedResult(
            builder.error(),
            missingCapabilities,
            requiredCapacity
        );
    }
    if (!inputCanBuild(input)) {
        builder.abort();
        return failedResult(
            FrameBuildError::structurallyInvalid,
            missingCapabilities,
            requiredCapacity
        );
    }
    if (!packet.hasCapacityFor(requiredCapacity)) {
        builder.abort();
        return failedResult(
            FrameBuildError::capacityExceeded,
            missingCapabilities,
            requiredCapacity
        );
    }
    if (!addBaseTitleShell(builder, input)
        || !addOverlayShells(builder, input, config)) {
        const FrameBuildError error = builder.error() == FrameBuildError::none
            ? FrameBuildError::structurallyInvalid
            : builder.error();
        builder.abort();
        return failedResult(
            error,
            missingCapabilities,
            requiredCapacity
        );
    }
    if (!builder.finish()) {
        return failedResult(
            builder.error(),
            missingCapabilities,
            requiredCapacity
        );
    }
    if (packet.size() != requiredCapacity) {
        packet.clear();
        return failedResult(
            FrameBuildError::structurallyInvalid,
            missingCapabilities,
            requiredCapacity
        );
    }
    return {
        true,
        FrameBuildError::none,
        missingCapabilities,
        requiredCapacity,
        commandStatsFor(input, requiredCapacity)
    };
}

} // namespace cirvivor::render::frontend
