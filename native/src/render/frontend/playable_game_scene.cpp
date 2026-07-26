#include "render/frontend/playable_game_scene.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>

namespace cirvivor::render::frontend {

namespace {

constexpr float logicalWidth = 1'920.0F;
constexpr float logicalHeight = 1'080.0F;
constexpr float defaultCameraZoom = 0.7F;

[[nodiscard]] CommandHeader makeHeader(
    const RenderLayer layer,
    const CoordinateSpace coordinateSpace,
    const BlendMode blendMode = BlendMode::premultipliedAlpha,
    const std::int32_t layerOrder = 0
) noexcept {
    return {layer, coordinateSpace, blendMode, 0, layerOrder, 0};
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

[[nodiscard]] float normalizedAlpha(const float value) noexcept {
    return std::isfinite(value) ? std::clamp(value, 0.0F, 1.0F) : 0.0F;
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

[[nodiscard]] Vec2F interpolatedBodyPosition(
    const core::BodySoA& bodies,
    const core::BodySoA::Index index,
    const float alpha
) noexcept {
    const core::Vector2 previous = bodies.previousPosition(index);
    const core::Vector2 current = bodies.position(index);
    const double interpolation = static_cast<double>(alpha);
    return {
        static_cast<float>(previous.x + (current.x - previous.x) * interpolation),
        static_cast<float>(previous.y + (current.y - previous.y) * interpolation)
    };
}

[[nodiscard]] std::size_t walkableRunCount(const core::TileMap& tileMap) noexcept {
    std::size_t count = 0;
    for (int row = 0; row < tileMap.rows(); ++row) {
        bool insideRun = false;
        for (int column = 0; column < tileMap.columns(); ++column) {
            const bool walkable = tileMap.isWalkableTile(row, column);
            if (walkable && !insideRun) {
                ++count;
            }
            insideRun = walkable;
        }
    }
    return count;
}

[[nodiscard]] PlayableGameSceneResult resultFrom(
    const FramePacketBuilder& builder
) noexcept {
    return {builder.error() == FrameBuildError::none, builder.error()};
}

} // namespace

FramePacketCapacity playableGameSceneCapacity(
    const game::GameSystem& gameSystem
) noexcept {
    const core::TileMap& tileMap = gameSystem.tileMap();
    const std::size_t walkableRuns = walkableRunCount(tileMap);
    const std::span<const core::Vector2> waypoints = tileMap.spawnRouteWaypoints();
    const std::size_t routeSegments = waypoints.size() > 1U ? waypoints.size() - 1U : 0U;
    const std::size_t shapeCount = walkableRuns + 4U;
    return {
        shapeCount + routeSegments,
        0,
        shapeCount,
        routeSegments,
        0,
        0,
        0,
        0,
        0
    };
}

ViewportState makePlayableGameViewport(
    const game::GameSystem& gameSystem,
    const PlayableGameSceneConfig& config
) noexcept {
    const std::int32_t drawableWidth = std::max(config.drawableSize.width, 1);
    const std::int32_t drawableHeight = std::max(config.drawableSize.height, 1);
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
    const float logicalScale = static_cast<float>(std::min(
        static_cast<double>(contentWidth) / static_cast<double>(logicalWidth),
        static_cast<double>(contentHeight) / static_cast<double>(logicalHeight)
    ));

    const core::TileMap& tileMap = gameSystem.tileMap();
    const float tileSize = static_cast<float>(tileMap.tileSize());
    const float worldWidth = static_cast<float>(tileMap.columns()) * tileSize;
    const float worldHeight = static_cast<float>(tileMap.rows()) * tileSize;
    const float zoom = positiveFiniteOr(config.cameraZoom, defaultCameraZoom, 4.0F);
    const float baseWorldScale = std::min(
        static_cast<float>(drawableWidth) / worldWidth,
        static_cast<float>(drawableHeight) / worldHeight
    );
    const float worldScale = baseWorldScale * zoom;
    const float alpha = normalizedAlpha(config.interpolationAlpha);
    const Vec2F towerPosition = interpolatedBodyPosition(
        gameSystem.bodies(),
        gameSystem.towerBodyIndex(),
        alpha
    );
    const Vec2F cameraCenter = zoom > defaultCameraZoom
        ? towerPosition
        : Vec2F{worldWidth * 0.5F, worldHeight * 0.5F};
    const float worldOffsetX = static_cast<float>(drawableWidth) * 0.5F
        - cameraCenter.x * worldScale;
    const float worldOffsetY = static_cast<float>(drawableHeight) * 0.5F
        - cameraCenter.y * worldScale;
    const float inverseWorldScale = 1.0F / worldScale;
    const float renderScale = positiveFiniteOr(config.worldRenderScale, 1.0F, 4.0F);

    ViewportState viewport;
    viewport.physical.displaySize = {
        std::max(config.physicalDisplaySize.width, 1),
        std::max(config.physicalDisplaySize.height, 1)
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
    viewport.drawable.worldRenderTargetSize = {
        scaledDimension(drawableWidth, renderScale),
        scaledDimension(drawableHeight, renderScale)
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

    viewport.world.visibleBounds = {
        -worldOffsetX * inverseWorldScale,
        -worldOffsetY * inverseWorldScale,
        static_cast<float>(drawableWidth) * inverseWorldScale,
        static_cast<float>(drawableHeight) * inverseWorldScale
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

PlayableGameSceneResult buildPlayableGameScene(
    FramePacket& packet,
    const game::GameSystem& gameSystem,
    const PlayableGameSceneConfig& config,
    const PacketCapacityPolicy capacityPolicy
) {
    const float alpha = normalizedAlpha(config.interpolationAlpha);
    FrameMetadata metadata;
    metadata.frameId = config.frameId;
    metadata.simulationTick = config.simulationTick;
    metadata.presentationTimeSeconds = std::isfinite(config.presentationTimeSeconds)
            && config.presentationTimeSeconds >= 0.0
        ? config.presentationTimeSeconds
        : (static_cast<double>(config.simulationTick) + static_cast<double>(alpha))
            * game::GameSystem::fixed_delta_seconds;
    metadata.interpolationAlpha = alpha;
    metadata.alphaEncoding = AlphaEncoding::premultiplied;
    metadata.clearColor = PremultipliedRgba::opaque(0.018F, 0.024F, 0.034F);

    FramePacketBuilder builder(packet, capacityPolicy);
    if (!builder.begin(metadata, makePlayableGameViewport(gameSystem, config))) {
        return resultFrom(builder);
    }

    const std::int32_t drawableWidth = std::max(config.drawableSize.width, 1);
    const std::int32_t drawableHeight = std::max(config.drawableSize.height, 1);
    ShapeCommand background;
    background.header = makeHeader(
        RenderLayer::background,
        CoordinateSpace::drawablePixels,
        BlendMode::opaque
    );
    background.bounds = {
        0.0F,
        0.0F,
        static_cast<float>(drawableWidth),
        static_cast<float>(drawableHeight)
    };
    background.fill = metadata.clearColor;
    if (!builder.addShape(background)) {
        return resultFrom(builder);
    }

    const core::TileMap& tileMap = gameSystem.tileMap();
    const float tileSize = static_cast<float>(tileMap.tileSize());
    const float worldWidth = static_cast<float>(tileMap.columns()) * tileSize;
    const float worldHeight = static_cast<float>(tileMap.rows()) * tileSize;

    ShapeCommand mapSurface;
    mapSurface.header = makeHeader(
        RenderLayer::background,
        CoordinateSpace::world,
        BlendMode::opaque,
        1
    );
    mapSurface.bounds = {0.0F, 0.0F, worldWidth, worldHeight};
    mapSurface.fill = PremultipliedRgba::opaque(0.045F, 0.058F, 0.078F);
    if (!builder.addShape(mapSurface)) {
        return resultFrom(builder);
    }

    const float rowInset = tileSize * 0.045F;
    for (int row = 0; row < tileMap.rows(); ++row) {
        int runStart = -1;
        for (int column = 0; column <= tileMap.columns(); ++column) {
            const bool walkable = column < tileMap.columns()
                && tileMap.isWalkableTile(row, column);
            if (walkable && runStart < 0) {
                runStart = column;
                continue;
            }
            if (walkable || runStart < 0) {
                continue;
            }

            ShapeCommand floorRun;
            floorRun.header = makeHeader(
                RenderLayer::background,
                CoordinateSpace::world,
                BlendMode::opaque,
                2
            );
            floorRun.bounds = {
                static_cast<float>(runStart) * tileSize + rowInset,
                static_cast<float>(row) * tileSize + rowInset,
                static_cast<float>(column - runStart) * tileSize - rowInset * 2.0F,
                tileSize - rowInset * 2.0F
            };
            floorRun.fill = (row & 1) == 0
                ? PremultipliedRgba::opaque(0.105F, 0.145F, 0.185F)
                : PremultipliedRgba::opaque(0.092F, 0.128F, 0.168F);
            if (!builder.addShape(floorRun)) {
                return resultFrom(builder);
            }
            runStart = -1;
        }
    }

    const std::span<const core::Vector2> waypoints = tileMap.spawnRouteWaypoints();
    for (std::size_t index = 1; index < waypoints.size(); ++index) {
        LineCommand route;
        route.header = makeHeader(RenderLayer::object, CoordinateSpace::world);
        route.start = {
            static_cast<float>(waypoints[index - 1U].x),
            static_cast<float>(waypoints[index - 1U].y)
        };
        route.end = {
            static_cast<float>(waypoints[index].x),
            static_cast<float>(waypoints[index].y)
        };
        route.width = tileSize * 0.13F;
        route.cap = LineCap::round;
        route.color = PremultipliedRgba::fromStraight(0.22F, 0.58F, 0.78F, 0.44F);
        if (!builder.addLine(route)) {
            return resultFrom(builder);
        }
    }

    const core::BodySoA& bodies = gameSystem.bodies();
    const Vec2F corePosition = interpolatedBodyPosition(
        bodies,
        gameSystem.coreBodyIndex(),
        alpha
    );
    const float coreRadius = static_cast<float>(game::GameSystem::core_radius);
    ShapeCommand coreShape;
    coreShape.header = makeHeader(
        RenderLayer::object,
        CoordinateSpace::world,
        BlendMode::premultipliedAlpha,
        1
    );
    coreShape.shape = ShapeType::roundedRectangle;
    coreShape.bounds = {
        corePosition.x - coreRadius,
        corePosition.y - coreRadius,
        coreRadius * 2.0F,
        coreRadius * 2.0F
    };
    coreShape.cornerRadius = coreRadius * 0.28F;
    coreShape.strokeEnabled = 1;
    coreShape.strokeWidth = tileSize * 0.08F;
    coreShape.fill = PremultipliedRgba::opaque(0.96F, 0.55F, 0.18F);
    coreShape.stroke = PremultipliedRgba::opaque(1.0F, 0.86F, 0.48F);
    if (!builder.addShape(coreShape)) {
        return resultFrom(builder);
    }

    const Vec2F towerPosition = interpolatedBodyPosition(
        bodies,
        gameSystem.towerBodyIndex(),
        alpha
    );
    const float towerRadius = static_cast<float>(game::GameSystem::tower_radius);
    ShapeCommand towerShape;
    towerShape.header = makeHeader(
        RenderLayer::object,
        CoordinateSpace::world,
        BlendMode::premultipliedAlpha,
        2
    );
    towerShape.shape = ShapeType::circle;
    towerShape.bounds = {
        towerPosition.x - towerRadius,
        towerPosition.y - towerRadius,
        towerRadius * 2.0F,
        towerRadius * 2.0F
    };
    towerShape.strokeEnabled = 1;
    towerShape.strokeWidth = tileSize * 0.08F;
    towerShape.fill = PremultipliedRgba::opaque(0.12F, 0.72F, 0.94F);
    towerShape.stroke = PremultipliedRgba::opaque(0.72F, 0.96F, 1.0F);
    if (!builder.addShape(towerShape)) {
        return resultFrom(builder);
    }

    if (!builder.finish()) {
        return resultFrom(builder);
    }
    return {true, FrameBuildError::none};
}

} // namespace cirvivor::render::frontend
