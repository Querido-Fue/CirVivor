#pragma once

#include "render/common/frame_packet.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <numbers>
#include <string_view>
#include <type_traits>
#include <vector>

namespace cirvivor::render::sdl_gpu::detail {

struct SolidVertex final {
    float x = 0.0F;
    float y = 0.0F;
    float red = 0.0F;
    float green = 0.0F;
    float blue = 0.0F;
    float alpha = 0.0F;
};

struct DrawBatch final {
    BlendMode blendMode = BlendMode::premultipliedAlpha;
    std::uint32_t firstVertex = 0;
    std::uint32_t vertexCount = 0;
};

struct GeometryBuildStats final {
    std::uint64_t renderedCommands = 0;
    std::uint64_t placeholderCommands = 0;
    std::uint64_t generatedVertices = 0;
    std::uint64_t drawBatches = 0;
};

enum class GeometryBuildError : std::uint8_t {
    none = 0,
    invalidViewport,
    capacityExceeded,
    invalidGeometry
};

struct GeometryBuildResult final {
    GeometryBuildError error = GeometryBuildError::none;
    GeometryBuildStats stats;
};

class FrameGeometry final {
public:
    FrameGeometry(const std::size_t maximumVertices, const std::size_t maximumBatches)
        : maximumVertices_(maximumVertices), maximumBatches_(maximumBatches) {
        vertices_.reserve(maximumVertices_);
        batches_.reserve(maximumBatches_);
    }

    void clear(const SizeI drawableSize) noexcept {
        vertices_.clear();
        batches_.clear();
        drawableSize_ = drawableSize;
    }

    [[nodiscard]] bool addTriangle(
        const double x0,
        const double y0,
        const double x1,
        const double y1,
        const double x2,
        const double y2,
        const PremultipliedRgba color
    ) noexcept {
        if (vertices_.size() > maximumVertices_
            || maximumVertices_ - vertices_.size() < 3U
            || drawableSize_.width <= 0
            || drawableSize_.height <= 0) {
            return false;
        }
        return addVertex(x0, y0, color)
            && addVertex(x1, y1, color)
            && addVertex(x2, y2, color);
    }

    [[nodiscard]] bool addQuad(
        const std::array<double, 8>& points,
        const PremultipliedRgba color
    ) noexcept {
        return addTriangle(
                points[0], points[1],
                points[2], points[3],
                points[4], points[5],
                color
            )
            && addTriangle(
                points[0], points[1],
                points[4], points[5],
                points[6], points[7],
                color
            );
    }

    [[nodiscard]] bool finishCommand(
        const std::size_t firstVertex,
        const BlendMode blendMode
    ) noexcept {
        if (firstVertex > vertices_.size()) {
            return false;
        }
        const std::size_t vertexCount = vertices_.size() - firstVertex;
        if (vertexCount == 0U) {
            return true;
        }
        if (firstVertex > std::numeric_limits<std::uint32_t>::max()
            || vertexCount > std::numeric_limits<std::uint32_t>::max()) {
            return false;
        }
        if (!batches_.empty()
            && batches_.back().blendMode == blendMode
            && static_cast<std::uint64_t>(batches_.back().firstVertex)
                + batches_.back().vertexCount == firstVertex
            && static_cast<std::uint64_t>(batches_.back().vertexCount) + vertexCount
                <= std::numeric_limits<std::uint32_t>::max()) {
            batches_.back().vertexCount += static_cast<std::uint32_t>(vertexCount);
            return true;
        }
        if (batches_.size() >= maximumBatches_) {
            return false;
        }
        batches_.push_back({
            blendMode,
            static_cast<std::uint32_t>(firstVertex),
            static_cast<std::uint32_t>(vertexCount)
        });
        return true;
    }

    [[nodiscard]] std::size_t vertexCount() const noexcept {
        return vertices_.size();
    }

    [[nodiscard]] const std::vector<SolidVertex>& vertices() const noexcept {
        return vertices_;
    }

    [[nodiscard]] const std::vector<DrawBatch>& batches() const noexcept {
        return batches_;
    }

private:
    [[nodiscard]] bool addVertex(
        const double drawableX,
        const double drawableY,
        const PremultipliedRgba color
    ) noexcept {
        if (!std::isfinite(drawableX) || !std::isfinite(drawableY)) {
            return false;
        }
        const double clipX = drawableX * 2.0 / static_cast<double>(drawableSize_.width) - 1.0;
        const double clipY = 1.0 - drawableY * 2.0 / static_cast<double>(drawableSize_.height);
        if (!std::isfinite(clipX) || !std::isfinite(clipY)) {
            return false;
        }
        vertices_.push_back({
            static_cast<float>(clipX),
            static_cast<float>(clipY),
            color.red,
            color.green,
            color.blue,
            color.alpha
        });
        return true;
    }

