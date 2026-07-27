#include "render/frontend/title_overlay_presenter.h"

#include "render/text/title_text_catalog.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace cirvivor::render::frontend {
namespace {

constexpr StableElementId panel_id = stableResourceId("title.overlay.content.panel");
constexpr StableElementId control_id = stableResourceId("title.overlay.content.control");
constexpr StableElementId preview_id = stableResourceId("title.overlay.map.preview");

enum class HorizontalAnchor : std::uint8_t {
    left,
    center,
    right
};

enum class VerticalAnchor : std::uint8_t {
    top,
    middle
};

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

[[nodiscard]] RectF renderRect(const ui::layout::RoundedRectD& rect) noexcept {
    return {
        finiteFloat(rect.x),
        finiteFloat(rect.y),
        finiteFloat(rect.width),
        finiteFloat(rect.height)
    };
}

[[nodiscard]] PremultipliedRgba renderColor(
    const ui::layout::ThemeColor color,
    const double alphaScale = 1.0
) noexcept {
    constexpr float byteScale = 1.0F / 255.0F;
    const float alpha = finiteFloat(clampUnit(color.alpha * alphaScale));
    return PremultipliedRgba::fromStraight(
        static_cast<float>(color.red) * byteScale,
        static_cast<float>(color.green) * byteScale,
        static_cast<float>(color.blue) * byteScale,
        alpha
    );
}

[[nodiscard]] StableElementId instanceId(
    const StableElementId base,
    const std::uint32_t sequence,
    const std::uint32_t local = 0U
) noexcept {
    return base
        ^ (static_cast<StableElementId>(sequence) << 32U)
        ^ static_cast<StableElementId>(local + 1U);
}

[[nodiscard]] float typographySize(
    const TitleOverlayPresenterInput& input,
    const ui::layout::TypographyRole role
) noexcept {
    return finiteFloat(
        input.layout.typography[static_cast<std::size_t>(role)].size
        * input.presentation.contentScale
    );
}

[[nodiscard]] bool addText(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input,
    const UiTextSemanticId semantic,
    const float size,
    const Vec2F anchor,
    const HorizontalAnchor horizontal,
    const VerticalAnchor vertical,
    const PremultipliedRgba color
) {
    const PreShapedTextRunView* const run = input.textResources.find(
        text::titleTextKey(semantic, input.locale)
    );
    if (run == nullptr || run->rasterPixelSize == 0U
        || !std::isfinite(size) || !(size > 0.0F)) {
        return false;
    }
    const float scale = size / static_cast<float>(run->rasterPixelSize);
    Vec2F origin = anchor;
    if (horizontal == HorizontalAnchor::center) {
        origin.x -= run->advance * scale * 0.5F;
    } else if (horizontal == HorizontalAnchor::right) {
        origin.x -= run->advance * scale;
    }
    if (vertical == VerticalAnchor::top) {
        origin.y += run->ascent * scale;
    } else {
        origin.y += (run->ascent - run->descent) * scale * 0.5F;
    }
    GlyphRunCommand command{};
    command.header = input.header;
    command.fontId = run->fontId;
    command.glyphAtlasId = run->glyphAtlasId;
    command.origin = origin;
    command.pixelsPerEm = size;
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

[[nodiscard]] const ui::TitleUiTargetInteraction& interactionFor(
    const ui::TitleUiControllerSnapshot& snapshot,
    const ui::TitleUiTarget target
) noexcept {
    for (const ui::TitleUiTargetInteraction& interaction : snapshot.targets) {
        if (interaction.target == target) {
            return interaction;
        }
    }
    return snapshot.targets.front();
}

[[nodiscard]] std::uint16_t interactionFlags(
    const ui::TitleUiTargetInteraction& interaction,
    const bool disabled
) noexcept {
    std::uint16_t flags = disabled
        ? uiStateBits(UiStateFlag::disabled)
        : uiStateBits(UiStateFlag::none);
    if (!disabled && interaction.hovered) {
        flags |= uiStateBits(UiStateFlag::hovered);
    }
    if (!disabled && interaction.pressed) {
        flags |= uiStateBits(UiStateFlag::pressed);
    }
    return flags;
}

[[nodiscard]] bool addPanel(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    UiCommand panel{};
    panel.header = input.header;
    panel.primitive = UiPrimitive::panel;
    panel.elementId = instanceId(panel_id, input.presentation.sequence);
    panel.bounds = renderRect(input.presentation.panelRect);
    panel.cornerRadius = finiteFloat(input.presentation.panelRect.radius);
    panel.borderWidth = 1.0F;
    panel.backgroundColor = renderColor(
        input.theme.overlayPanelBackground,
        input.presentation.alpha
    );
    panel.borderColor = renderColor(
        input.theme.overlayPanelBorder,
        input.presentation.alpha
    );
    panel.accentColor = renderColor(
        input.theme.overlayGlassEdge,
        input.presentation.alpha
    );
    return builder.addUi(panel);
}

[[nodiscard]] bool addDivider(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    ShapeCommand divider{};
    divider.header = input.header;
    divider.shape = ShapeType::rectangle;
    divider.bounds = renderRect(input.presentation.headerDividerRect);
    divider.fill = renderColor(
        input.theme.overlayDivider,
        input.presentation.alpha
    );
    return builder.addShape(divider);
}

[[nodiscard]] bool addControlVisual(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input,
    const ui::TitleOverlayControl& control,
    const std::size_t index
) {
    const bool isCancel = control.action == ui::TitleOverlayControlAction::cancelTop;
    const bool isConfirm = control.action == ui::TitleOverlayControlAction::confirmTop;
    const bool interactive = isCancel || isConfirm;
    const bool matches = input.interaction.overlaySequence
        == input.presentation.sequence;
    const ui::TitleUiTarget target = isConfirm
        ? ui::TitleUiTarget::overlayConfirm
        : ui::TitleUiTarget::overlayCancel;
    const ui::TitleUiTargetInteraction passiveInteraction{};
    const ui::TitleUiTargetInteraction& interaction = interactive
        ? interactionFor(input.interaction, target)
        : passiveInteraction;
    const bool highlighted = interactive && matches && control.enabled
        && (interaction.hovered || interaction.pressed);

    UiCommand command{};
    command.header = input.header;
    command.primitive = interactive ? UiPrimitive::button : UiPrimitive::custom;
    if (control.id == ui::TitleOverlayControlId::deckAchievements
        || control.id == ui::TitleOverlayControlId::deckEncyclopedia) {
        command.primitive = UiPrimitive::progress;
    }
    command.stateFlags = interactive
        ? interactionFlags(
            interaction,
            !control.enabled
                || !input.presentation.acceptsInput
                || input.presentation.interactionsLocked
        )
        : control.enabled
            ? uiStateBits(UiStateFlag::none)
            : uiStateBits(UiStateFlag::disabled);
    if (control.selected) {
        command.stateFlags |= uiStateBits(UiStateFlag::selected);
    }
    command.elementId = instanceId(
        control_id,
        input.presentation.sequence,
        static_cast<std::uint32_t>(index)
    );
    command.bounds = renderRect(control.rect);
    command.cornerRadius = finiteFloat(control.rect.radius);
    command.borderWidth = interactive ? 1.0F : 0.5F;
    command.value = finiteFloat(clampUnit(control.value));
    if (isConfirm) {
        command.backgroundColor = renderColor(
            highlighted ? input.theme.confirmHover : input.theme.confirmIdle,
            input.presentation.alpha
        );
        command.borderColor = renderColor(
            input.theme.confirmHover,
            input.presentation.alpha
        );
        command.accentColor = renderColor(
            input.theme.confirmText,
            input.presentation.alpha
        );
    } else if (isCancel) {
        command.backgroundColor = renderColor(
            highlighted ? input.theme.cancelHover : input.theme.cancelIdle,
            input.presentation.alpha
        );
        command.borderColor = renderColor(
            input.theme.cancelHover,
            input.presentation.alpha
        );
        command.accentColor = renderColor(
            input.theme.cancelText,
            input.presentation.alpha
        );
    } else {
        command.backgroundColor = renderColor(
            input.theme.overlayControlInactive,
            input.presentation.alpha * 0.62
        );
        command.borderColor = renderColor(
            input.theme.overlayControlHover,
            input.presentation.alpha * 0.5
        );
        command.accentColor = renderColor(
            control.selected ? input.theme.toggleActive : input.theme.sliderValueActive,
            input.presentation.alpha
        );
    }
    return builder.addUi(command);
}

[[nodiscard]] const ui::TitleOverlayControl* controlById(
    const ui::TitleOverlayPresentation& presentation,
    const ui::TitleOverlayControlId id
) noexcept {
    const std::size_t count = std::min<std::size_t>(
        presentation.controlCount,
        presentation.controls.size()
    );
    for (std::size_t index = 0U; index < count; ++index) {
        if (presentation.controls[index].id == id) {
            return &presentation.controls[index];
        }
    }
    return nullptr;
}

[[nodiscard]] Vec2F rectCenter(const ui::layout::RoundedRectD& rect) noexcept {
    return {
        finiteFloat(rect.x + (rect.width * 0.5)),
        finiteFloat(rect.y + (rect.height * 0.5))
    };
}

[[nodiscard]] bool addFooterText(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    const std::size_t count = std::min<std::size_t>(
        input.presentation.controlCount,
        input.presentation.controls.size()
    );
    for (std::size_t index = 0U; index < count; ++index) {
        const ui::TitleOverlayControl& control = input.presentation.controls[index];
        UiTextSemanticId semantic{};
        bool footer = true;
        if (control.id == ui::TitleOverlayControlId::close) {
            semantic = input.presentation.kind == ui::OverlayKind::debug
                ? UiTextSemanticId::debugClose
                : UiTextSemanticId::overlayClose;
        } else if (control.id == ui::TitleOverlayControlId::cancel) {
            switch (input.presentation.kind) {
            case ui::OverlayKind::mapSelect:
                semantic = UiTextSemanticId::mapCancel;
                break;
            case ui::OverlayKind::setting:
                semantic = UiTextSemanticId::settingsCancel;
                break;
            case ui::OverlayKind::exitConfirm:
                semantic = UiTextSemanticId::exitNo;
                break;
            case ui::OverlayKind::externalLinkWarning:
                semantic = UiTextSemanticId::externalNo;
                break;
            default:
                footer = false;
                break;
            }
        } else if (control.id == ui::TitleOverlayControlId::confirm) {
            switch (input.presentation.kind) {
            case ui::OverlayKind::mapSelect:
                semantic = UiTextSemanticId::mapStart;
                break;
            case ui::OverlayKind::setting:
                semantic = UiTextSemanticId::settingsSave;
                break;
            case ui::OverlayKind::exitConfirm:
                semantic = UiTextSemanticId::exitYes;
                break;
            case ui::OverlayKind::externalLinkWarning:
                semantic = UiTextSemanticId::externalYes;
                break;
            default:
                footer = false;
                break;
            }
        } else if (control.id == ui::TitleOverlayControlId::debugOpenDevTools) {
            semantic = UiTextSemanticId::debugDevTools;
        } else {
            footer = false;
        }
        const ui::layout::ThemeColor textColor =
            control.action == ui::TitleOverlayControlAction::confirmTop
            ? input.theme.confirmText
            : control.action == ui::TitleOverlayControlAction::cancelTop
                ? input.theme.cancelText
                : input.theme.overlayControlText;
        if (footer && !addText(
                builder,
                input,
                semantic,
                typographySize(input, ui::layout::TypographyRole::buttonPrimary),
                rectCenter(control.rect),
                HorizontalAnchor::center,
                VerticalAnchor::middle,
                renderColor(
                    control.enabled ? textColor : input.theme.overlayValueText,
                    input.presentation.alpha * (control.enabled ? 1.0 : 0.5)
                ))) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool addMapPreview(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    constexpr std::array<std::string_view, 5> mask{
        "F.FFF....",
        "F.F.F....",
        "FFFFFFFFF",
        "..F.F...F",
        "..FFF...F"
    };
    const ui::layout::RoundedRectD& preview = input.presentation.mapPreviewRect;
    if (!(preview.width > 0.0) || !(preview.height > 0.0)) {
        return false;
    }
    ShapeCommand background{};
    background.header = input.header;
    background.shape = ShapeType::roundedRectangle;
    background.bounds = renderRect(preview);
    background.cornerRadius = finiteFloat(preview.radius);
    background.strokeEnabled = 1U;
    background.strokeWidth = 2.0F;
    background.fill = renderColor(
        input.theme.overlayControlInactive,
        input.presentation.alpha * 0.35
    );
    background.stroke = renderColor(
        input.theme.optionActive,
        input.presentation.alpha
    );
    if (!builder.addShape(background)) {
        return false;
    }

    const double inset = std::min(preview.width, preview.height) * 0.055;
    const double cell = std::min(
        (preview.width - (inset * 2.0)) / 9.0,
        (preview.height - (inset * 2.0)) / 5.0
    );
    const double gridWidth = cell * 9.0;
    const double gridHeight = cell * 5.0;
    const double left = preview.x + ((preview.width - gridWidth) * 0.5);
    const double top = preview.y + ((preview.height - gridHeight) * 0.5);
    std::uint32_t local = 0U;
    for (std::size_t row = 0U; row < mask.size(); ++row) {
        for (std::size_t column = 0U; column < mask[row].size(); ++column) {
            if (mask[row][column] != 'F') {
                continue;
            }
            ShapeCommand floor{};
            floor.header = input.header;
            floor.shape = ShapeType::rectangle;
            floor.bounds = {
                finiteFloat(left + (static_cast<double>(column) * cell)),
                finiteFloat(top + (static_cast<double>(row) * cell)),
                finiteFloat(cell),
                finiteFloat(cell)
            };
            floor.fill = renderColor(
                input.theme.optionActive,
                input.presentation.alpha * 0.28
            );
            if (!builder.addShape(floor)) {
                return false;
            }
            ++local;
        }
    }
    for (std::size_t column = 0U; column <= 9U; ++column) {
        LineCommand line{};
        line.header = input.header;
        line.start = {
            finiteFloat(left + (static_cast<double>(column) * cell)),
            finiteFloat(top)
        };
        line.end = {line.start.x, finiteFloat(top + gridHeight)};
        line.width = 1.0F;
        line.color = renderColor(
            input.theme.optionActive,
            input.presentation.alpha * 0.16
        );
        if (!builder.addLine(line)) {
            return false;
        }
    }
    for (std::size_t row = 0U; row <= 5U; ++row) {
        LineCommand line{};
        line.header = input.header;
        line.start = {
            finiteFloat(left),
            finiteFloat(top + (static_cast<double>(row) * cell))
        };
        line.end = {finiteFloat(left + gridWidth), line.start.y};
        line.width = 1.0F;
        line.color = renderColor(
            input.theme.optionActive,
            input.presentation.alpha * 0.16
        );
        if (!builder.addLine(line)) {
            return false;
        }
    }
    static_cast<void>(local);
    return true;
}

[[nodiscard]] UiTextSemanticId titleSemantic(const ui::OverlayKind kind) noexcept {
    switch (kind) {
    case ui::OverlayKind::mapSelect:
        return UiTextSemanticId::mapSelectTitle;
    case ui::OverlayKind::deck:
        return UiTextSemanticId::deckTitle;
    case ui::OverlayKind::setting:
        return UiTextSemanticId::settingsTitle;
    case ui::OverlayKind::credits:
        return UiTextSemanticId::creditsTitle;
    case ui::OverlayKind::quickStart:
        return UiTextSemanticId::quickStartTitle;
    case ui::OverlayKind::records:
        return UiTextSemanticId::recordsTitle;
    case ui::OverlayKind::research:
        return UiTextSemanticId::researchTitle;
    case ui::OverlayKind::achievements:
        return UiTextSemanticId::achievementsTitle;
    case ui::OverlayKind::debug:
        return UiTextSemanticId::debugTitle;
    case ui::OverlayKind::exitConfirm:
        return UiTextSemanticId::exitTitle;
    case ui::OverlayKind::externalLinkWarning:
        return UiTextSemanticId::externalTitle;
    case ui::OverlayKind::none:
        return UiTextSemanticId::overlayClose;
    }
    return UiTextSemanticId::overlayClose;
}

[[nodiscard]] bool addTitle(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    const float size = typographySize(
        input,
        input.presentation.kind == ui::OverlayKind::debug
                || input.presentation.kind == ui::OverlayKind::exitConfirm
                || input.presentation.kind == ui::OverlayKind::externalLinkWarning
            ? ui::layout::TypographyRole::h2
            : ui::layout::TypographyRole::h1
    );
    return addText(
        builder,
        input,
        titleSemantic(input.presentation.kind),
        size,
        {
            finiteFloat(input.presentation.headerDividerRect.x),
            finiteFloat(input.presentation.panelRect.y
                + input.layout.overlayPage.titleTop
                    * input.presentation.contentScale)
        },
        HorizontalAnchor::left,
        VerticalAnchor::top,
        renderColor(input.theme.titleText, input.presentation.alpha)
    );
}

[[nodiscard]] bool addMapContent(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    const auto& body = input.presentation.bodyRect;
    const double nameY = body.y;
    const double descriptionY = input.presentation.mapPreviewRect.y
        + input.presentation.mapPreviewRect.height
        + (body.height * 0.035);
    return addText(
               builder,
               input,
               UiTextSemanticId::mapName,
               typographySize(input, ui::layout::TypographyRole::h3),
               {finiteFloat(body.x), finiteFloat(nameY)},
               HorizontalAnchor::left,
               VerticalAnchor::top,
               renderColor(input.theme.titleText, input.presentation.alpha)
           )
        && addText(
            builder,
            input,
            UiTextSemanticId::mapSelected,
            typographySize(input, ui::layout::TypographyRole::h5),
            {finiteFloat(body.x + body.width), finiteFloat(nameY)},
            HorizontalAnchor::right,
            VerticalAnchor::top,
            renderColor(input.theme.optionActive, input.presentation.alpha)
        )
        && addMapPreview(builder, input)
        && addText(
            builder,
            input,
            UiTextSemanticId::mapDescription,
            typographySize(input, ui::layout::TypographyRole::h5),
            {finiteFloat(body.x), finiteFloat(descriptionY)},
            HorizontalAnchor::left,
            VerticalAnchor::top,
            renderColor(input.theme.overlayItemText, input.presentation.alpha)
        );
}

[[nodiscard]] bool addDummyContent(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    UiTextSemanticId body = UiTextSemanticId::quickStartBody;
    switch (input.presentation.kind) {
    case ui::OverlayKind::records:
        body = UiTextSemanticId::recordsBody;
        break;
    case ui::OverlayKind::research:
        body = UiTextSemanticId::researchBody;
        break;
    case ui::OverlayKind::achievements:
        body = UiTextSemanticId::achievementsBody;
        break;
    default:
        break;
    }
    const auto& rect = input.presentation.bodyRect;
    return addText(
               builder,
               input,
               UiTextSemanticId::comingSoon,
               typographySize(input, ui::layout::TypographyRole::h3),
               {finiteFloat(rect.x), finiteFloat(rect.y)},
               HorizontalAnchor::left,
               VerticalAnchor::top,
               renderColor(input.theme.optionActive, input.presentation.alpha)
           )
        && addText(
            builder,
            input,
            body,
            typographySize(input, ui::layout::TypographyRole::h5),
            {finiteFloat(rect.x), finiteFloat(rect.y + rect.height * 0.18)},
            HorizontalAnchor::left,
            VerticalAnchor::top,
            renderColor(input.theme.overlayItemText, input.presentation.alpha)
        );
}

[[nodiscard]] bool addDeckContent(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    constexpr std::array ids{
        ui::TitleOverlayControlId::deckAchievements,
        ui::TitleOverlayControlId::deckEncyclopedia
    };
    constexpr std::array semantics{
        UiTextSemanticId::deckAchievements,
        UiTextSemanticId::deckEncyclopedia
    };
    for (std::size_t index = 0U; index < ids.size(); ++index) {
        const ui::TitleOverlayControl* const control = controlById(
            input.presentation,
            ids[index]
        );
        if (control == nullptr) {
            return false;
        }
        const auto& rect = control->rect;
        const Vec2F center = rectCenter(rect);
        ShapeCommand icon{};
        icon.header = input.header;
        icon.shape = index == 0U ? ShapeType::pentagon : ShapeType::roundedRectangle;
        icon.bounds = {
            center.x - finiteFloat(rect.width * 0.08),
            finiteFloat(rect.y + rect.height * 0.16),
            finiteFloat(rect.width * 0.16),
            finiteFloat(rect.height * 0.18)
        };
        icon.cornerRadius = finiteFloat(rect.radius * 0.4);
        icon.fill = renderColor(input.theme.optionActive, input.presentation.alpha);
        if (!builder.addShape(icon)
            || !addText(
                builder,
                input,
                semantics[index],
                typographySize(input, ui::layout::TypographyRole::h3),
                {center.x, finiteFloat(rect.y + rect.height * 0.42)},
                HorizontalAnchor::center,
                VerticalAnchor::top,
                renderColor(input.theme.overlayItemText, input.presentation.alpha)
            )) {
            return false;
        }
        UiCommand progress{};
        progress.header = input.header;
        progress.primitive = UiPrimitive::progress;
        progress.elementId = instanceId(
            preview_id,
            input.presentation.sequence,
            static_cast<std::uint32_t>(index)
        );
        progress.bounds = {
            finiteFloat(rect.x + rect.width * 0.15),
            finiteFloat(rect.y + rect.height * 0.66),
            finiteFloat(rect.width * 0.70),
            finiteFloat(std::max(2.0, rect.height * 0.025))
        };
        progress.cornerRadius = progress.bounds.height * 0.5F;
        progress.value = 0.0F;
        progress.backgroundColor = renderColor(
            input.theme.overlayItemText,
            input.presentation.alpha * 0.35
        );
        progress.accentColor = renderColor(
            input.theme.optionActive,
            input.presentation.alpha
        );
        if (!builder.addUi(progress)
            || !addText(
                builder,
                input,
                UiTextSemanticId::deckZeroPercent,
                typographySize(input, ui::layout::TypographyRole::progressValue),
                {center.x, finiteFloat(rect.y + rect.height * 0.73)},
                HorizontalAnchor::center,
                VerticalAnchor::top,
                renderColor(input.theme.optionActiveText, input.presentation.alpha)
            )) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] UiTextSemanticId settingsSemantic(
    const ui::TitleOverlayControlId id
) noexcept {
    switch (id) {
    case ui::TitleOverlayControlId::settingWindowMode:
        return UiTextSemanticId::settingWindowMode;
    case ui::TitleOverlayControlId::settingUltrawide:
        return UiTextSemanticId::settingUltrawide;
    case ui::TitleOverlayControlId::settingRenderScale:
        return UiTextSemanticId::settingRenderScale;
    case ui::TitleOverlayControlId::settingUiScale:
        return UiTextSemanticId::settingUiScale;
    case ui::TitleOverlayControlId::settingOpaqueUi:
        return UiTextSemanticId::settingOpaqueUi;
    case ui::TitleOverlayControlId::settingBenchmark:
        return UiTextSemanticId::settingBenchmark;
    case ui::TitleOverlayControlId::settingLanguage:
        return UiTextSemanticId::settingLanguage;
    case ui::TitleOverlayControlId::settingTheme:
        return UiTextSemanticId::settingTheme;
    case ui::TitleOverlayControlId::settingTooltipDelay:
        return UiTextSemanticId::settingTooltipDelay;
    case ui::TitleOverlayControlId::settingBgm:
        return UiTextSemanticId::settingBgm;
    case ui::TitleOverlayControlId::settingSfx:
        return UiTextSemanticId::settingSfx;
    case ui::TitleOverlayControlId::settingKeybindings:
        return UiTextSemanticId::settingKeybindings;
    default:
        return UiTextSemanticId::settingsTitle;
    }
}

[[nodiscard]] bool addSettingsContent(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    const auto& body = input.presentation.bodyRect;
    if (!addText(
            builder,
            input,
            UiTextSemanticId::settingsDisplaySection,
            typographySize(input, ui::layout::TypographyRole::h4),
            {finiteFloat(body.x), finiteFloat(body.y)},
            HorizontalAnchor::left,
            VerticalAnchor::top,
            renderColor(input.theme.overlaySectionText, input.presentation.alpha)
        )
        || !addText(
            builder,
            input,
            UiTextSemanticId::settingsUiSection,
            typographySize(input, ui::layout::TypographyRole::h4),
            {finiteFloat(body.x + body.width * 0.53), finiteFloat(body.y)},
            HorizontalAnchor::left,
            VerticalAnchor::top,
            renderColor(input.theme.overlaySectionText, input.presentation.alpha)
        )) {
        return false;
    }
    const std::size_t count = std::min<std::size_t>(
        input.presentation.controlCount,
        input.presentation.controls.size()
    );
    for (std::size_t index = 0U; index < count; ++index) {
        const ui::TitleOverlayControl& control = input.presentation.controls[index];
        if (control.id < ui::TitleOverlayControlId::settingWindowMode
            || control.id > ui::TitleOverlayControlId::settingKeybindings) {
            continue;
        }
        if (!addText(
                builder,
                input,
                settingsSemantic(control.id),
                typographySize(input, ui::layout::TypographyRole::control),
                {
                    finiteFloat(control.rect.x + control.rect.width * 0.03),
                    finiteFloat(control.rect.y + control.rect.height * 0.20)
                },
                HorizontalAnchor::left,
                VerticalAnchor::top,
                renderColor(input.theme.overlayControlText, input.presentation.alpha))) {
            return false;
        }
    }
    const std::array descriptionSpecs{
        std::pair{ui::TitleOverlayControlId::settingUltrawide, UiTextSemanticId::settingUltrawideDescription},
        std::pair{ui::TitleOverlayControlId::settingRenderScale, UiTextSemanticId::settingRenderScaleDescription},
        std::pair{ui::TitleOverlayControlId::settingUiScale, UiTextSemanticId::settingUiScaleDescription},
        std::pair{ui::TitleOverlayControlId::settingOpaqueUi, UiTextSemanticId::settingOpaqueUiDescription},
        std::pair{ui::TitleOverlayControlId::settingTooltipDelay, UiTextSemanticId::settingTooltipDelayDescription}
    };
    for (const auto& [id, semantic] : descriptionSpecs) {
        const ui::TitleOverlayControl* const control = controlById(
            input.presentation,
            id
        );
        if (control != nullptr && !addText(
                builder,
                input,
                semantic,
                typographySize(input, ui::layout::TypographyRole::settingsDescription),
                {
                    finiteFloat(control->rect.x + control->rect.width * 0.03),
                    finiteFloat(control->rect.y + control->rect.height * 0.58)
                },
                HorizontalAnchor::left,
                VerticalAnchor::top,
                renderColor(input.theme.overlayValueText, input.presentation.alpha))) {
            return false;
        }
    }
    const ui::TitleOverlayControl* const bgm = controlById(
        input.presentation,
        ui::TitleOverlayControlId::settingBgm
    );
    const ui::TitleOverlayControl* const keys = controlById(
        input.presentation,
        ui::TitleOverlayControlId::settingKeybindings
    );
    return (bgm == nullptr || addText(
                builder,
                input,
                UiTextSemanticId::settingsSoundSection,
                typographySize(input, ui::layout::TypographyRole::h4),
                {finiteFloat(bgm->rect.x), finiteFloat(bgm->rect.y - bgm->rect.height * 0.12)},
                HorizontalAnchor::left,
                VerticalAnchor::top,
                renderColor(input.theme.overlaySectionText, input.presentation.alpha)
            ))
        && (keys == nullptr || addText(
            builder,
            input,
            UiTextSemanticId::settingsControlsSection,
            typographySize(input, ui::layout::TypographyRole::h4),
            {finiteFloat(keys->rect.x), finiteFloat(keys->rect.y - keys->rect.height * 0.12)},
            HorizontalAnchor::left,
            VerticalAnchor::top,
            renderColor(input.theme.overlaySectionText, input.presentation.alpha)
        ));
}

[[nodiscard]] UiTextSemanticId creditsSemantic(
    const ui::TitleOverlayControlId id
) noexcept {
    switch (id) {
    case ui::TitleOverlayControlId::creditsBlog:
        return UiTextSemanticId::creditsBlog;
    case ui::TitleOverlayControlId::creditsCirvivorGithub:
        return UiTextSemanticId::creditsCirvivor;
    case ui::TitleOverlayControlId::creditsPretendardGithub:
        return UiTextSemanticId::creditsPretendard;
    case ui::TitleOverlayControlId::creditsOutfitGithub:
        return UiTextSemanticId::creditsOutfit;
    case ui::TitleOverlayControlId::creditsReactBitsGithub:
        return UiTextSemanticId::creditsReactBits;
    default:
        return UiTextSemanticId::creditsTitle;
    }
}

[[nodiscard]] bool addCreditsContent(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    const auto& body = input.presentation.bodyRect;
    if (!addText(
            builder,
            input,
            UiTextSemanticId::creditsMadeBy,
            typographySize(input, ui::layout::TypographyRole::h4),
            {finiteFloat(body.x), finiteFloat(body.y)},
            HorizontalAnchor::left,
            VerticalAnchor::top,
            renderColor(input.theme.overlaySectionText, input.presentation.alpha))) {
        return false;
    }
    const std::size_t count = std::min<std::size_t>(
        input.presentation.controlCount,
        input.presentation.controls.size()
    );
    std::size_t linkIndex = 0U;
    for (std::size_t index = 0U; index < count; ++index) {
        const ui::TitleOverlayControl& control = input.presentation.controls[index];
        if (control.id < ui::TitleOverlayControlId::creditsBlog
            || control.id > ui::TitleOverlayControlId::creditsReactBitsGithub) {
            continue;
        }
        if (linkIndex == 2U && !addText(
                builder,
                input,
                UiTextSemanticId::creditsAssets,
                typographySize(input, ui::layout::TypographyRole::h4),
                {finiteFloat(control.rect.x), finiteFloat(control.rect.y)},
                HorizontalAnchor::left,
                VerticalAnchor::top,
                renderColor(input.theme.overlaySectionText, input.presentation.alpha))) {
            return false;
        }
        if (!addText(
                builder,
                input,
                creditsSemantic(control.id),
                typographySize(input, ui::layout::TypographyRole::control),
                {
                    finiteFloat(control.rect.x + control.rect.width * 0.04),
                    finiteFloat(control.rect.y + control.rect.height * 0.32)
                },
                HorizontalAnchor::left,
                VerticalAnchor::top,
                renderColor(input.theme.linkText, input.presentation.alpha))) {
            return false;
        }
        ++linkIndex;
    }
    return true;
}

[[nodiscard]] UiTextSemanticId debugSemantic(
    const ui::TitleOverlayControlId id
) noexcept {
    switch (id) {
    case ui::TitleOverlayControlId::debugFrameTime:
        return UiTextSemanticId::debugFrameTime;
    case ui::TitleOverlayControlId::debugPoolInfo:
        return UiTextSemanticId::debugPoolInfo;
    case ui::TitleOverlayControlId::debugHitboxes:
        return UiTextSemanticId::debugHitboxes;
    case ui::TitleOverlayControlId::debugAnimation:
        return UiTextSemanticId::debugAnimation;
    default:
        return UiTextSemanticId::debugTitle;
    }
}

[[nodiscard]] bool addDebugContent(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    const std::size_t count = std::min<std::size_t>(
        input.presentation.controlCount,
        input.presentation.controls.size()
    );
    double hintY = input.presentation.bodyRect.y;
    for (std::size_t index = 0U; index < count; ++index) {
        const ui::TitleOverlayControl& control = input.presentation.controls[index];
        if (control.id < ui::TitleOverlayControlId::debugFrameTime
            || control.id > ui::TitleOverlayControlId::debugAnimation) {
            continue;
        }
        if (!addText(
                builder,
                input,
                debugSemantic(control.id),
                typographySize(input, ui::layout::TypographyRole::control),
                {
                    finiteFloat(control.rect.x + control.rect.width * 0.04),
                    finiteFloat(control.rect.y + control.rect.height * 0.3)
                },
                HorizontalAnchor::left,
                VerticalAnchor::top,
                renderColor(input.theme.overlayControlText, input.presentation.alpha))) {
            return false;
        }
        hintY = std::max(hintY, control.rect.y + control.rect.height);
    }
    return addText(
        builder,
        input,
        UiTextSemanticId::debugHint,
        typographySize(input, ui::layout::TypographyRole::settingsDescription),
        {finiteFloat(input.presentation.bodyRect.x), finiteFloat(hintY + input.presentation.bodyRect.height * 0.035)},
        HorizontalAnchor::left,
        VerticalAnchor::top,
        renderColor(input.theme.overlayValueText, input.presentation.alpha)
    );
}

[[nodiscard]] bool addDialogBody(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    const bool exit = input.presentation.kind == ui::OverlayKind::exitConfirm;
    const UiTextSemanticId semantic = exit
        ? UiTextSemanticId::exitBody
        : UiTextSemanticId::externalBody;
    if (!addText(
            builder,
            input,
            semantic,
            typographySize(input, ui::layout::TypographyRole::h4),
            {
                finiteFloat(input.presentation.bodyRect.x),
                finiteFloat(input.presentation.bodyRect.y)
            },
            HorizontalAnchor::left,
            VerticalAnchor::top,
            renderColor(input.theme.overlayItemText, input.presentation.alpha))) {
        return false;
    }
    if (exit) {
        return true;
    }
    UiTextSemanticId urlSemantic{};
    if (!text::titleExternalUrlSemantic(input.overlay.externalUrl.view(), urlSemantic)) {
        return true;
    }
    return addText(
        builder,
        input,
        urlSemantic,
        typographySize(input, ui::layout::TypographyRole::linkPreview),
        {
            finiteFloat(input.presentation.bodyRect.x),
            finiteFloat(input.presentation.bodyRect.y + input.presentation.bodyRect.height * 0.42)
        },
        HorizontalAnchor::left,
        VerticalAnchor::top,
        renderColor(input.theme.linkText, input.presentation.alpha)
    );
}

} // namespace

bool addTitleOverlayPresentation(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
) {
    if (!input.textResources.isValid()
        || input.presentation.kind != input.overlay.kind
        || input.presentation.sequence != input.overlay.sequence
        || input.presentation.controlCount > input.presentation.controls.size()) {
        return false;
    }
    if (!addPanel(builder, input) || !addDivider(builder, input)) {
        return false;
    }
    for (std::size_t index = 0U; index < input.presentation.controlCount; ++index) {
        if (!addControlVisual(
                builder,
                input,
                input.presentation.controls[index],
                index)) {
            return false;
        }
    }
    if (!addTitle(builder, input)) {
        return false;
    }

    bool bodyAdded = false;
    switch (input.presentation.kind) {
    case ui::OverlayKind::mapSelect:
        bodyAdded = addMapContent(builder, input);
        break;
    case ui::OverlayKind::deck:
        bodyAdded = addDeckContent(builder, input);
        break;
    case ui::OverlayKind::setting:
        bodyAdded = addSettingsContent(builder, input);
        break;
    case ui::OverlayKind::credits:
        bodyAdded = addCreditsContent(builder, input);
        break;
    case ui::OverlayKind::quickStart:
    case ui::OverlayKind::records:
    case ui::OverlayKind::research:
    case ui::OverlayKind::achievements:
        bodyAdded = addDummyContent(builder, input);
        break;
    case ui::OverlayKind::debug:
        bodyAdded = addDebugContent(builder, input);
        break;
    case ui::OverlayKind::exitConfirm:
    case ui::OverlayKind::externalLinkWarning:
        bodyAdded = addDialogBody(builder, input);
        break;
    case ui::OverlayKind::none:
        return false;
    }
    return bodyAdded && addFooterText(builder, input);
}

} // namespace cirvivor::render::frontend
