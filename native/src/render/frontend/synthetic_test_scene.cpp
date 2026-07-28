#include "render/frontend/synthetic_test_scene.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace cirvivor::render::frontend {

namespace {

inline constexpr ResourceId checker_texture = stableResourceId("synthetic/checker");
inline constexpr ResourceId actor_texture = stableResourceId("synthetic/actor");
inline constexpr ResourceId ui_font = stableResourceId("synthetic/font/ui");
inline constexpr StableElementId status_panel_id = stableResourceId("synthetic/ui/status-panel");
inline constexpr StableElementId overlay_session_id = stableResourceId("synthetic/overlay/session");
inline constexpr StableElementId overlay_button_id = stableResourceId("synthetic/overlay/button");

[[nodiscard]] CommandHeader makeHeader(
    const RenderLayer layer,
    const CoordinateSpace coordinateSpace,
    const BlendMode blendMode = BlendMode::premultipliedAlpha,
    const std::int32_t layerOrder = 0
) noexcept {
    return {layer, coordinateSpace, blendMode, 0, layerOrder, 0};
}

[[nodiscard]] float deterministicPulse(const std::uint32_t phaseStep) noexcept {
    const std::uint32_t phase = phaseStep % 120U;
    const std::uint32_t triangle = phase <= 60U ? phase : 120U - phase;
    return static_cast<float>(triangle) / 60.0F;
}

[[nodiscard]] std::uint32_t nextSyntheticRandom(std::uint32_t& state) noexcept {
    state = state * 1'664'525U + 1'013'904'223U;
    return state;
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

[[nodiscard]] std::int32_t scaledDimension(
    const std::int32_t dimension,
    const float scale
) noexcept {
    const double scaled = static_cast<double>(dimension) * static_cast<double>(scale);
    const double maximum = static_cast<double>(std::numeric_limits<std::int32_t>::max());
    return scaled >= maximum
        ? std::numeric_limits<std::int32_t>::max()
        : std::max(static_cast<std::int32_t>(scaled), 1);
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

    InsetsI result;
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

[[nodiscard]] SyntheticSceneResult resultFrom(const FramePacketBuilder& builder) noexcept {
    return {builder.error() == FrameBuildError::none, builder.error()};
}

} // namespace

FramePacketCapacity syntheticTestSceneCapacity(
    const GlobalDebugOverlayInput& globalDebugOverlay
) noexcept {
    return additiveFramePacketCapacity(
        syntheticTestSceneCapacity(),
        globalDebugOverlayCapacity(globalDebugOverlay)
    );
}

ViewportState makeSyntheticViewport(const SyntheticSceneConfig& config) noexcept {
    const std::int32_t drawableWidth = std::max(config.drawableSize.width, 1);
    const std::int32_t drawableHeight = std::max(config.drawableSize.height, 1);
    constexpr float logicalWidth = 1'920.0F;
    constexpr float logicalHeight = 1'080.0F;
    constexpr float worldWidth = 32.0F;
    constexpr float worldHeight = 18.0F;

    const bool widthLimited = static_cast<std::int64_t>(drawableWidth) * 1'080
        <= static_cast<std::int64_t>(drawableHeight) * 1'920;
    const std::int32_t contentWidth = widthLimited
        ? drawableWidth
        : std::max(
            static_cast<std::int32_t>(
                static_cast<std::int64_t>(drawableHeight) * 1'920 / 1'080
            ),
            1
        );
    const std::int32_t contentHeight = widthLimited
        ? std::max(
            static_cast<std::int32_t>(
                static_cast<std::int64_t>(drawableWidth) * 1'080 / 1'920
            ),
            1
        )
        : drawableHeight;
    const double logicalScaleDouble = std::min(
        static_cast<double>(contentWidth) / static_cast<double>(logicalWidth),
        static_cast<double>(contentHeight) / static_cast<double>(logicalHeight)
    );
    const float logicalScale = static_cast<float>(logicalScaleDouble);
    const RectI contentRect{
        (drawableWidth - contentWidth) / 2,
        (drawableHeight - contentHeight) / 2,
        contentWidth,
        contentHeight
    };
    const InsetsI contentSafeArea = mapSafeAreaToContent(
        config.safeArea,
        {drawableWidth, drawableHeight},
        contentRect
    );

    const float worldScale = logicalScale * (logicalWidth / worldWidth);
    const float worldOffsetX = static_cast<float>(contentRect.x)
        + (static_cast<float>(contentRect.width) - worldWidth * worldScale) * 0.5F;
    const float worldOffsetY = static_cast<float>(contentRect.y)
        + (static_cast<float>(contentRect.height) - worldHeight * worldScale) * 0.5F;
    const float inverseWorldScale = 1.0F / worldScale;
    const float renderScale = positiveFiniteOr(config.worldRenderScale, 1.0F, 4.0F);

    ViewportState viewport;
    viewport.physical.displaySize = config.physicalDisplaySize;
    viewport.physical.windowBounds = config.physicalWindowBounds;
    viewport.physical.dpiScale = positiveFiniteOr(config.dpiScale, 1.0F, 16.0F);

    viewport.drawable.size = {drawableWidth, drawableHeight};
    viewport.drawable.contentRect = contentRect;
    viewport.drawable.safeArea = contentSafeArea;
    viewport.drawable.worldRenderTargetSize = {
        scaledDimension(contentWidth, renderScale),
        scaledDimension(contentHeight, renderScale)
    };
    viewport.drawable.worldRenderScale = renderScale;

    viewport.logicalUi.size = {logicalWidth, logicalHeight};
    viewport.logicalUi.contentRect = {0.0F, 0.0F, logicalWidth, logicalHeight};
    viewport.logicalUi.drawablePixelsPerLogicalUnitX = logicalScale;
    viewport.logicalUi.drawablePixelsPerLogicalUnitY = logicalScale;
    viewport.logicalUi.uiScale = positiveFiniteOr(config.uiScale, 1.0F, 16.0F);
    viewport.logicalUi.safeArea.left = std::min(
        static_cast<float>(contentSafeArea.left) / logicalScale,
        logicalWidth
    );
    viewport.logicalUi.safeArea.right = std::min(
        static_cast<float>(contentSafeArea.right) / logicalScale,
        logicalWidth - viewport.logicalUi.safeArea.left
    );
    viewport.logicalUi.safeArea.top = std::min(
        static_cast<float>(contentSafeArea.top) / logicalScale,
        logicalHeight
    );
    viewport.logicalUi.safeArea.bottom = std::min(
        static_cast<float>(contentSafeArea.bottom) / logicalScale,
        logicalHeight - viewport.logicalUi.safeArea.top
    );

    viewport.world.visibleBounds = {0.0F, 0.0F, worldWidth, worldHeight};
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

SyntheticSceneResult buildSyntheticTestScene(
    FramePacket& packet,
    const SyntheticSceneConfig& config,
    const PacketCapacityPolicy capacityPolicy,
    const GlobalDebugOverlayInput* const globalDebugOverlay
) {
    FrameMetadata metadata;
    metadata.frameId = config.frameId;
    metadata.simulationTick = config.simulationTick;
    metadata.presentationTimeSeconds = static_cast<double>(config.simulationTick) / 60.0;
    metadata.interpolationAlpha = static_cast<float>(config.phaseStep % 60U) / 60.0F;
    metadata.alphaEncoding = AlphaEncoding::premultiplied;
    metadata.clearColor = PremultipliedRgba::opaque(0.035F, 0.045F, 0.065F);

    FramePacketBuilder builder(packet, capacityPolicy);
    if (!builder.begin(metadata, makeSyntheticViewport(config))) {
        return resultFrom(builder);
    }

    const float pulse = deterministicPulse(config.phaseStep);

    ShapeCommand background;
    background.header = makeHeader(
        RenderLayer::background,
        CoordinateSpace::drawablePixels,
        BlendMode::opaque
    );
    background.bounds = {
        0.0F,
        0.0F,
        static_cast<float>(std::max(config.drawableSize.width, 1)),
        static_cast<float>(std::max(config.drawableSize.height, 1))
    };
    background.fill = PremultipliedRgba::opaque(0.035F, 0.045F, 0.065F);
    if (!builder.addShape(background)) {
        return resultFrom(builder);
    }

    SpriteCommand checker;
    checker.header = makeHeader(RenderLayer::background, CoordinateSpace::world);
    checker.textureId = checker_texture;
    checker.destination = {0.0F, 0.0F, 32.0F, 18.0F};
    checker.tint = PremultipliedRgba::fromStraight(0.24F, 0.31F, 0.42F, 0.42F);
    checker.sampling = SamplingMode::nearest;
    if (!builder.addSprite(checker)) {
        return resultFrom(builder);
    }

    std::uint32_t randomState = config.seed;
    for (std::uint32_t index = 0; index < 5U; ++index) {
        const std::uint32_t randomX = nextSyntheticRandom(randomState);
        const std::uint32_t randomY = nextSyntheticRandom(randomState);
        SpriteCommand actor;
        actor.header = makeHeader(RenderLayer::object, CoordinateSpace::world);
        actor.textureId = actor_texture;
        actor.destination = {
            3.0F + static_cast<float>(randomX % 240U) * 0.1F,
            2.0F + static_cast<float>(randomY % 120U) * 0.1F,
            1.0F,
            1.0F
        };
        actor.rotationRadians = static_cast<float>(index) * 0.125F;
        actor.tint = PremultipliedRgba::fromStraight(
            0.35F + static_cast<float>(index) * 0.08F,
            0.82F,
            1.0F - static_cast<float>(index) * 0.06F,
            0.92F
        );
        if (!builder.addSprite(actor)) {
            return resultFrom(builder);
        }
    }

    ShapeCommand tower;
    tower.header = makeHeader(RenderLayer::object, CoordinateSpace::world);
    tower.shape = ShapeType::hexagon;
    tower.bounds = {15.5F, 8.5F, 1.0F, 1.0F};
    tower.strokeEnabled = 1;
    tower.strokeWidth = 0.06F;
    tower.fill = PremultipliedRgba::opaque(0.16F, 0.72F, 0.92F);
    tower.stroke = PremultipliedRgba::opaque(0.76F, 0.96F, 1.0F);
    if (!builder.addShape(tower)) {
        return resultFrom(builder);
    }

    LineCommand route;
    route.header = makeHeader(RenderLayer::object, CoordinateSpace::world);
    route.start = {2.0F, 14.0F};
    route.end = {30.0F, 4.0F};
    route.width = 0.08F;
    route.cap = LineCap::round;
    route.color = PremultipliedRgba::fromStraight(0.28F, 0.76F, 1.0F, 0.65F);
    if (!builder.addLine(route)) {
        return resultFrom(builder);
    }

    EffectCommand shield;
    shield.header = makeHeader(RenderLayer::effect, CoordinateSpace::world);
    shield.effect = EffectType::magneticShield;
    shield.quality = config.effectQuality;
    shield.bounds = {13.8F, 6.8F, 4.4F, 4.4F};
    shield.origin = {16.0F, 9.0F};
    shield.primaryColor = PremultipliedRgba::fromStraight(0.16F, 0.78F, 1.0F, 0.78F);
    shield.secondaryColor = PremultipliedRgba::fromStraight(0.74F, 0.28F, 1.0F, 0.42F);
    shield.parameters = {pulse, 2.2F, 0.08F, 0.6F, 0.0F, 0.0F, 0.0F, 0.0F};
    if (!builder.addEffect(shield)) {
        return resultFrom(builder);
    }

    EffectCommand mergeBoundary;
    mergeBoundary.header = makeHeader(RenderLayer::effect, CoordinateSpace::world);
    mergeBoundary.effect = EffectType::hexaMergeBoundary;
    mergeBoundary.quality = config.effectQuality;
    mergeBoundary.bounds = {7.0F, 5.0F, 5.0F, 5.0F};
    mergeBoundary.origin = {9.5F, 7.5F};
    mergeBoundary.primaryColor = PremultipliedRgba::fromStraight(1.0F, 0.43F, 0.18F, 0.78F);
    mergeBoundary.parameters = {pulse, 0.12F, 6.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F};
    if (!builder.addEffect(mergeBoundary)) {
        return resultFrom(builder);
    }

    EffectCommand loadingCircle;
    loadingCircle.header = makeHeader(RenderLayer::effect, CoordinateSpace::logicalUi);
    loadingCircle.effect = EffectType::titleLoadingCircle;
    loadingCircle.quality = config.effectQuality;
    loadingCircle.bounds = {844.0F, 424.0F, 232.0F, 232.0F};
    loadingCircle.origin = {960.0F, 540.0F};
    loadingCircle.primaryColor = PremultipliedRgba::fromStraight(0.42F, 0.86F, 1.0F, 0.82F);
    loadingCircle.secondaryColor = PremultipliedRgba::fromStraight(0.72F, 0.34F, 1.0F, 0.46F);
    loadingCircle.parameters = {pulse, 0.72F, 0.14F, 0.04F, 0.0F, 0.0F, 0.0F, 0.0F};
    if (!builder.addEffect(loadingCircle)) {
        return resultFrom(builder);
    }

    TextCommand worldText;
    worldText.header = makeHeader(RenderLayer::textEffect, CoordinateSpace::world);
    worldText.fontId = ui_font;
    worldText.origin = {16.0F, 5.8F};
    worldText.maximumSize = {8.0F, 2.0F};
    worldText.fontSize = 0.72F;
    worldText.lineHeight = 0.9F;
    worldText.color = PremultipliedRgba::fromStraight(0.94F, 0.98F, 1.0F, 0.94F);
    worldText.align = TextAlign::center;
    worldText.baseline = TextBaseline::middle;
    if (!builder.addText(worldText, "SYNTHETIC +42")) {
        return resultFrom(builder);
    }

    UiCommand statusPanel;
    statusPanel.header = makeHeader(RenderLayer::ui, CoordinateSpace::logicalUi);
    statusPanel.primitive = UiPrimitive::progress;
    statusPanel.elementId = status_panel_id;
    statusPanel.bounds = {72.0F, 60.0F, 520.0F, 92.0F};
    statusPanel.cornerRadius = 24.0F;
    statusPanel.borderWidth = 3.0F;
    statusPanel.value = 0.62F + pulse * 0.18F;
    statusPanel.backgroundColor = PremultipliedRgba::fromStraight(0.04F, 0.07F, 0.12F, 0.82F);
    statusPanel.borderColor = PremultipliedRgba::fromStraight(0.35F, 0.82F, 1.0F, 0.72F);
    statusPanel.accentColor = PremultipliedRgba::opaque(0.18F, 0.78F, 0.96F);
    if (!builder.addUi(statusPanel)) {
        return resultFrom(builder);
    }

    TextCommand statusText;
    statusText.header = makeHeader(RenderLayer::ui, CoordinateSpace::logicalUi);
    statusText.fontId = ui_font;
    statusText.origin = {112.0F, 106.0F};
    statusText.maximumSize = {440.0F, 72.0F};
    statusText.fontSize = 34.0F;
    statusText.lineHeight = 42.0F;
    statusText.color = PremultipliedRgba::opaque(0.92F, 0.97F, 1.0F);
    statusText.baseline = TextBaseline::middle;
    if (!builder.addText(statusText, "CORE INTEGRITY 80%")) {
        return resultFrom(builder);
    }

    EffectCommand vignette;
    vignette.header = makeHeader(RenderLayer::vignette, CoordinateSpace::drawablePixels);
    vignette.effect = EffectType::vignette;
    vignette.quality = config.effectQuality;
    vignette.bounds = background.bounds;
    vignette.primaryColor = PremultipliedRgba::fromStraight(0.0F, 0.0F, 0.0F, 0.34F);
    vignette.parameters = {0.62F, 0.24F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F};
    if (!builder.addEffect(vignette)) {
        return resultFrom(builder);
    }

    constexpr std::int32_t overlayOrder = 10;
    const RenderLayerMask backdropLayers = static_cast<RenderLayerMask>(
        renderLayerMask(RenderLayer::background)
        | renderLayerMask(RenderLayer::object)
        | renderLayerMask(RenderLayer::effect)
        | renderLayerMask(RenderLayer::textEffect)
        | renderLayerMask(RenderLayer::ui)
    );

    OverlayCommand beginOverlay;
    beginOverlay.header = makeHeader(
        RenderLayer::dynamicOverlay,
        CoordinateSpace::logicalUi,
        BlendMode::premultipliedAlpha,
        overlayOrder
    );
    beginOverlay.operation = OverlayOperation::beginSession;
    beginOverlay.sessionId = overlay_session_id;
    if (!builder.addOverlay(beginOverlay)) {
        return resultFrom(builder);
    }

    OverlayCommand backdrop = beginOverlay;
    backdrop.operation = OverlayOperation::captureBackdrop;
    backdrop.updateMode = BackdropUpdateMode::dirty;
    backdrop.sourceLayers = backdropLayers;
    backdrop.sourceRevision = config.frameId;
    backdrop.sourceBounds = {420.0F, 190.0F, 1'080.0F, 700.0F};
    backdrop.destinationBounds = backdrop.sourceBounds;
    backdrop.blurRadius = 18.0F;
    if (!builder.addOverlay(backdrop)) {
        return resultFrom(builder);
    }

    OverlayCommand panel = beginOverlay;
    panel.operation = OverlayOperation::glassPanel;
    panel.sourceLayers = backdropLayers;
    panel.sourceRevision = config.frameId;
    panel.sourceBounds = backdrop.sourceBounds;
    panel.destinationBounds = backdrop.destinationBounds;
    panel.opacity = 0.96F;
    panel.blurRadius = 18.0F;
    panel.refractionStrength = config.effectQuality == EffectQuality::softwareReplacement ? 0.0F : 0.015F;
    panel.edgeStrength = 0.55F;
    panel.tintColor = PremultipliedRgba::fromStraight(0.12F, 0.18F, 0.28F, 0.72F);
    panel.edgeColor = PremultipliedRgba::fromStraight(0.68F, 0.9F, 1.0F, 0.55F);
    panel.shadowColor = PremultipliedRgba::fromStraight(0.0F, 0.0F, 0.0F, 0.18F);
    if (!builder.addOverlay(panel)) {
        return resultFrom(builder);
    }

    UiCommand overlayButton;
    overlayButton.header = makeHeader(
        RenderLayer::dynamicOverlay,
        CoordinateSpace::logicalUi,
        BlendMode::premultipliedAlpha,
        overlayOrder
    );
    overlayButton.primitive = UiPrimitive::button;
    overlayButton.stateFlags = uiStateBits(UiStateFlag::focused);
    overlayButton.elementId = overlay_button_id;
    overlayButton.bounds = {730.0F, 690.0F, 460.0F, 116.0F};
    overlayButton.cornerRadius = 30.0F;
    overlayButton.borderWidth = 3.0F;
    overlayButton.backgroundColor = PremultipliedRgba::fromStraight(0.12F, 0.62F, 0.88F, 0.88F);
    overlayButton.borderColor = PremultipliedRgba::fromStraight(0.78F, 0.94F, 1.0F, 0.82F);
    overlayButton.accentColor = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    if (!builder.addUi(overlayButton)) {
        return resultFrom(builder);
    }

    TextCommand overlayTitle;
    overlayTitle.header = makeHeader(
        RenderLayer::dynamicOverlay,
        CoordinateSpace::logicalUi,
        BlendMode::premultipliedAlpha,
        overlayOrder
    );
    overlayTitle.fontId = ui_font;
    overlayTitle.origin = {960.0F, 380.0F};
    overlayTitle.maximumSize = {880.0F, 160.0F};
    overlayTitle.fontSize = 58.0F;
    overlayTitle.lineHeight = 72.0F;
    overlayTitle.color = PremultipliedRgba::opaque(0.94F, 0.98F, 1.0F);
    overlayTitle.align = TextAlign::center;
    overlayTitle.baseline = TextBaseline::middle;
    if (!builder.addText(overlayTitle, "FRAME PACKET V1")) {
        return resultFrom(builder);
    }

    TextCommand overlayButtonText = overlayTitle;
    overlayButtonText.origin = {960.0F, 748.0F};
    overlayButtonText.maximumSize = {420.0F, 96.0F};
    overlayButtonText.fontSize = 38.0F;
    overlayButtonText.lineHeight = 48.0F;
    if (!builder.addText(overlayButtonText, "CONTINUE")) {
        return resultFrom(builder);
    }

    OverlayCommand endOverlay = beginOverlay;
    endOverlay.operation = OverlayOperation::endSession;
    if (!builder.addOverlay(endOverlay)) {
        return resultFrom(builder);
    }

    if (globalDebugOverlay != nullptr
        && !addGlobalDebugOverlay(builder, *globalDebugOverlay)) {
        const FrameBuildError error = builder.error() == FrameBuildError::none
            ? FrameBuildError::structurallyInvalid
            : builder.error();
        builder.abort();
        return {false, error};
    }

    LineCommand topBorder;
    topBorder.header = makeHeader(RenderLayer::top, CoordinateSpace::logicalUi);
    topBorder.start = {36.0F, 1'044.0F};
    topBorder.end = {1'884.0F, 1'044.0F};
    topBorder.width = 4.0F;
    topBorder.cap = LineCap::round;
    topBorder.color = PremultipliedRgba::fromStraight(0.48F, 0.88F, 1.0F, 0.64F);
    if (!builder.addLine(topBorder)) {
        return resultFrom(builder);
    }

    TextCommand topLabel;
    topLabel.header = makeHeader(RenderLayer::top, CoordinateSpace::logicalUi);
    topLabel.fontId = ui_font;
    topLabel.origin = {1'872.0F, 1'024.0F};
    topLabel.maximumSize = {480.0F, 48.0F};
    topLabel.fontSize = 24.0F;
    topLabel.lineHeight = 30.0F;
    topLabel.color = PremultipliedRgba::fromStraight(0.74F, 0.9F, 1.0F, 0.82F);
    topLabel.align = TextAlign::end;
    topLabel.baseline = TextBaseline::bottom;
    if (!builder.addText(topLabel, "SDL-INDEPENDENT SYNTHETIC SCENE")) {
        return resultFrom(builder);
    }

    if (!builder.finish()) {
        return resultFrom(builder);
    }
    return {true, FrameBuildError::none};
}

} // namespace cirvivor::render::frontend