    std::size_t maximumVertices_ = 0;
    std::size_t maximumBatches_ = 0;
    SizeI drawableSize_;
    std::vector<SolidVertex> vertices_;
    std::vector<DrawBatch> batches_;
};

namespace geometry {

constexpr double minimumDenominator = 1.0e-12;
constexpr std::size_t maximumPolygonPoints = 24;

struct Point final {
    double x = 0.0;
    double y = 0.0;
};

[[nodiscard]] inline double distance(const Point first, const Point second) noexcept {
    return std::hypot(second.x - first.x, second.y - first.y);
}

class Mapper final {
public:
    explicit Mapper(const ViewportState& viewport) noexcept : viewport_(viewport) {}

    [[nodiscard]] bool map(
        const double inputX,
        const double inputY,
        const CoordinateSpace coordinateSpace,
        Point& output
    ) const noexcept {
        if (!std::isfinite(inputX) || !std::isfinite(inputY)) {
            return false;
        }

        switch (coordinateSpace) {
        case CoordinateSpace::physicalPixels: {
            const RectI bounds = viewport_.physical.windowBounds;
            if (bounds.width > 0 && bounds.height > 0) {
                output.x = (inputX - static_cast<double>(bounds.x))
                    * static_cast<double>(viewport_.drawable.size.width)
                    / static_cast<double>(bounds.width);
                output.y = (inputY - static_cast<double>(bounds.y))
                    * static_cast<double>(viewport_.drawable.size.height)
                    / static_cast<double>(bounds.height);
            } else {
                output = {inputX, inputY};
            }
            break;
        }
        case CoordinateSpace::drawablePixels:
            output = {inputX, inputY};
            break;
        case CoordinateSpace::logicalUi:
            output.x = static_cast<double>(viewport_.drawable.contentRect.x)
                + (inputX - static_cast<double>(viewport_.logicalUi.contentRect.x))
                    * static_cast<double>(viewport_.logicalUi.drawablePixelsPerLogicalUnitX);
            output.y = static_cast<double>(viewport_.drawable.contentRect.y)
                + (inputY - static_cast<double>(viewport_.logicalUi.contentRect.y))
                    * static_cast<double>(viewport_.logicalUi.drawablePixelsPerLogicalUnitY);
            break;
        case CoordinateSpace::world: {
            const auto& matrix = viewport_.world.worldToDrawable.elements;
            const double homogeneousX = static_cast<double>(matrix[0]) * inputX
                + static_cast<double>(matrix[1]) * inputY
                + static_cast<double>(matrix[2]);
            const double homogeneousY = static_cast<double>(matrix[3]) * inputX
                + static_cast<double>(matrix[4]) * inputY
                + static_cast<double>(matrix[5]);
            const double homogeneousW = static_cast<double>(matrix[6]) * inputX
                + static_cast<double>(matrix[7]) * inputY
                + static_cast<double>(matrix[8]);
            if (!std::isfinite(homogeneousW) || std::abs(homogeneousW) <= minimumDenominator) {
                return false;
            }
            output = {homogeneousX / homogeneousW, homogeneousY / homogeneousW};
            break;
        }
        }
        return std::isfinite(output.x) && std::isfinite(output.y);
    }

    [[nodiscard]] double mapLength(
        const float length,
        const CoordinateSpace coordinateSpace
    ) const noexcept {
        if (!std::isfinite(length) || length <= 0.0F) {
            return 0.0;
        }
        Point origin;
        Point horizontal;
        Point vertical;
        if (!map(0.0, 0.0, coordinateSpace, origin)
            || !map(static_cast<double>(length), 0.0, coordinateSpace, horizontal)
            || !map(0.0, static_cast<double>(length), coordinateSpace, vertical)) {
            return 0.0;
        }
        return (distance(origin, horizontal) + distance(origin, vertical)) * 0.5;
    }

private:
    const ViewportState& viewport_;
};

[[nodiscard]] inline PremultipliedRgba scaledColor(
    const PremultipliedRgba color,
    const float rgbScale,
    const float alphaScale = 1.0F
) noexcept {
    const float alpha = std::clamp(color.alpha * alphaScale, 0.0F, 1.0F);
    return {
        std::clamp(color.red * rgbScale * alphaScale, 0.0F, alpha),
        std::clamp(color.green * rgbScale * alphaScale, 0.0F, alpha),
        std::clamp(color.blue * rgbScale * alphaScale, 0.0F, alpha),
        alpha
    };
}

[[nodiscard]] inline Point rotateAround(
    const Point point,
    const Point pivot,
    const float radians
) noexcept {
    if (radians == 0.0F) {
        return point;
    }
    const double cosine = std::cos(static_cast<double>(radians));
    const double sine = std::sin(static_cast<double>(radians));
    const double x = point.x - pivot.x;
    const double y = point.y - pivot.y;
    return {
        pivot.x + x * cosine - y * sine,
        pivot.y + x * sine + y * cosine
    };
}

[[nodiscard]] inline bool mapQuad(
    const Mapper& mapper,
    const RectF rect,
    const CoordinateSpace coordinateSpace,
    const float rotationRadians,
    const Point pivot,
    std::array<double, 8>& output
) noexcept {
    std::array<Point, 4> points{
        Point{rect.x, rect.y},
        Point{rect.x + rect.width, rect.y},
        Point{rect.x + rect.width, rect.y + rect.height},
        Point{rect.x, rect.y + rect.height}
    };
    for (std::size_t index = 0; index < points.size(); ++index) {
        const Point rotated = rotateAround(points[index], pivot, rotationRadians);
        Point mapped;
        if (!mapper.map(rotated.x, rotated.y, coordinateSpace, mapped)) {
            return false;
        }
        output[index * 2U] = mapped.x;
        output[index * 2U + 1U] = mapped.y;
    }
    return true;
}

[[nodiscard]] inline bool addMappedRect(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const RectF rect,
    const CoordinateSpace coordinateSpace,
    const float rotationRadians,
    const Point pivot,
    const PremultipliedRgba color
) noexcept {
    std::array<double, 8> quad{};
    return mapQuad(mapper, rect, coordinateSpace, rotationRadians, pivot, quad)
        && geometry.addQuad(quad, color);
}

[[nodiscard]] inline bool addThickSegment(
    FrameGeometry& geometry,
    Point start,
    Point end,
    const double width,
    const PremultipliedRgba color,
    const LineCap cap = LineCap::butt
) noexcept {
    const double length = distance(start, end);
    if (!(length > minimumDenominator) || !(width > 0.0)) {
        return true;
    }
    const double directionX = (end.x - start.x) / length;
    const double directionY = (end.y - start.y) / length;
    const double halfWidth = width * 0.5;
    if (cap == LineCap::square) {
        start.x -= directionX * halfWidth;
        start.y -= directionY * halfWidth;
        end.x += directionX * halfWidth;
        end.y += directionY * halfWidth;
    }
    const double normalX = -directionY * halfWidth;
    const double normalY = directionX * halfWidth;
    return geometry.addQuad({
        start.x + normalX, start.y + normalY,
        end.x + normalX, end.y + normalY,
        end.x - normalX, end.y - normalY,
        start.x - normalX, start.y - normalY
    }, color);
}

[[nodiscard]] inline bool addPolygon(
    FrameGeometry& geometry,
    const std::array<Point, maximumPolygonPoints>& points,
    const std::size_t pointCount,
    const PremultipliedRgba fill,
    const PremultipliedRgba stroke,
    const bool fillEnabled,
    const bool strokeEnabled,
    const double strokeWidth
) noexcept {
    if (pointCount < 3U || pointCount > points.size()) {
        return false;
    }
    if (fillEnabled) {
        for (std::size_t index = 1; index + 1U < pointCount; ++index) {
            if (!geometry.addTriangle(
                    points[0].x,
                    points[0].y,
                    points[index].x,
                    points[index].y,
                    points[index + 1U].x,
                    points[index + 1U].y,
                    fill
                )) {
                return false;
            }
        }
    }
    if (strokeEnabled && strokeWidth > 0.0) {
        for (std::size_t index = 0; index < pointCount; ++index) {
            if (!addThickSegment(
                    geometry,
                    points[index],
                    points[(index + 1U) % pointCount],
                    strokeWidth,
                    stroke,
                    LineCap::round
                )) {
                return false;
            }
        }
    }
    return true;
}

[[nodiscard]] inline bool mapRegularPolygon(
    const Mapper& mapper,
    const RectF bounds,
    const CoordinateSpace coordinateSpace,
    const float rotationRadians,
    const std::size_t pointCount,
    const double startingAngle,
    std::array<Point, maximumPolygonPoints>& output
) noexcept {
    if (pointCount < 3U || pointCount > output.size()) {
        return false;
    }
    const double centerX = static_cast<double>(bounds.x) + bounds.width * 0.5;
    const double centerY = static_cast<double>(bounds.y) + bounds.height * 0.5;
    const double radiusX = static_cast<double>(bounds.width) * 0.5;
    const double radiusY = static_cast<double>(bounds.height) * 0.5;
    for (std::size_t index = 0; index < pointCount; ++index) {
        const double angle = startingAngle + static_cast<double>(rotationRadians)
            + static_cast<double>(index) * std::numbers::pi_v<double> * 2.0
                / static_cast<double>(pointCount);
        if (!mapper.map(
                centerX + std::cos(angle) * radiusX,
                centerY + std::sin(angle) * radiusY,
                coordinateSpace,
                output[index]
            )) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] inline bool drawSprite(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const SpriteCommand& command
) noexcept {
    const Point pivot{
        static_cast<double>(command.destination.x)
            + static_cast<double>(command.destination.width) * command.pivot.x,
        static_cast<double>(command.destination.y)
            + static_cast<double>(command.destination.height) * command.pivot.y
    };
    if (!addMappedRect(
            geometry,
            mapper,
            command.destination,
            command.header.coordinateSpace,
            command.rotationRadians,
            pivot,
            command.tint
        )) {
        return false;
    }

    std::array<double, 8> quad{};
    if (!mapQuad(
            mapper,
            command.destination,
            command.header.coordinateSpace,
            command.rotationRadians,
            pivot,
            quad
        )) {
        return false;
    }
    const double width = std::max(
        mapper.mapLength(
            std::min(command.destination.width, command.destination.height) * 0.045F,
            command.header.coordinateSpace
        ),
        1.0
    );
    const PremultipliedRgba marker = scaledColor(command.tint, 0.45F, 0.82F);
    return addThickSegment(
            geometry,
            {quad[0], quad[1]},
            {quad[4], quad[5]},
            width,
            marker
        )
        && addThickSegment(
            geometry,
            {quad[2], quad[3]},
            {quad[6], quad[7]},
            width,
            marker
        );
}

[[nodiscard]] inline bool drawShape(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const ShapeCommand& command
) noexcept {
    const double strokeWidth = mapper.mapLength(
        command.strokeWidth,
        command.header.coordinateSpace
    );
    const Point center{
        static_cast<double>(command.bounds.x) + command.bounds.width * 0.5,
        static_cast<double>(command.bounds.y) + command.bounds.height * 0.5
    };

    if (command.shape == ShapeType::rectangle
        || command.shape == ShapeType::roundedRectangle) {
        std::array<double, 8> quad{};
        if (!mapQuad(
                mapper,
                command.bounds,
                command.header.coordinateSpace,
                command.rotationRadians,
                center,
                quad
            )) {
            return false;
        }
        std::array<Point, maximumPolygonPoints> points{};
        for (std::size_t index = 0; index < 4U; ++index) {
            points[index] = {quad[index * 2U], quad[index * 2U + 1U]};
        }
        return addPolygon(
            geometry,
            points,
            4U,
            command.fill,
            command.stroke,
            command.fillEnabled != 0U,
            command.strokeEnabled != 0U,
            strokeWidth
        );
    }

    std::size_t pointCount = 3U;
    switch (command.shape) {
    case ShapeType::rectangle:
    case ShapeType::roundedRectangle:
        pointCount = 4U;
        break;
    case ShapeType::circle:
        pointCount = maximumPolygonPoints;
        break;
    case ShapeType::triangle:
        pointCount = 3U;
        break;
    case ShapeType::pentagon:
        pointCount = 5U;
        break;
    case ShapeType::hexagon:
        pointCount = 6U;
        break;
    case ShapeType::octagon:
        pointCount = 8U;
        break;
    case ShapeType::arrow:
        pointCount = 7U;
        break;
    }

    std::array<Point, maximumPolygonPoints> points{};
    if (command.shape == ShapeType::arrow) {
        constexpr std::array<Point, 7> normalized{
            Point{0.0, 0.34}, Point{0.58, 0.34}, Point{0.58, 0.0},
            Point{1.0, 0.5}, Point{0.58, 1.0}, Point{0.58, 0.66}, Point{0.0, 0.66}
        };
        for (std::size_t index = 0; index < normalized.size(); ++index) {
            const Point source{
                static_cast<double>(command.bounds.x)
                    + normalized[index].x * command.bounds.width,
                static_cast<double>(command.bounds.y)
                    + normalized[index].y * command.bounds.height
            };
            const Point rotated = rotateAround(source, center, command.rotationRadians);
            if (!mapper.map(
                    rotated.x,
                    rotated.y,
                    command.header.coordinateSpace,
                    points[index]
                )) {
                return false;
            }
        }
    } else if (!mapRegularPolygon(
            mapper,
            command.bounds,
            command.header.coordinateSpace,
            command.rotationRadians,
            pointCount,
            -std::numbers::pi_v<double> * 0.5,
            points
        )) {
        return false;
    }
    return addPolygon(
        geometry,
        points,
        pointCount,
        command.fill,
        command.stroke,
        command.fillEnabled != 0U,
        command.strokeEnabled != 0U,
        strokeWidth
    );
}

[[nodiscard]] inline bool drawLine(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const LineCommand& command
) noexcept {
    Point start;
    Point end;
    if (!mapper.map(
            command.start.x,
            command.start.y,
            command.header.coordinateSpace,
            start
        )
        || !mapper.map(
            command.end.x,
            command.end.y,
            command.header.coordinateSpace,
            end
        )) {
        return false;
    }
    return addThickSegment(
        geometry,
        start,
        end,
        mapper.mapLength(command.width, command.header.coordinateSpace),
        command.color,
        command.cap
    );
}

[[nodiscard]] inline std::size_t utf8CodePointCount(const std::string_view text) noexcept {
    return static_cast<std::size_t>(std::count_if(
        text.begin(),
        text.end(),
        [](const char value) noexcept {
            return (static_cast<unsigned char>(value) & 0xc0U) != 0x80U;
        }
    ));
}

[[nodiscard]] inline std::uint64_t textHash(const std::string_view text) noexcept {
    std::uint64_t value = 0xcbf2'9ce4'8422'2325ULL;
    for (const char character : text) {
        value ^= static_cast<std::uint8_t>(character);
        value *= 0x0000'0100'0000'01b3ULL;
    }
    return value;
}

[[nodiscard]] inline bool drawTextPlaceholder(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const FramePacket& frame,
    const TextCommand& command
) noexcept {
    const std::string_view text = frame.text(command.utf8);
    if (text.empty()) {
        return true;
    }
    const std::size_t glyphCount = std::max<std::size_t>(utf8CodePointCount(text), 1U);
    const float height = command.lineHeight > 0.0F ? command.lineHeight : command.fontSize;
    float width = command.fontSize * 0.62F
        * static_cast<float>(std::min<std::size_t>(glyphCount, 32U));
    if (command.maximumSize.width > 0.0F) {
        width = std::min(width, command.maximumSize.width);
    }
    const float boundedHeight = command.maximumSize.height > 0.0F
        ? std::min(height, command.maximumSize.height)
        : height;
    if (!(width > 0.0F) || !(boundedHeight > 0.0F)) {
        return true;
    }

    float left = command.origin.x;
    if (command.align == TextAlign::center) {
        left -= width * 0.5F;
    } else if (command.align == TextAlign::end) {
        left -= width;
    }
    float top = command.origin.y;
    switch (command.baseline) {
    case TextBaseline::top:
        break;
    case TextBaseline::middle:
        top -= boundedHeight * 0.5F;
        break;
    case TextBaseline::alphabetic:
        top -= boundedHeight * 0.82F;
        break;
    case TextBaseline::bottom:
        top -= boundedHeight;
        break;
    }

    const Point pivot{command.origin.x, command.origin.y};
    const PremultipliedRgba dim = scaledColor(command.color, 0.42F, 0.72F);
    constexpr std::size_t maximumBars = 12U;
    const std::size_t barCount = std::min(glyphCount, maximumBars);
    const float barGap = width * 0.025F;
    const float barWidth = std::max(
        (width - barGap * static_cast<float>(barCount + 1U))
            / static_cast<float>(barCount),
        width * 0.018F
    );
    const std::uint64_t hash = textHash(text);
    for (std::size_t index = 0; index < barCount; ++index) {
        const std::uint64_t bits = hash >> ((index % 8U) * 8U);
        const float heightScale = 0.34F + static_cast<float>(bits & 0x7U) * 0.075F;
        const RectF bar{
            left + barGap + static_cast<float>(index) * (barWidth + barGap),
            top + boundedHeight * (1.0F - heightScale),
            barWidth,
            boundedHeight * heightScale
        };
        if (!addMappedRect(
                geometry,
                mapper,
                bar,
                command.header.coordinateSpace,
                command.rotationRadians,
                pivot,
                index % 3U == 0U ? command.color : dim
            )) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] inline bool addRectOutline(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const RectF rect,
    const CoordinateSpace coordinateSpace,
    const PremultipliedRgba color,
    const float sourceWidth
) noexcept {
    std::array<double, 8> quad{};
    const Point center{
        static_cast<double>(rect.x) + rect.width * 0.5,
        static_cast<double>(rect.y) + rect.height * 0.5
    };
    if (!mapQuad(mapper, rect, coordinateSpace, 0.0F, center, quad)) {
        return false;
    }
    const double width = std::max(mapper.mapLength(sourceWidth, coordinateSpace), 1.0);
    for (std::size_t index = 0; index < 4U; ++index) {
        const std::size_t next = (index + 1U) % 4U;
        if (!addThickSegment(
                geometry,
                {quad[index * 2U], quad[index * 2U + 1U]},
                {quad[next * 2U], quad[next * 2U + 1U]},
                width,
                color
            )) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] inline bool drawUiPlaceholder(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const UiCommand& command
) noexcept {
    const Point center{
        static_cast<double>(command.bounds.x) + command.bounds.width * 0.5,
        static_cast<double>(command.bounds.y) + command.bounds.height * 0.5
    };
    if (!addMappedRect(
            geometry,
            mapper,
            command.bounds,
            command.header.coordinateSpace,
            0.0F,
            center,
            command.backgroundColor
        )) {
        return false;
    }
    if (command.borderWidth > 0.0F
        && !addRectOutline(
            geometry,
            mapper,
            command.bounds,
            command.header.coordinateSpace,
            command.borderColor,
            command.borderWidth
        )) {
        return false;
    }
    if (command.primitive == UiPrimitive::progress) {
        const float value = std::clamp(command.value, 0.0F, 1.0F);
        const RectF progress{
            command.bounds.x,
            command.bounds.y + command.bounds.height * 0.68F,
            command.bounds.width * value,
            command.bounds.height * 0.32F
        };
        const Point progressCenter{
            static_cast<double>(progress.x) + progress.width * 0.5,
            static_cast<double>(progress.y) + progress.height * 0.5
        };
        return addMappedRect(
            geometry,
            mapper,
            progress,
            command.header.coordinateSpace,
            0.0F,
            progressCenter,
            command.accentColor
        );
    }
    return true;
}

[[nodiscard]] inline bool drawEffectPlaceholder(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const EffectCommand& command
) noexcept {
    ShapeCommand replacement;
    replacement.header = command.header;
    replacement.bounds = command.bounds;
    replacement.fill = scaledColor(command.primaryColor, 0.62F, 0.42F);
    replacement.stroke = command.primaryColor;
    replacement.strokeEnabled = 1U;
    replacement.strokeWidth = std::max(
        std::min(command.bounds.width, command.bounds.height) * 0.035F,
        0.015F
    );
    replacement.shape = ShapeType::roundedRectangle;

    switch (command.effect) {
    case EffectType::magneticShield:
    case EffectType::titleLoadingCircle:
        replacement.shape = ShapeType::circle;
        replacement.fillEnabled = 0U;
        break;
    case EffectType::hexaMergeBoundary:
        replacement.shape = ShapeType::hexagon;
        replacement.fillEnabled = 0U;
        break;
    case EffectType::vignette:
        replacement.shape = ShapeType::rectangle;
        replacement.fill = command.primaryColor;
        replacement.fillEnabled = 1U;
        replacement.strokeEnabled = 0U;
        break;
    case EffectType::backdropBlur:
    case EffectType::glassComposite:
    case EffectType::custom:
        break;
    }
    return drawShape(geometry, mapper, replacement);
}

[[nodiscard]] inline PremultipliedRgba overlayMarkerColor(
    const StableElementId sessionId
) noexcept {
    const float red = 0.35F + static_cast<float>((sessionId >> 0U) & 0x3fU) / 255.0F;
    const float green = 0.55F + static_cast<float>((sessionId >> 8U) & 0x3fU) / 255.0F;
    const float blue = 0.72F + static_cast<float>((sessionId >> 16U) & 0x3fU) / 255.0F;
    return PremultipliedRgba::fromStraight(red, green, blue, 0.72F);
}

[[nodiscard]] inline bool drawOverlayPlaceholder(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const ViewportState& viewport,
    const OverlayCommand& command
) noexcept {
    RectF bounds = command.destinationBounds;
    if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
        bounds = command.sourceBounds;
    }
    if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
        const float logicalWidth = viewport.logicalUi.contentRect.width;
        const float logicalHeight = viewport.logicalUi.contentRect.height;
        const float marker = std::max(std::min(logicalWidth, logicalHeight) * 0.012F, 4.0F);
        const float offset = static_cast<float>(command.sessionId & 0x0fU) * marker * 0.12F;
        bounds = {
            viewport.logicalUi.contentRect.x + marker + offset,
            viewport.logicalUi.contentRect.y + marker,
            marker,
            marker
        };
    }

    const Point center{
        static_cast<double>(bounds.x) + bounds.width * 0.5,
        static_cast<double>(bounds.y) + bounds.height * 0.5
    };
    const PremultipliedRgba marker = overlayMarkerColor(command.sessionId);
    switch (command.operation) {
    case OverlayOperation::beginSession:
    case OverlayOperation::endSession:
        return addMappedRect(
            geometry,
            mapper,
            bounds,
            command.header.coordinateSpace,
            0.0F,
            center,
            marker
        );
    case OverlayOperation::captureBackdrop:
        return addRectOutline(
            geometry,
            mapper,
            bounds,
            command.header.coordinateSpace,
            marker,
            std::max(bounds.width, bounds.height) * 0.004F
        );
    case OverlayOperation::dim:
        return addMappedRect(
            geometry,
            mapper,
            bounds,
            command.header.coordinateSpace,
            0.0F,
            center,
            command.shadowColor.alpha > 0.0F ? command.shadowColor : marker
        );
    case OverlayOperation::glassPanel:
        if (!addMappedRect(
                geometry,
                mapper,
                bounds,
                command.header.coordinateSpace,
                0.0F,
                center,
                command.tintColor
            )) {
            return false;
        }
        return addRectOutline(
            geometry,
            mapper,
            bounds,
            command.header.coordinateSpace,
            command.edgeColor.alpha > 0.0F ? command.edgeColor : marker,
            std::max(bounds.width, bounds.height) * 0.004F
        );
    }
    return false;
}

[[nodiscard]] inline bool drawV2Placeholder(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const ViewportState& viewport,
    const CommandHeader& header,
    RectF bounds,
    const PremultipliedRgba color,
    const std::uint64_t markerSeed
) noexcept {
    if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
        const RectF content = viewport.logicalUi.contentRect;
        const float marker = std::max(
            std::min(content.width, content.height) * 0.014F,
            4.0F
        );
        const float offset = static_cast<float>(markerSeed & 0x1fU) * marker * 0.08F;
        bounds = {
            content.x + marker + offset,
            content.y + marker * 2.0F,
            marker,
            marker
        };
    }
    const Point center{
        static_cast<double>(bounds.x) + bounds.width * 0.5,
        static_cast<double>(bounds.y) + bounds.height * 0.5
    };
    return addMappedRect(
            geometry,
            mapper,
            bounds,
            header.coordinateSpace,
            0.0F,
            center,
            scaledColor(color, 0.72F, 0.68F)
        )
        && addRectOutline(
            geometry,
            mapper,
            bounds,
            header.coordinateSpace,
            color,
            std::max(bounds.width, bounds.height) * 0.006F
        );
}

[[nodiscard]] inline RectF meshPlaceholderBounds(
    const FramePacket& frame,
    const TexturedMeshCommand& command
) noexcept {
    const auto vertices = frame.meshVertices().subspan(
        static_cast<std::size_t>(command.vertices.offset),
        static_cast<std::size_t>(command.vertices.count)
    );
    float left = vertices.front().position.x;
    float top = vertices.front().position.y;
    float right = left;
    float bottom = top;
    for (const ProjectiveVertex& vertex : vertices) {
        left = std::min(left, vertex.position.x);
        top = std::min(top, vertex.position.y);
        right = std::max(right, vertex.position.x);
        bottom = std::max(bottom, vertex.position.y);
    }
    return {left, top, right - left, bottom - top};
}

[[nodiscard]] inline bool dispatchCommand(
    FrameGeometry& geometry,
    const Mapper& mapper,
    const FramePacket& frame,
    const CommandRef reference,
    bool& placeholder
) noexcept {
    const std::size_t index = static_cast<std::size_t>(reference.index);
    switch (reference.kind) {
    case CommandKind::sprite:
        placeholder = true;
        return index < frame.sprites().size()
            && drawSprite(geometry, mapper, frame.sprites()[index]);
    case CommandKind::shape:
        return index < frame.shapes().size()
            && drawShape(geometry, mapper, frame.shapes()[index]);
    case CommandKind::line:
        return index < frame.lines().size()
            && drawLine(geometry, mapper, frame.lines()[index]);
    case CommandKind::text:
        placeholder = true;
        return index < frame.textRuns().size()
            && drawTextPlaceholder(geometry, mapper, frame, frame.textRuns()[index]);
    case CommandKind::effect:
        placeholder = true;
        return index < frame.effects().size()
            && drawEffectPlaceholder(geometry, mapper, frame.effects()[index]);
    case CommandKind::ui:
        placeholder = true;
        return index < frame.ui().size()
            && drawUiPlaceholder(geometry, mapper, frame.ui()[index]);
    case CommandKind::overlay:
        placeholder = true;
        return index < frame.overlays().size()
            && drawOverlayPlaceholder(
                geometry,
                mapper,
                frame.viewport(),
                frame.overlays()[index]
            );
    case CommandKind::glyphRun: {
        placeholder = true;
        if (index >= frame.glyphRuns().size()) {
            return false;
        }
        const GlyphRunCommand& command = frame.glyphRuns()[index];
        return drawV2Placeholder(
            geometry,
            mapper,
            frame.viewport(),
            command.header,
            {
                command.origin.x,
                command.origin.y - command.pixelsPerEm,
                command.pixelsPerEm * 0.62F * static_cast<float>(command.glyphs.count),
                command.pixelsPerEm
            },
            command.color,
            command.fontId
        );
    }
    case CommandKind::texturedMesh: {
        placeholder = true;
        if (index >= frame.texturedMeshes().size()) {
            return false;
        }
        const TexturedMeshCommand& command = frame.texturedMeshes()[index];
        return drawV2Placeholder(
            geometry,
            mapper,
            frame.viewport(),
            command.header,
            meshPlaceholderBounds(frame, command),
            command.tint,
            command.textureId
        );
    }
    case CommandKind::gradient: {
        placeholder = true;
        if (index >= frame.gradients().size()) {
            return false;
        }
        const GradientCommand& command = frame.gradients()[index];
        const GradientStop& stop = frame.gradientStops()[command.stops.offset];
        return drawV2Placeholder(
            geometry,
            mapper,
            frame.viewport(),
            command.header,
            command.bounds,
            stop.color,
            command.stops.offset
        );
    }
    case CommandKind::clip: {
        placeholder = true;
        if (index >= frame.clips().size()) {
            return false;
        }
        const ClipCommand& command = frame.clips()[index];
        return drawV2Placeholder(
            geometry,
            mapper,
            frame.viewport(),
            command.header,
            command.operation == ClipOperation::pop ? RectF{} : command.bounds,
            PremultipliedRgba::fromStraight(0.95F, 0.62F, 0.12F, 0.72F),
            index
        );
    }
    case CommandKind::pass: {
        placeholder = true;
        if (index >= frame.passes().size()) {
            return false;
        }
        const PassCommand& command = frame.passes()[index];
        RectF bounds = command.destinationBounds;
        if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
            bounds = command.sourceBounds;
        }
        return drawV2Placeholder(
            geometry,
            mapper,
            frame.viewport(),
            command.header,
            bounds,
            overlayMarkerColor(command.sessionId),
            command.sessionId
        );
    }
    }
    return false;
}

[[nodiscard]] inline const CommandHeader* commandHeader(
    const FramePacket& frame,
    const CommandRef reference
) noexcept {
    const std::size_t index = static_cast<std::size_t>(reference.index);
    switch (reference.kind) {
    case CommandKind::sprite:
        return index < frame.sprites().size() ? &frame.sprites()[index].header : nullptr;
    case CommandKind::shape:
        return index < frame.shapes().size() ? &frame.shapes()[index].header : nullptr;
    case CommandKind::line:
        return index < frame.lines().size() ? &frame.lines()[index].header : nullptr;
    case CommandKind::text:
        return index < frame.textRuns().size() ? &frame.textRuns()[index].header : nullptr;
    case CommandKind::effect:
        return index < frame.effects().size() ? &frame.effects()[index].header : nullptr;
    case CommandKind::ui:
        return index < frame.ui().size() ? &frame.ui()[index].header : nullptr;
    case CommandKind::overlay:
        return index < frame.overlays().size() ? &frame.overlays()[index].header : nullptr;
    case CommandKind::glyphRun:
        return index < frame.glyphRuns().size() ? &frame.glyphRuns()[index].header : nullptr;
    case CommandKind::texturedMesh:
        return index < frame.texturedMeshes().size()
            ? &frame.texturedMeshes()[index].header
            : nullptr;
    case CommandKind::gradient:
        return index < frame.gradients().size() ? &frame.gradients()[index].header : nullptr;
    case CommandKind::clip:
        return index < frame.clips().size() ? &frame.clips()[index].header : nullptr;
    case CommandKind::pass:
        return index < frame.passes().size() ? &frame.passes()[index].header : nullptr;
    }
    return nullptr;
}

} // namespace geometry

[[nodiscard]] inline GeometryBuildResult buildFrameGeometry(
    const FramePacket& frame,
    FrameGeometry& geometry
) noexcept {
    GeometryBuildResult result;
    const SizeI drawableSize = frame.viewport().drawable.size;
    if (drawableSize.width <= 0 || drawableSize.height <= 0) {
        result.error = GeometryBuildError::invalidViewport;
        return result;
    }

    geometry.clear(drawableSize);
    const geometry::Mapper mapper(frame.viewport());
    for (const CommandRef reference : frame.commandStream()) {
        const CommandHeader* const header = geometry::commandHeader(frame, reference);
        if (header == nullptr) {
            result.error = GeometryBuildError::invalidGeometry;
            return result;
        }
        const std::size_t firstVertex = geometry.vertexCount();
        bool placeholder = false;
        if (!geometry::dispatchCommand(geometry, mapper, frame, reference, placeholder)) {
            result.error = GeometryBuildError::capacityExceeded;
            return result;
        }
        if (!geometry.finishCommand(firstVertex, header->blendMode)) {
            result.error = GeometryBuildError::capacityExceeded;
            return result;
        }
        if (geometry.vertexCount() > firstVertex) {
            ++result.stats.renderedCommands;
            if (placeholder) {
                ++result.stats.placeholderCommands;
            }
        }
    }

    result.stats.generatedVertices = geometry.vertices().size();
    result.stats.drawBatches = geometry.batches().size();
    return result;
}

static_assert(sizeof(SolidVertex) == sizeof(float) * 6U);
static_assert(std::is_trivially_copyable_v<SolidVertex>);

} // namespace cirvivor::render::sdl_gpu::detail
