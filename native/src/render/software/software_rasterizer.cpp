#include "render/software/software_rasterizer.h"

#include <SDL3/SDL_pixels.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <numbers>
#include <string_view>

namespace cirvivor::render::software::detail {

namespace {

constexpr double geometry_limit = 1.0e9;
constexpr double minimum_denominator = 1.0e-12;
constexpr std::size_t maximum_placeholder_glyphs = 2'048;
constexpr std::uint64_t fnv_offset_basis = 0xcbf2'9ce4'8422'2325ULL;
constexpr std::uint64_t fnv_prime = 0x0000'0100'0000'01b3ULL;

class SurfaceAccess final {
public:
    explicit SurfaceAccess(SDL_Surface& surface) noexcept
        : surface_(surface) {
        if (!surfaceIsUsable(surface_)) {
            return;
        }
        if (SDL_MUSTLOCK(&surface_) != 0) {
            if (!SDL_LockSurface(&surface_)) {
                return;
            }
            locked_ = true;
        }
        valid_ = true;
    }

    ~SurfaceAccess() {
        if (locked_) {
            SDL_UnlockSurface(&surface_);
        }
    }

    SurfaceAccess(const SurfaceAccess&) = delete;
    SurfaceAccess& operator=(const SurfaceAccess&) = delete;

    [[nodiscard]] bool isValid() const noexcept {
        return valid_;
    }

    [[nodiscard]] std::uint32_t* row(const int y) const noexcept {
        auto* const bytes = static_cast<std::byte*>(surface_.pixels);
        return reinterpret_cast<std::uint32_t*>(
            bytes + static_cast<std::ptrdiff_t>(y) * surface_.pitch
        );
    }

private:
    [[nodiscard]] static bool surfaceIsUsable(const SDL_Surface& surface) noexcept {
        return surface.format == SDL_PIXELFORMAT_ARGB8888
            && surface.w > 0
            && surface.h > 0
            && surface.pixels != nullptr
            && surface.pitch >= surface.w * static_cast<int>(sizeof(std::uint32_t))
            && surface.pitch % static_cast<int>(alignof(std::uint32_t)) == 0;
    }

    SDL_Surface& surface_;
    bool locked_ = false;
    bool valid_ = false;
};

[[nodiscard]] std::uint8_t quantizeUnit(const float value) noexcept {
    if (!std::isfinite(value) || value <= 0.0F) {
        return 0;
    }
    if (value >= 1.0F) {
        return 255;
    }
    return static_cast<std::uint8_t>(value * 255.0F + 0.5F);
}

[[nodiscard]] std::uint32_t packColor(const PremultipliedRgba color) noexcept {
    const std::uint8_t alpha = quantizeUnit(color.alpha);
    const std::uint8_t red = std::min(quantizeUnit(color.red), alpha);
    const std::uint8_t green = std::min(quantizeUnit(color.green), alpha);
    const std::uint8_t blue = std::min(quantizeUnit(color.blue), alpha);
    return (static_cast<std::uint32_t>(alpha) << 24U)
        | (static_cast<std::uint32_t>(red) << 16U)
        | (static_cast<std::uint32_t>(green) << 8U)
        | static_cast<std::uint32_t>(blue);
}

[[nodiscard]] std::uint32_t blendPixel(
    const std::uint32_t destination,
    const std::uint32_t source,
    const BlendMode blendMode
) noexcept {
    if (blendMode == BlendMode::opaque) {
        return source;
    }

    const std::uint32_t sourceAlpha = source >> 24U;
    const std::uint32_t sourceRed = (source >> 16U) & 0xffU;
    const std::uint32_t sourceGreen = (source >> 8U) & 0xffU;
    const std::uint32_t sourceBlue = source & 0xffU;
    const std::uint32_t destinationAlpha = destination >> 24U;
    const std::uint32_t destinationRed = (destination >> 16U) & 0xffU;
    const std::uint32_t destinationGreen = (destination >> 8U) & 0xffU;
    const std::uint32_t destinationBlue = destination & 0xffU;

    if (blendMode == BlendMode::additivePremultiplied) {
        const std::uint32_t alpha = std::min(sourceAlpha + destinationAlpha, 255U);
        const std::uint32_t red = std::min(sourceRed + destinationRed, 255U);
        const std::uint32_t green = std::min(sourceGreen + destinationGreen, 255U);
        const std::uint32_t blue = std::min(sourceBlue + destinationBlue, 255U);
        return (alpha << 24U) | (red << 16U) | (green << 8U) | blue;
    }

    const std::uint32_t inverseAlpha = 255U - sourceAlpha;
    const auto composite = [inverseAlpha](
        const std::uint32_t sourceChannel,
        const std::uint32_t destinationChannel
    ) noexcept {
        return sourceChannel + (destinationChannel * inverseAlpha + 127U) / 255U;
    };
    const std::uint32_t alpha = composite(sourceAlpha, destinationAlpha);
    const std::uint32_t red = composite(sourceRed, destinationRed);
    const std::uint32_t green = composite(sourceGreen, destinationGreen);
    const std::uint32_t blue = composite(sourceBlue, destinationBlue);
    return (alpha << 24U) | (red << 16U) | (green << 8U) | blue;
}

[[nodiscard]] float finiteOr(const float value, const float fallback = 0.0F) noexcept {
    return std::isfinite(value) ? value : fallback;
}

[[nodiscard]] float clampUnit(const float value) noexcept {
    return std::clamp(finiteOr(value), 0.0F, 1.0F);
}

[[nodiscard]] PremultipliedRgba withOpacity(
    const PremultipliedRgba color,
    const float opacity
) noexcept {
    const float scale = clampUnit(opacity);
    return {
        finiteOr(color.red) * scale,
        finiteOr(color.green) * scale,
        finiteOr(color.blue) * scale,
        finiteOr(color.alpha) * scale
    };
}

[[nodiscard]] PremultipliedRgba withBrightness(
    const PremultipliedRgba color,
    const float brightness
) noexcept {
    const float alpha = clampUnit(color.alpha);
    const float scale = std::clamp(finiteOr(brightness, 1.0F), 0.0F, 2.0F);
    return {
        std::min(clampUnit(color.red) * scale, alpha),
        std::min(clampUnit(color.green) * scale, alpha),
        std::min(clampUnit(color.blue) * scale, alpha),
        alpha
    };
}

struct PointD final {
    double x = 0.0;
    double y = 0.0;
};

struct QuadD final {
    std::array<PointD, 4> points{};
};

struct RectD final {
    double left = 0.0;
    double top = 0.0;
    double right = 0.0;
    double bottom = 0.0;
};

[[nodiscard]] bool finiteCoordinate(const double value) noexcept {
    return std::isfinite(value) && std::abs(value) <= geometry_limit;
}

[[nodiscard]] bool finitePoint(const PointD point) noexcept {
    return finiteCoordinate(point.x) && finiteCoordinate(point.y);
}

struct PixelBounds final {
    int left = 0;
    int top = 0;
    int right = 0;
    int bottom = 0;

    [[nodiscard]] bool isEmpty() const noexcept {
        return right <= left || bottom <= top;
    }
};

[[nodiscard]] PixelBounds intersectBounds(
    const PixelBounds first,
    const PixelBounds second
) noexcept {
    return {
        std::max(first.left, second.left),
        std::max(first.top, second.top),
        std::min(first.right, second.right),
        std::min(first.bottom, second.bottom)
    };
}

struct Matrix3D final {
    std::array<double, 9> elements{
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    };
};

[[nodiscard]] bool matrixIsFinite(const Matrix3D& matrix) noexcept {
    return std::all_of(
        matrix.elements.begin(),
        matrix.elements.end(),
        [](const double value) noexcept { return std::isfinite(value); }
    );
}

[[nodiscard]] Matrix3D multiplyMatrices(
    const Matrix3D& first,
    const Matrix3D& second
) noexcept {
    Matrix3D result;
    for (std::size_t row = 0U; row < 3U; ++row) {
        for (std::size_t column = 0U; column < 3U; ++column) {
            result.elements[row * 3U + column] =
                first.elements[row * 3U] * second.elements[column]
                + first.elements[row * 3U + 1U] * second.elements[3U + column]
                + first.elements[row * 3U + 2U] * second.elements[6U + column];
        }
    }
    return result;
}

[[nodiscard]] Matrix3D matrixFrom(const Mat3F& source) noexcept {
    Matrix3D result;
    for (std::size_t index = 0U; index < result.elements.size(); ++index) {
        result.elements[index] = static_cast<double>(source.elements[index]);
    }
    return result;
}

[[nodiscard]] bool invertMatrix(
    const Matrix3D& source,
    Matrix3D& inverse
) noexcept {
    const auto& m = source.elements;
    const double cofactor00 = m[4] * m[8] - m[5] * m[7];
    const double cofactor01 = m[5] * m[6] - m[3] * m[8];
    const double cofactor02 = m[3] * m[7] - m[4] * m[6];
    const double determinant = m[0] * cofactor00
        + m[1] * cofactor01
        + m[2] * cofactor02;
    const double determinantScale =
        std::abs(m[0] * m[4] * m[8])
        + std::abs(m[1] * m[5] * m[6])
        + std::abs(m[2] * m[3] * m[7])
        + std::abs(m[2] * m[4] * m[6])
        + std::abs(m[1] * m[3] * m[8])
        + std::abs(m[0] * m[5] * m[7]);
    const double determinantTolerance =
        std::numeric_limits<double>::epsilon() * 64.0 * determinantScale;
    if (!std::isfinite(determinant)
        || !std::isfinite(determinantScale)
        || determinantScale == 0.0
        || std::abs(determinant) <= determinantTolerance) {
        return false;
    }

    const double reciprocal = 1.0 / determinant;
    inverse.elements = {
        cofactor00 * reciprocal,
        (m[2] * m[7] - m[1] * m[8]) * reciprocal,
        (m[1] * m[5] - m[2] * m[4]) * reciprocal,
        cofactor01 * reciprocal,
        (m[0] * m[8] - m[2] * m[6]) * reciprocal,
        (m[2] * m[3] - m[0] * m[5]) * reciprocal,
        cofactor02 * reciprocal,
        (m[1] * m[6] - m[0] * m[7]) * reciprocal,
        (m[0] * m[4] - m[1] * m[3]) * reciprocal
    };
    return matrixIsFinite(inverse);
}

[[nodiscard]] bool projectPoint(
    const Matrix3D& matrix,
    const double inputX,
    const double inputY,
    PointD& output,
    double* const homogeneousW = nullptr
) noexcept {
    const auto& m = matrix.elements;
    const double x = m[0] * inputX + m[1] * inputY + m[2];
    const double y = m[3] * inputX + m[4] * inputY + m[5];
    const double w = m[6] * inputX + m[7] * inputY + m[8];
    if (homogeneousW != nullptr) {
        *homogeneousW = w;
    }
    if (!std::isfinite(x)
        || !std::isfinite(y)
        || !std::isfinite(w)
        || w == 0.0) {
        return false;
    }
    output = {x / w, y / w};
    return finitePoint(output);
}

[[nodiscard]] double distance(const PointD first, const PointD second) noexcept {
    return std::hypot(first.x - second.x, first.y - second.y);
}

class CoordinateMapper final {
public:
    CoordinateMapper(
        const SDL_Surface& surface,
        const ViewportState& viewport
    ) noexcept
        : surface_(surface), viewport_(viewport) {
        valid_ = viewport_.drawable.size.width > 0
            && viewport_.drawable.size.height > 0
            && surface_.w > 0
            && surface_.h > 0;
        if (valid_) {
            surfaceScaleX_ = static_cast<double>(surface_.w)
                / static_cast<double>(viewport_.drawable.size.width);
            surfaceScaleY_ = static_cast<double>(surface_.h)
                / static_cast<double>(viewport_.drawable.size.height);
            valid_ = std::isfinite(surfaceScaleX_)
                && std::isfinite(surfaceScaleY_)
                && surfaceScaleX_ > 0.0
                && surfaceScaleY_ > 0.0;
        }
    }

    [[nodiscard]] bool isValid() const noexcept {
        return valid_;
    }

    [[nodiscard]] bool map(
        const double inputX,
        const double inputY,
        const CoordinateSpace coordinateSpace,
        PointD& output
    ) const noexcept {
        if (!valid_ || !finiteCoordinate(inputX) || !finiteCoordinate(inputY)) {
            return false;
        }

        double drawableX = 0.0;
        double drawableY = 0.0;
        switch (coordinateSpace) {
            case CoordinateSpace::physicalPixels: {
                const RectI bounds = viewport_.physical.windowBounds;
                if (bounds.width > 0 && bounds.height > 0) {
                    drawableX = (inputX - static_cast<double>(bounds.x))
                        * static_cast<double>(viewport_.drawable.size.width)
                        / static_cast<double>(bounds.width);
                    drawableY = (inputY - static_cast<double>(bounds.y))
                        * static_cast<double>(viewport_.drawable.size.height)
                        / static_cast<double>(bounds.height);
                } else {
                    drawableX = inputX;
                    drawableY = inputY;
                }
                break;
            }
            case CoordinateSpace::drawablePixels:
                drawableX = inputX;
                drawableY = inputY;
                break;
            case CoordinateSpace::logicalUi: {
                const double scaleX = logicalScaleX();
                const double scaleY = logicalScaleY();
                if (!(scaleX > 0.0) || !(scaleY > 0.0)) {
                    return false;
                }
                drawableX = static_cast<double>(viewport_.drawable.contentRect.x)
                    + (inputX - static_cast<double>(viewport_.logicalUi.contentRect.x)) * scaleX;
                drawableY = static_cast<double>(viewport_.drawable.contentRect.y)
                    + (inputY - static_cast<double>(viewport_.logicalUi.contentRect.y)) * scaleY;
                break;
            }
            case CoordinateSpace::world: {
                const auto& matrix = viewport_.world.worldToDrawable.elements;
                for (const float value : matrix) {
                    if (!std::isfinite(value)) {
                        return false;
                    }
                }
                const double homogeneousX = static_cast<double>(matrix[0]) * inputX
                    + static_cast<double>(matrix[1]) * inputY
                    + static_cast<double>(matrix[2]);
                const double homogeneousY = static_cast<double>(matrix[3]) * inputX
                    + static_cast<double>(matrix[4]) * inputY
                    + static_cast<double>(matrix[5]);
                const double homogeneousW = static_cast<double>(matrix[6]) * inputX
                    + static_cast<double>(matrix[7]) * inputY
                    + static_cast<double>(matrix[8]);
                if (!std::isfinite(homogeneousW) || std::abs(homogeneousW) <= minimum_denominator) {
                    return false;
                }
                drawableX = homogeneousX / homogeneousW;
                drawableY = homogeneousY / homogeneousW;
                break;
            }
        }

        output = {drawableX * surfaceScaleX_, drawableY * surfaceScaleY_};
        return finitePoint(output);
    }

    [[nodiscard]] double mapLength(
        const float length,
        const CoordinateSpace coordinateSpace
    ) const noexcept {
        if (!std::isfinite(length) || length <= 0.0F) {
            return 0.0;
        }
        PointD origin;
        PointD horizontal;
        PointD vertical;
        if (!map(0.0, 0.0, coordinateSpace, origin)
            || !map(static_cast<double>(length), 0.0, coordinateSpace, horizontal)
            || !map(0.0, static_cast<double>(length), coordinateSpace, vertical)) {
            return 0.0;
        }
        const double result = (distance(origin, horizontal) + distance(origin, vertical)) * 0.5;
        return std::isfinite(result) && result <= geometry_limit ? result : 0.0;
    }

    [[nodiscard]] bool makeScreenTransform(
        const CoordinateSpace coordinateSpace,
        Matrix3D& output
    ) const noexcept {
        if (!valid_) {
            return false;
        }

        Matrix3D drawableTransform;
        switch (coordinateSpace) {
            case CoordinateSpace::physicalPixels: {
                const RectI bounds = viewport_.physical.windowBounds;
                if (bounds.width > 0 && bounds.height > 0) {
                    const double drawableScaleX = static_cast<double>(
                        viewport_.drawable.size.width
                    ) / static_cast<double>(bounds.width);
                    const double drawableScaleY = static_cast<double>(
                        viewport_.drawable.size.height
                    ) / static_cast<double>(bounds.height);
                    drawableTransform.elements = {
                        drawableScaleX, 0.0,
                        -static_cast<double>(bounds.x) * drawableScaleX,
                        0.0, drawableScaleY,
                        -static_cast<double>(bounds.y) * drawableScaleY,
                        0.0, 0.0, 1.0
                    };
                }
                break;
            }
            case CoordinateSpace::drawablePixels:
                break;
            case CoordinateSpace::logicalUi: {
                const double scaleX = logicalScaleX();
                const double scaleY = logicalScaleY();
                if (!(scaleX > 0.0) || !(scaleY > 0.0)) {
                    return false;
                }
                drawableTransform.elements = {
                    scaleX,
                    0.0,
                    static_cast<double>(viewport_.drawable.contentRect.x)
                        - static_cast<double>(viewport_.logicalUi.contentRect.x) * scaleX,
                    0.0,
                    scaleY,
                    static_cast<double>(viewport_.drawable.contentRect.y)
                        - static_cast<double>(viewport_.logicalUi.contentRect.y) * scaleY,
                    0.0,
                    0.0,
                    1.0
                };
                break;
            }
            case CoordinateSpace::world:
                drawableTransform = matrixFrom(viewport_.world.worldToDrawable);
                break;
        }

        Matrix3D surfaceTransform;
        surfaceTransform.elements = {
            surfaceScaleX_, 0.0, 0.0,
            0.0, surfaceScaleY_, 0.0,
            0.0, 0.0, 1.0
        };
        output = multiplyMatrices(surfaceTransform, drawableTransform);
        return matrixIsFinite(output);
    }

private:
    [[nodiscard]] double logicalScaleX() const noexcept {
        const double declared = static_cast<double>(
            viewport_.logicalUi.drawablePixelsPerLogicalUnitX
        );
        if (std::isfinite(declared) && declared > 0.0) {
            return declared;
        }
        const double logicalWidth = static_cast<double>(viewport_.logicalUi.contentRect.width);
        return std::isfinite(logicalWidth) && logicalWidth > 0.0
            ? static_cast<double>(viewport_.drawable.contentRect.width) / logicalWidth
            : 0.0;
    }

    [[nodiscard]] double logicalScaleY() const noexcept {
        const double declared = static_cast<double>(
            viewport_.logicalUi.drawablePixelsPerLogicalUnitY
        );
        if (std::isfinite(declared) && declared > 0.0) {
            return declared;
        }
        const double logicalHeight = static_cast<double>(viewport_.logicalUi.contentRect.height);
        return std::isfinite(logicalHeight) && logicalHeight > 0.0
            ? static_cast<double>(viewport_.drawable.contentRect.height) / logicalHeight
            : 0.0;
    }

    const SDL_Surface& surface_;
    const ViewportState& viewport_;
    double surfaceScaleX_ = 0.0;
    double surfaceScaleY_ = 0.0;
    bool valid_ = false;
};

[[nodiscard]] bool makeQuad(
    const CoordinateMapper& mapper,
    const RectF rect,
    const CoordinateSpace coordinateSpace,
    const float rotationRadians,
    const double pivotX,
    const double pivotY,
    QuadD& output
) noexcept {
    if (!std::isfinite(rect.x)
        || !std::isfinite(rect.y)
        || !std::isfinite(rect.width)
        || !std::isfinite(rect.height)
        || !std::isfinite(rotationRadians)
        || rect.width == 0.0F
        || rect.height == 0.0F) {
        return false;
    }

    std::array<PointD, 4> input{
        PointD{rect.x, rect.y},
        PointD{static_cast<double>(rect.x) + rect.width, rect.y},
        PointD{
            static_cast<double>(rect.x) + rect.width,
            static_cast<double>(rect.y) + rect.height
        },
        PointD{rect.x, static_cast<double>(rect.y) + rect.height}
    };
    if (rotationRadians != 0.0F) {
        const double cosine = std::cos(static_cast<double>(rotationRadians));
        const double sine = std::sin(static_cast<double>(rotationRadians));
        if (!std::isfinite(cosine) || !std::isfinite(sine)) {
            return false;
        }
        for (PointD& point : input) {
            const double relativeX = point.x - pivotX;
            const double relativeY = point.y - pivotY;
            point = {
                pivotX + relativeX * cosine - relativeY * sine,
                pivotY + relativeX * sine + relativeY * cosine
            };
        }
    }

    for (std::size_t index = 0; index < input.size(); ++index) {
        if (!mapper.map(input[index].x, input[index].y, coordinateSpace, output.points[index])) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool makeCommandQuad(
    const CoordinateMapper& mapper,
    const RectF rect,
    const CommandHeader& header,
    const float rotationRadians,
    const Vec2F pivot,
    QuadD& output
) noexcept {
    if (!std::isfinite(pivot.x) || !std::isfinite(pivot.y)) {
        return false;
    }
    const double pivotX = static_cast<double>(rect.x)
        + static_cast<double>(rect.width) * pivot.x;
    const double pivotY = static_cast<double>(rect.y)
        + static_cast<double>(rect.height) * pivot.y;
    return makeQuad(
        mapper,
        rect,
        header.coordinateSpace,
        rotationRadians,
        pivotX,
        pivotY,
        output
    );
}

[[nodiscard]] RectD quadBounds(const QuadD& quad) noexcept {
    RectD result{
        quad.points[0].x,
        quad.points[0].y,
        quad.points[0].x,
        quad.points[0].y
    };
    for (const PointD point : quad.points) {
        result.left = std::min(result.left, point.x);
        result.top = std::min(result.top, point.y);
        result.right = std::max(result.right, point.x);
        result.bottom = std::max(result.bottom, point.y);
    }
    return result;
}

[[nodiscard]] PixelBounds clippedBounds(
    const RectD rect,
    const int width,
    const int height
) noexcept {
    if (!finitePoint({rect.left, rect.top})
        || !finitePoint({rect.right, rect.bottom})
        || rect.right <= rect.left
        || rect.bottom <= rect.top) {
        return {};
    }
    const double left = std::clamp(rect.left, 0.0, static_cast<double>(width));
    const double top = std::clamp(rect.top, 0.0, static_cast<double>(height));
    const double right = std::clamp(rect.right, 0.0, static_cast<double>(width));
    const double bottom = std::clamp(rect.bottom, 0.0, static_cast<double>(height));
    if (right <= left || bottom <= top) {
        return {};
    }
    return {
        static_cast<int>(std::floor(left)),
        static_cast<int>(std::floor(top)),
        static_cast<int>(std::ceil(right)),
        static_cast<int>(std::ceil(bottom))
    };
}

struct ProjectiveGeometry final {
    Matrix3D screenToLocal;
    QuadD screenQuad;
};

/** command local 좌표에서 CPU surface까지의 투영과 역투영을 함께 만든다. */
[[nodiscard]] bool makeProjectiveGeometry(
    const CoordinateMapper& mapper,
    const CoordinateSpace coordinateSpace,
    const Mat3F& localTransform,
    const RectF localBounds,
    ProjectiveGeometry& output
) noexcept {
    Matrix3D coordinateTransform;
    if (!mapper.makeScreenTransform(coordinateSpace, coordinateTransform)) {
        return false;
    }
    const Matrix3D localToScreen = multiplyMatrices(
        coordinateTransform,
        matrixFrom(localTransform)
    );
    if (!matrixIsFinite(localToScreen)
        || !invertMatrix(localToScreen, output.screenToLocal)) {
        return false;
    }

    const std::array<PointD, 4> corners{
        PointD{localBounds.x, localBounds.y},
        PointD{
            static_cast<double>(localBounds.x) + localBounds.width,
            localBounds.y
        },
        PointD{
            static_cast<double>(localBounds.x) + localBounds.width,
            static_cast<double>(localBounds.y) + localBounds.height
        },
        PointD{
            localBounds.x,
            static_cast<double>(localBounds.y) + localBounds.height
        }
    };
    std::array<double, 4> homogeneousWeights{};
    for (std::size_t index = 0U; index < corners.size(); ++index) {
        if (!projectPoint(
                localToScreen,
                corners[index].x,
                corners[index].y,
                output.screenQuad.points[index],
                &homogeneousWeights[index]
            )) {
            return false;
        }
    }

    const auto [minimumWeight, maximumWeight] = std::minmax_element(
        homogeneousWeights.begin(),
        homogeneousWeights.end()
    );
    return !(*minimumWeight < 0.0 && *maximumWeight > 0.0);
}

class QuadCoordinateMap final {
public:
    explicit QuadCoordinateMap(const QuadD& quad) noexcept
        : origin_(quad.points[0]),
          horizontal_{
              quad.points[1].x - quad.points[0].x,
              quad.points[1].y - quad.points[0].y
          },
          vertical_{
              quad.points[3].x - quad.points[0].x,
              quad.points[3].y - quad.points[0].y
          } {
        const double determinant = horizontal_.x * vertical_.y
            - horizontal_.y * vertical_.x;
        if (std::isfinite(determinant) && std::abs(determinant) > minimum_denominator) {
            inverseDeterminant_ = 1.0 / determinant;
            valid_ = true;
        }
    }

    [[nodiscard]] bool isValid() const noexcept {
        return valid_;
    }

    [[nodiscard]] bool map(
        const double pointX,
        const double pointY,
        double& u,
        double& v
    ) const noexcept {
        if (!valid_) {
            return false;
        }
        const double relativeX = pointX - origin_.x;
        const double relativeY = pointY - origin_.y;
        u = (relativeX * vertical_.y - relativeY * vertical_.x) * inverseDeterminant_;
        v = (horizontal_.x * relativeY - horizontal_.y * relativeX) * inverseDeterminant_;
        return std::isfinite(u) && std::isfinite(v);
    }

private:
    PointD origin_;
    PointD horizontal_;
    PointD vertical_;
    double inverseDeterminant_ = 0.0;
    bool valid_ = false;
};

[[nodiscard]] bool isAxisAligned(const QuadD& quad) noexcept {
    constexpr double epsilon = 1.0e-6;
    return std::abs(quad.points[0].y - quad.points[1].y) <= epsilon
        && std::abs(quad.points[1].x - quad.points[2].x) <= epsilon
        && std::abs(quad.points[2].y - quad.points[3].y) <= epsilon
        && std::abs(quad.points[3].x - quad.points[0].x) <= epsilon;
}

[[nodiscard]] bool pointInsideRoundedBounds(
    const PointD point,
    const RectD bounds,
    const double radius
) noexcept {
    if (point.x < bounds.left
        || point.x > bounds.right
        || point.y < bounds.top
        || point.y > bounds.bottom) {
        return false;
    }
    const double clampedRadius = std::clamp(
        radius,
        0.0,
        std::min(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.5
    );
    if (clampedRadius <= 0.0) {
        return true;
    }
    const double nearestX = std::clamp(
        point.x,
        bounds.left + clampedRadius,
        bounds.right - clampedRadius
    );
    const double nearestY = std::clamp(
        point.y,
        bounds.top + clampedRadius,
        bounds.bottom - clampedRadius
    );
    const double deltaX = point.x - nearestX;
    const double deltaY = point.y - nearestY;
    return deltaX * deltaX + deltaY * deltaY
        <= clampedRadius * clampedRadius;
}

[[nodiscard]] std::uint32_t mixPackedColor(
    const std::uint32_t first,
    const std::uint32_t second,
    const std::uint32_t numerator,
    const std::uint32_t denominator
) noexcept {
    const auto mixChannel = [numerator, denominator](
        const std::uint32_t firstChannel,
        const std::uint32_t secondChannel
    ) noexcept {
        return (
            firstChannel * (denominator - numerator)
            + secondChannel * numerator
            + denominator / 2U
        ) / denominator;
    };
    const std::uint32_t alpha = mixChannel(first >> 24U, second >> 24U);
    const std::uint32_t red = mixChannel(
        (first >> 16U) & 0xffU,
        (second >> 16U) & 0xffU
    );
    const std::uint32_t green = mixChannel(
        (first >> 8U) & 0xffU,
        (second >> 8U) & 0xffU
    );
    const std::uint32_t blue = mixChannel(
        first & 0xffU,
        second & 0xffU
    );
    return (alpha << 24U) | (red << 16U) | (green << 8U) | blue;
}

struct ClipEntry final {
    Matrix3D screenToLocal;
    RectD localBounds;
    PixelBounds effectiveBounds;
    double cornerRadius = 0.0;
    bool antialias = false;
    bool valid = false;
};

constexpr std::uint32_t clip_axis_samples = 4U;
constexpr std::uint32_t clip_sample_count = clip_axis_samples * clip_axis_samples;

class RasterCanvas final {
public:
    RasterCanvas(
        SDL_Surface& surface,
        SurfaceAccess& access,
        const ViewportState& viewport
    ) noexcept
        : surface_(surface), access_(access), mapper_(surface, viewport) {
    }

    [[nodiscard]] bool isValid() const noexcept {
        return mapper_.isValid();
    }

    [[nodiscard]] const CoordinateMapper& mapper() const noexcept {
        return mapper_;
    }

    [[nodiscard]] PixelBounds rasterBounds(const RectD bounds) const noexcept {
        PixelBounds pixels = clippedBounds(bounds, surface_.w, surface_.h);
        if (clipDepth_ > 0U) {
            pixels = intersectBounds(
                pixels,
                clipStack_[clipDepth_ - 1U].effectiveBounds
            );
        }
        return pixels;
    }

    [[nodiscard]] bool hasActiveClip() const noexcept {
        return clipDepth_ > 0U;
    }

    /** 고정 깊이 clip stack에 push/pop을 적용하고 누적 dirty bounds를 갱신한다. */
    [[nodiscard]] bool applyClip(const ClipCommand& command) noexcept {
        if (command.operation == ClipOperation::pop) {
            if (clipDepth_ == 0U) {
                return false;
            }
            --clipDepth_;
            return true;
        }
        if (clipDepth_ >= clipStack_.size()) {
            return false;
        }

        ClipEntry& entry = clipStack_[clipDepth_];
        entry = {};
        entry.antialias = command.antialias != 0U;
        entry.cornerRadius = command.operation == ClipOperation::pushRoundedRect
            ? static_cast<double>(command.cornerRadius)
            : 0.0;
        entry.localBounds = {
            command.bounds.x,
            command.bounds.y,
            static_cast<double>(command.bounds.x) + command.bounds.width,
            static_cast<double>(command.bounds.y) + command.bounds.height
        };

        bool geometryValid = command.bounds.width > 0.0F
            && command.bounds.height > 0.0F;
        ProjectiveGeometry geometry;
        if (geometryValid) {
            geometryValid = makeProjectiveGeometry(
                mapper_,
                command.header.coordinateSpace,
                command.transform,
                command.bounds,
                geometry
            );
        }
        if (geometryValid) {
            entry.screenToLocal = geometry.screenToLocal;
            entry.effectiveBounds = clippedBounds(
                quadBounds(geometry.screenQuad),
                surface_.w,
                surface_.h
            );
            entry.valid = true;
        }
        if (clipDepth_ > 0U) {
            entry.effectiveBounds = intersectBounds(
                entry.effectiveBounds,
                clipStack_[clipDepth_ - 1U].effectiveBounds
            );
        }
        ++clipDepth_;
        // 면적 0 clip은 정상적인 빈 교집합이다. 역변환할 수 없는 투영은 빈
        // clip으로 격리하되 해당 명령은 skipped로 계측한다.
        return geometryValid
            || command.bounds.width == 0.0F
            || command.bounds.height == 0.0F;
    }

    void blendAt(
        const int x,
        const int y,
        const std::uint32_t source,
        const BlendMode blendMode
    ) noexcept {
        if (x < 0 || y < 0 || x >= surface_.w || y >= surface_.h) {
            return;
        }
        const std::uint32_t coverage = clipCoverage(x, y);
        if (coverage == 0U) {
            return;
        }
        std::uint32_t* const destination = access_.row(y) + x;
        if (coverage == clip_sample_count) {
            *destination = blendPixel(*destination, source, blendMode);
            return;
        }
        const std::uint32_t fullyBlended = blendPixel(
            *destination,
            source,
            blendMode
        );
        *destination = mixPackedColor(
            *destination,
            fullyBlended,
            coverage,
            clip_sample_count
        );
    }

    [[nodiscard]] bool drawSolidQuad(
        const QuadD& quad,
        const PremultipliedRgba color,
        const BlendMode blendMode
    ) noexcept {
        const PixelBounds bounds = rasterBounds(quadBounds(quad));
        if (bounds.isEmpty()) {
            return false;
        }
        const std::uint32_t source = packColor(color);
        if ((source >> 24U) == 0U && blendMode != BlendMode::opaque) {
            return true;
        }

        if (isAxisAligned(quad) && !hasActiveClip()) {
            for (int y = bounds.top; y < bounds.bottom; ++y) {
                std::uint32_t* const row = access_.row(y);
                if (blendMode == BlendMode::opaque) {
                    std::fill(row + bounds.left, row + bounds.right, source);
                } else {
                    for (int x = bounds.left; x < bounds.right; ++x) {
                        row[x] = blendPixel(row[x], source, blendMode);
                    }
                }
            }
            return true;
        }

        const QuadCoordinateMap coordinates(quad);
        if (!coordinates.isValid()) {
            return false;
        }
        for (int y = bounds.top; y < bounds.bottom; ++y) {
            for (int x = bounds.left; x < bounds.right; ++x) {
                double u = 0.0;
                double v = 0.0;
                if (coordinates.map(
                        static_cast<double>(x) + 0.5,
                        static_cast<double>(y) + 0.5,
                        u,
                        v
                    )
                    && u >= 0.0
                    && u <= 1.0
                    && v >= 0.0
                    && v <= 1.0) {
                    blendAt(x, y, source, blendMode);
                }
            }
        }
        return true;
    }

    [[nodiscard]] bool drawSprite(const SpriteCommand& command) noexcept {
        QuadD quad;
        if (!makeCommandQuad(
                mapper_,
                command.destination,
                command.header,
                command.rotationRadians,
                command.pivot,
                quad
            )
            || !std::isfinite(command.uv.x)
            || !std::isfinite(command.uv.y)
            || !std::isfinite(command.uv.width)
            || !std::isfinite(command.uv.height)) {
            return false;
        }
        const PixelBounds bounds = rasterBounds(quadBounds(quad));
        if (bounds.isEmpty()) {
            return false;
        }

        const std::uint32_t resourcePattern = static_cast<std::uint32_t>(
            command.textureId ^ (command.textureId >> 32U)
        );
        const QuadCoordinateMap coordinates(quad);
        if (!coordinates.isValid()) {
            return false;
        }
        const std::uint32_t dark = packColor(withBrightness(command.tint, 0.58F));
        const std::uint32_t light = packColor(withBrightness(command.tint, 0.94F));
        for (int y = bounds.top; y < bounds.bottom; ++y) {
            for (int x = bounds.left; x < bounds.right; ++x) {
                double u = 0.0;
                double v = 0.0;
                if (!coordinates.map(
                        static_cast<double>(x) + 0.5,
                        static_cast<double>(y) + 0.5,
                        u,
                        v
                    )
                    || u < 0.0
                    || u > 1.0
                    || v < 0.0
                    || v > 1.0) {
                    continue;
                }
                if (command.flipX != 0U) {
                    u = 1.0 - u;
                }
                if (command.flipY != 0U) {
                    v = 1.0 - v;
                }
                const double textureU = static_cast<double>(command.uv.x)
                    + u * static_cast<double>(command.uv.width);
                const double textureV = static_cast<double>(command.uv.y)
                    + v * static_cast<double>(command.uv.height);
                if (!finiteCoordinate(textureU) || !finiteCoordinate(textureV)) {
                    continue;
                }
                const auto cellX = static_cast<std::int64_t>(std::floor(textureU * 16.0));
                const auto cellY = static_cast<std::int64_t>(std::floor(textureV * 9.0));
                const std::uint64_t checker = static_cast<std::uint64_t>(cellX)
                    ^ static_cast<std::uint64_t>(cellY)
                    ^ resourcePattern;
                const std::uint32_t source = (checker & 1U) == 0U ? dark : light;
                if (hasActiveClip()) {
                    blendAt(x, y, source, command.header.blendMode);
                } else {
                    std::uint32_t* const destination = access_.row(y) + x;
                    *destination = blendPixel(
                        *destination,
                        source,
                        command.header.blendMode
                    );
                }
            }
        }
        return true;
    }

    [[nodiscard]] bool drawLineScreen(
        PointD start,
        PointD end,
        const double width,
        const PremultipliedRgba color,
        const BlendMode blendMode,
        const LineCap cap
    ) noexcept {
        if (!finitePoint(start)
            || !finitePoint(end)
            || !std::isfinite(width)
            || width <= 0.0) {
            return false;
        }
        const double halfWidth = std::max(width * 0.5, 0.5);
        double deltaX = end.x - start.x;
        double deltaY = end.y - start.y;
        double lengthSquared = deltaX * deltaX + deltaY * deltaY;
        if (!std::isfinite(lengthSquared)) {
            return false;
        }
        if (lengthSquared <= minimum_denominator) {
            return drawDisc(start, halfWidth, color, blendMode);
        }

        if (cap == LineCap::square) {
            const double inverseLength = 1.0 / std::sqrt(lengthSquared);
            const double extensionX = deltaX * inverseLength * halfWidth;
            const double extensionY = deltaY * inverseLength * halfWidth;
            start.x -= extensionX;
            start.y -= extensionY;
            end.x += extensionX;
            end.y += extensionY;
            deltaX = end.x - start.x;
            deltaY = end.y - start.y;
            lengthSquared = deltaX * deltaX + deltaY * deltaY;
        }

        const PixelBounds bounds = rasterBounds(
            {
                std::min(start.x, end.x) - halfWidth,
                std::min(start.y, end.y) - halfWidth,
                std::max(start.x, end.x) + halfWidth,
                std::max(start.y, end.y) + halfWidth
            }
        );
        if (bounds.isEmpty()) {
            return false;
        }
        const double maximumDistanceSquared = halfWidth * halfWidth;
        const std::uint32_t source = packColor(color);
        for (int y = bounds.top; y < bounds.bottom; ++y) {
            for (int x = bounds.left; x < bounds.right; ++x) {
                const double pointX = static_cast<double>(x) + 0.5;
                const double pointY = static_cast<double>(y) + 0.5;
                const double projection = ((pointX - start.x) * deltaX
                    + (pointY - start.y) * deltaY) / lengthSquared;
                if (cap == LineCap::butt && (projection < 0.0 || projection > 1.0)) {
                    continue;
                }
                const double clampedProjection = std::clamp(projection, 0.0, 1.0);
                const double closestX = start.x + deltaX * clampedProjection;
                const double closestY = start.y + deltaY * clampedProjection;
                const double distanceX = pointX - closestX;
                const double distanceY = pointY - closestY;
                if (distanceX * distanceX + distanceY * distanceY <= maximumDistanceSquared) {
                    blendAt(x, y, source, blendMode);
                }
            }
        }
        return true;
    }

    [[nodiscard]] bool drawLine(const LineCommand& command) noexcept {
        PointD start;
        PointD end;
        if (!mapper_.map(
                command.start.x,
                command.start.y,
                command.header.coordinateSpace,
                start
            )
            || !mapper_.map(
                command.end.x,
                command.end.y,
                command.header.coordinateSpace,
                end
            )) {
            return false;
        }
        return drawLineScreen(
            start,
            end,
            mapper_.mapLength(command.width, command.header.coordinateSpace),
            command.color,
            command.header.blendMode,
            command.cap
        );
    }

private:
    [[nodiscard]] bool clipContains(
        const ClipEntry& entry,
        const double screenX,
        const double screenY
    ) const noexcept {
        if (!entry.valid) {
            return false;
        }
        PointD local;
        if (!projectPoint(entry.screenToLocal, screenX, screenY, local)) {
            return false;
        }
        return pointInsideRoundedBounds(
            local,
            entry.localBounds,
            entry.cornerRadius
        );
    }

    [[nodiscard]] bool clipsContain(
        const double screenX,
        const double screenY,
        const bool antialias
    ) const noexcept {
        for (std::size_t index = 0U; index < clipDepth_; ++index) {
            if (clipStack_[index].antialias == antialias
                && !clipContains(clipStack_[index], screenX, screenY)) {
                return false;
            }
        }
        return true;
    }

    [[nodiscard]] std::uint32_t clipCoverage(
        const int x,
        const int y
    ) const noexcept {
        if (clipDepth_ == 0U) {
            return clip_sample_count;
        }
        const PixelBounds effective = clipStack_[clipDepth_ - 1U].effectiveBounds;
        if (x < effective.left
            || x >= effective.right
            || y < effective.top
            || y >= effective.bottom) {
            return 0U;
        }

        const double centerX = static_cast<double>(x) + 0.5;
        const double centerY = static_cast<double>(y) + 0.5;
        if (!clipsContain(centerX, centerY, false)) {
            return 0U;
        }

        bool hasAntialiasClip = false;
        for (std::size_t index = 0U; index < clipDepth_; ++index) {
            hasAntialiasClip = hasAntialiasClip || clipStack_[index].antialias;
        }
        if (!hasAntialiasClip) {
            return clip_sample_count;
        }

        std::uint32_t coverage = 0U;
        for (std::uint32_t sampleY = 0U;
             sampleY < clip_axis_samples;
             ++sampleY) {
            for (std::uint32_t sampleX = 0U;
                 sampleX < clip_axis_samples;
                 ++sampleX) {
                const double offsetX = (
                    static_cast<double>(sampleX) + 0.5
                ) / static_cast<double>(clip_axis_samples);
                const double offsetY = (
                    static_cast<double>(sampleY) + 0.5
                ) / static_cast<double>(clip_axis_samples);
                if (clipsContain(
                        static_cast<double>(x) + offsetX,
                        static_cast<double>(y) + offsetY,
                        true
                    )) {
                    ++coverage;
                }
            }
        }
        return coverage;
    }

    [[nodiscard]] bool drawDisc(
        const PointD center,
        const double radius,
        const PremultipliedRgba color,
        const BlendMode blendMode
    ) noexcept {
        const PixelBounds bounds = rasterBounds(
            {center.x - radius, center.y - radius, center.x + radius, center.y + radius}
        );
        if (bounds.isEmpty()) {
            return false;
        }
        const double radiusSquared = radius * radius;
        const std::uint32_t source = packColor(color);
        for (int y = bounds.top; y < bounds.bottom; ++y) {
            for (int x = bounds.left; x < bounds.right; ++x) {
                const double deltaX = static_cast<double>(x) + 0.5 - center.x;
                const double deltaY = static_cast<double>(y) + 0.5 - center.y;
                if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) {
                    blendAt(x, y, source, blendMode);
                }
            }
        }
        return true;
    }

public:
    SDL_Surface& surface_;
    SurfaceAccess& access_;
    CoordinateMapper mapper_;

private:
    static constexpr std::size_t maximum_clip_depth = 64U;
    std::array<ClipEntry, maximum_clip_depth> clipStack_{};
    std::size_t clipDepth_ = 0U;
};

[[nodiscard]] bool insideRoundedRectangle(
    const double x,
    const double y,
    const RectD rect,
    const double radius
) noexcept {
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        return false;
    }
    const double clampedRadius = std::clamp(
        radius,
        0.0,
        std::min(rect.right - rect.left, rect.bottom - rect.top) * 0.5
    );
    if (clampedRadius <= 0.0) {
        return true;
    }
    const double nearestX = std::clamp(
        x,
        rect.left + clampedRadius,
        rect.right - clampedRadius
    );
    const double nearestY = std::clamp(
        y,
        rect.top + clampedRadius,
        rect.bottom - clampedRadius
    );
    const double deltaX = x - nearestX;
    const double deltaY = y - nearestY;
    return deltaX * deltaX + deltaY * deltaY <= clampedRadius * clampedRadius;
}

[[nodiscard]] bool drawRoundedRectangleScreen(
    RasterCanvas& canvas,
    RectD rect,
    const double radius,
    const double borderWidth,
    const PremultipliedRgba fillColor,
    const PremultipliedRgba borderColor,
    const BlendMode blendMode,
    const bool fillEnabled = true,
    const bool borderEnabled = true
) noexcept {
    if (!finitePoint({rect.left, rect.top})
        || !finitePoint({rect.right, rect.bottom})) {
        return false;
    }
    if (rect.left > rect.right) {
        std::swap(rect.left, rect.right);
    }
    if (rect.top > rect.bottom) {
        std::swap(rect.top, rect.bottom);
    }
    const PixelBounds bounds = canvas.rasterBounds(rect);
    if (bounds.isEmpty()) {
        return false;
    }

    const double safeRadius = std::max(finiteOr(static_cast<float>(radius)), 0.0F);
    const double safeBorder = std::clamp(
        std::isfinite(borderWidth) ? borderWidth : 0.0,
        0.0,
        std::min(rect.right - rect.left, rect.bottom - rect.top) * 0.5
    );
    const RectD inner{
        rect.left + safeBorder,
        rect.top + safeBorder,
        rect.right - safeBorder,
        rect.bottom - safeBorder
    };
    const double innerRadius = std::max(safeRadius - safeBorder, 0.0);
    const std::uint32_t fill = packColor(fillColor);
    const std::uint32_t border = packColor(borderColor);

    for (int y = bounds.top; y < bounds.bottom; ++y) {
        for (int x = bounds.left; x < bounds.right; ++x) {
            const double sampleX = static_cast<double>(x) + 0.5;
            const double sampleY = static_cast<double>(y) + 0.5;
            if (!insideRoundedRectangle(sampleX, sampleY, rect, safeRadius)) {
                continue;
            }
            const bool inInner = safeBorder <= 0.0
                || insideRoundedRectangle(sampleX, sampleY, inner, innerRadius);
            if (borderEnabled && safeBorder > 0.0 && !inInner) {
                canvas.blendAt(x, y, border, blendMode);
            } else if (fillEnabled) {
                canvas.blendAt(x, y, fill, blendMode);
            }
        }
    }
    return true;
}

[[nodiscard]] bool drawEllipseScreen(
    RasterCanvas& canvas,
    RectD rect,
    const double strokeWidth,
    const PremultipliedRgba fillColor,
    const PremultipliedRgba strokeColor,
    const BlendMode blendMode,
    const bool fillEnabled,
    const bool strokeEnabled
) noexcept {
    if (rect.left > rect.right) {
        std::swap(rect.left, rect.right);
    }
    if (rect.top > rect.bottom) {
        std::swap(rect.top, rect.bottom);
    }
    const double radiusX = (rect.right - rect.left) * 0.5;
    const double radiusY = (rect.bottom - rect.top) * 0.5;
    if (!std::isfinite(radiusX)
        || !std::isfinite(radiusY)
        || radiusX <= 0.0
        || radiusY <= 0.0) {
        return false;
    }
    const PixelBounds bounds = canvas.rasterBounds(rect);
    if (bounds.isEmpty()) {
        return false;
    }
    const double centerX = (rect.left + rect.right) * 0.5;
    const double centerY = (rect.top + rect.bottom) * 0.5;
    const double safeStroke = std::clamp(
        std::isfinite(strokeWidth) ? strokeWidth : 0.0,
        0.0,
        std::min(radiusX, radiusY)
    );
    const double innerRadiusX = radiusX - safeStroke;
    const double innerRadiusY = radiusY - safeStroke;
    const std::uint32_t fill = packColor(fillColor);
    const std::uint32_t stroke = packColor(strokeColor);

    for (int y = bounds.top; y < bounds.bottom; ++y) {
        for (int x = bounds.left; x < bounds.right; ++x) {
            const double deltaX = static_cast<double>(x) + 0.5 - centerX;
            const double deltaY = static_cast<double>(y) + 0.5 - centerY;
            const double outerDistance = deltaX * deltaX / (radiusX * radiusX)
                + deltaY * deltaY / (radiusY * radiusY);
            if (outerDistance > 1.0) {
                continue;
            }
            bool inInner = false;
            if (innerRadiusX > 0.0 && innerRadiusY > 0.0) {
                inInner = deltaX * deltaX / (innerRadiusX * innerRadiusX)
                    + deltaY * deltaY / (innerRadiusY * innerRadiusY) <= 1.0;
            }
            if (strokeEnabled && safeStroke > 0.0 && !inInner) {
                canvas.blendAt(x, y, stroke, blendMode);
            } else if (fillEnabled) {
                canvas.blendAt(x, y, fill, blendMode);
            }
        }
    }
    return true;
}

[[nodiscard]] bool pointInsidePolygon(
    const PointD point,
    const std::span<const PointD> vertices
) noexcept {
    bool inside = false;
    std::size_t previous = vertices.size() - 1U;
    for (std::size_t current = 0; current < vertices.size(); ++current) {
        const PointD first = vertices[current];
        const PointD second = vertices[previous];
        const bool crosses = (first.y > point.y) != (second.y > point.y);
        if (crosses) {
            const double denominator = second.y - first.y;
            if (std::abs(denominator) > minimum_denominator) {
                const double crossingX = (second.x - first.x) * (point.y - first.y)
                    / denominator + first.x;
                if (point.x < crossingX) {
                    inside = !inside;
                }
            }
        }
        previous = current;
    }
    return inside;
}

[[nodiscard]] bool drawPolygonScreen(
    RasterCanvas& canvas,
    const std::span<const PointD> vertices,
    const double strokeWidth,
    const PremultipliedRgba fillColor,
    const PremultipliedRgba strokeColor,
    const BlendMode blendMode,
    const bool fillEnabled,
    const bool strokeEnabled
) noexcept {
    if (vertices.size() < 3U) {
        return false;
    }
    RectD bounds{
        vertices[0].x,
        vertices[0].y,
        vertices[0].x,
        vertices[0].y
    };
    for (const PointD vertex : vertices) {
        if (!finitePoint(vertex)) {
            return false;
        }
        bounds.left = std::min(bounds.left, vertex.x);
        bounds.top = std::min(bounds.top, vertex.y);
        bounds.right = std::max(bounds.right, vertex.x);
        bounds.bottom = std::max(bounds.bottom, vertex.y);
    }
    const PixelBounds pixels = canvas.rasterBounds(bounds);
    if (pixels.isEmpty()) {
        return false;
    }
    if (fillEnabled) {
        const std::uint32_t source = packColor(fillColor);
        for (int y = pixels.top; y < pixels.bottom; ++y) {
            for (int x = pixels.left; x < pixels.right; ++x) {
                if (pointInsidePolygon(
                        {static_cast<double>(x) + 0.5, static_cast<double>(y) + 0.5},
                        vertices
                    )) {
                    canvas.blendAt(x, y, source, blendMode);
                }
            }
        }
    }
    if (strokeEnabled && strokeWidth > 0.0) {
        for (std::size_t index = 0; index < vertices.size(); ++index) {
            const PointD start = vertices[index];
            const PointD end = vertices[(index + 1U) % vertices.size()];
            (void)canvas.drawLineScreen(
                start,
                end,
                strokeWidth,
                strokeColor,
                blendMode,
                LineCap::round
            );
        }
    }
    return true;
}

[[nodiscard]] bool makeRegularPolygon(
    const RasterCanvas& canvas,
    const ShapeCommand& command,
    const std::size_t vertexCount,
    std::array<PointD, 8>& output
) noexcept {
    if (vertexCount < 3U
        || vertexCount > output.size()
        || !std::isfinite(command.bounds.x)
        || !std::isfinite(command.bounds.y)
        || !std::isfinite(command.bounds.width)
        || !std::isfinite(command.bounds.height)
        || !std::isfinite(command.rotationRadians)) {
        return false;
    }
    const double centerX = static_cast<double>(command.bounds.x)
        + static_cast<double>(command.bounds.width) * 0.5;
    const double centerY = static_cast<double>(command.bounds.y)
        + static_cast<double>(command.bounds.height) * 0.5;
    const double radiusX = std::abs(static_cast<double>(command.bounds.width)) * 0.5;
    const double radiusY = std::abs(static_cast<double>(command.bounds.height)) * 0.5;
    if (radiusX <= 0.0 || radiusY <= 0.0) {
        return false;
    }
    for (std::size_t index = 0; index < vertexCount; ++index) {
        const double angle = -std::numbers::pi_v<double> * 0.5
            + static_cast<double>(command.rotationRadians)
            + std::numbers::pi_v<double> * 2.0
                * static_cast<double>(index) / static_cast<double>(vertexCount);
        if (!canvas.mapper().map(
                centerX + std::cos(angle) * radiusX,
                centerY + std::sin(angle) * radiusY,
                command.header.coordinateSpace,
                output[index]
            )) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool drawArrow(
    RasterCanvas& canvas,
    const ShapeCommand& command
) noexcept {
    constexpr std::array<PointD, 7> normalized{
        PointD{0.0, 0.32},
        PointD{0.58, 0.32},
        PointD{0.58, 0.0},
        PointD{1.0, 0.5},
        PointD{0.58, 1.0},
        PointD{0.58, 0.68},
        PointD{0.0, 0.68}
    };
    if (!std::isfinite(command.rotationRadians)) {
        return false;
    }
    const double centerX = static_cast<double>(command.bounds.x)
        + static_cast<double>(command.bounds.width) * 0.5;
    const double centerY = static_cast<double>(command.bounds.y)
        + static_cast<double>(command.bounds.height) * 0.5;
    const double cosine = std::cos(static_cast<double>(command.rotationRadians));
    const double sine = std::sin(static_cast<double>(command.rotationRadians));
    std::array<PointD, 7> vertices{};
    for (std::size_t index = 0; index < normalized.size(); ++index) {
        const double x = static_cast<double>(command.bounds.x)
            + normalized[index].x * command.bounds.width;
        const double y = static_cast<double>(command.bounds.y)
            + normalized[index].y * command.bounds.height;
        const double relativeX = x - centerX;
        const double relativeY = y - centerY;
        if (!canvas.mapper().map(
                centerX + relativeX * cosine - relativeY * sine,
                centerY + relativeX * sine + relativeY * cosine,
                command.header.coordinateSpace,
                vertices[index]
            )) {
            return false;
        }
    }
    return drawPolygonScreen(
        canvas,
        vertices,
        canvas.mapper().mapLength(command.strokeWidth, command.header.coordinateSpace),
        command.fill,
        command.stroke,
        command.header.blendMode,
        command.fillEnabled != 0U,
        command.strokeEnabled != 0U
    );
}

[[nodiscard]] bool drawShape(
    RasterCanvas& canvas,
    const ShapeCommand& command
) noexcept {
    const double strokeWidth = canvas.mapper().mapLength(
        command.strokeWidth,
        command.header.coordinateSpace
    );
    if (command.shape == ShapeType::rectangle
        || command.shape == ShapeType::roundedRectangle) {
        QuadD quad;
        if (!makeCommandQuad(
                canvas.mapper(),
                command.bounds,
                command.header,
                command.rotationRadians,
                {0.5F, 0.5F},
                quad
            )) {
            return false;
        }
        if (command.shape == ShapeType::rectangle || !isAxisAligned(quad)) {
            const bool filled = command.fillEnabled == 0U
                || canvas.drawSolidQuad(quad, command.fill, command.header.blendMode);
            if (command.strokeEnabled != 0U && strokeWidth > 0.0) {
                for (std::size_t index = 0; index < quad.points.size(); ++index) {
                    (void)canvas.drawLineScreen(
                        quad.points[index],
                        quad.points[(index + 1U) % quad.points.size()],
                        strokeWidth,
                        command.stroke,
                        command.header.blendMode,
                        LineCap::round
                    );
                }
            }
            return filled;
        }
        return drawRoundedRectangleScreen(
            canvas,
            quadBounds(quad),
            canvas.mapper().mapLength(command.cornerRadius, command.header.coordinateSpace),
            strokeWidth,
            command.fill,
            command.stroke,
            command.header.blendMode,
            command.fillEnabled != 0U,
            command.strokeEnabled != 0U
        );
    }

    if (command.shape == ShapeType::circle) {
        QuadD quad;
        if (!makeCommandQuad(
                canvas.mapper(),
                command.bounds,
                command.header,
                command.rotationRadians,
                {0.5F, 0.5F},
                quad
            )) {
            return false;
        }
        return drawEllipseScreen(
            canvas,
            quadBounds(quad),
            strokeWidth,
            command.fill,
            command.stroke,
            command.header.blendMode,
            command.fillEnabled != 0U,
            command.strokeEnabled != 0U
        );
    }

    if (command.shape == ShapeType::arrow) {
        return drawArrow(canvas, command);
    }

    std::size_t vertexCount = 0;
    switch (command.shape) {
        case ShapeType::triangle:
            vertexCount = 3U;
            break;
        case ShapeType::pentagon:
            vertexCount = 5U;
            break;
        case ShapeType::hexagon:
            vertexCount = 6U;
            break;
        case ShapeType::octagon:
            vertexCount = 8U;
            break;
        case ShapeType::rectangle:
        case ShapeType::roundedRectangle:
        case ShapeType::circle:
        case ShapeType::arrow:
            break;
    }
    std::array<PointD, 8> vertices{};
    if (!makeRegularPolygon(canvas, command, vertexCount, vertices)) {
        return false;
    }
    return drawPolygonScreen(
        canvas,
        std::span<const PointD>(vertices.data(), vertexCount),
        strokeWidth,
        command.fill,
        command.stroke,
        command.header.blendMode,
        command.fillEnabled != 0U,
        command.strokeEnabled != 0U
    );
}

[[nodiscard]] bool decodeUtf8CodePoint(
    const std::string_view text,
    std::size_t& offset,
    std::uint32_t& codePoint
) noexcept {
    if (offset >= text.size()) {
        return false;
    }
    const auto byte = [&text](const std::size_t index) noexcept {
        return static_cast<std::uint8_t>(text[index]);
    };
    const std::uint8_t first = byte(offset);
    if (first < 0x80U) {
        codePoint = first;
        ++offset;
        return true;
    }

    std::size_t byteCount = 0;
    std::uint32_t minimum = 0;
    std::uint32_t value = 0;
    if ((first & 0xe0U) == 0xc0U) {
        byteCount = 2U;
        minimum = 0x80U;
        value = first & 0x1fU;
    } else if ((first & 0xf0U) == 0xe0U) {
        byteCount = 3U;
        minimum = 0x800U;
        value = first & 0x0fU;
    } else if ((first & 0xf8U) == 0xf0U) {
        byteCount = 4U;
        minimum = 0x1'0000U;
        value = first & 0x07U;
    } else {
        codePoint = 0xfffdU;
        ++offset;
        return true;
    }
    if (byteCount > text.size() - offset) {
        codePoint = 0xfffdU;
        ++offset;
        return true;
    }
    for (std::size_t index = 1U; index < byteCount; ++index) {
        const std::uint8_t continuation = byte(offset + index);
        if ((continuation & 0xc0U) != 0x80U) {
            codePoint = 0xfffdU;
            ++offset;
            return true;
        }
        value = (value << 6U) | (continuation & 0x3fU);
    }
    offset += byteCount;
    if (value < minimum
        || value > 0x10'ffffU
        || (value >= 0xd800U && value <= 0xdfffU)) {
        codePoint = 0xfffdU;
    } else {
        codePoint = value;
    }
    return true;
}

[[nodiscard]] std::uint32_t mixCodePoint(std::uint32_t value) noexcept {
    value ^= value >> 16U;
    value *= 0x7feb'352dU;
    value ^= value >> 15U;
    value *= 0x846c'a68bU;
    value ^= value >> 16U;
    return value;
}

[[nodiscard]] bool placeholderCellIsSet(
    const std::uint32_t codePoint,
    const std::uint32_t column,
    const std::uint32_t row
) noexcept {
    if (codePoint == 0x20U || codePoint == 0x09U) {
        return false;
    }
    const std::uint32_t cell = row * 5U + column;
    const std::uint32_t mixed = mixCodePoint(codePoint ^ (cell * 0x9e37'79b9U));
    const bool identityBit = ((codePoint >> (cell % 21U)) & 1U) != 0U;
    const bool textureBit = (mixed & 3U) == 0U;
    const bool anchor = (row == 0U || row == 6U) && (column == 1U || column == 3U);
    return identityBit != textureBit || anchor;
}

[[nodiscard]] std::size_t countPlaceholderGlyphs(
    const std::string_view text,
    const std::size_t limit
) noexcept {
    std::size_t offset = 0;
    std::size_t count = 0;
    while (count < limit) {
        std::uint32_t codePoint = 0;
        if (!decodeUtf8CodePoint(text, offset, codePoint)) {
            break;
        }
        ++count;
    }
    return count;
}

[[nodiscard]] bool drawText(
    RasterCanvas& canvas,
    const FramePacket& frame,
    const TextCommand& command
) noexcept {
    const std::string_view text = frame.text(command.utf8);
    if (text.empty()) {
        return true;
    }
    if (!std::isfinite(command.origin.x)
        || !std::isfinite(command.origin.y)
        || !std::isfinite(command.fontSize)
        || !std::isfinite(command.maximumSize.width)
        || !std::isfinite(command.maximumSize.height)
        || !std::isfinite(command.rotationRadians)
        || command.fontSize <= 0.0F) {
        return false;
    }

    double glyphHeight = static_cast<double>(command.fontSize);
    if (command.maximumSize.height > 0.0F) {
        glyphHeight = std::min(glyphHeight, static_cast<double>(command.maximumSize.height));
    }
    const double glyphWidth = glyphHeight * 0.56;
    const double advance = glyphHeight * 0.64;
    if (!(glyphWidth > 0.0) || !(advance > 0.0)) {
        return false;
    }
    std::size_t glyphLimit = maximum_placeholder_glyphs;
    if (command.maximumSize.width > 0.0F) {
        const double widthLimit = std::floor(
            static_cast<double>(command.maximumSize.width) / advance
        );
        if (!std::isfinite(widthLimit) || widthLimit <= 0.0) {
            return true;
        }
        glyphLimit = std::min(
            glyphLimit,
            static_cast<std::size_t>(
                std::min(widthLimit, static_cast<double>(maximum_placeholder_glyphs))
            )
        );
    }
    const std::size_t glyphCount = countPlaceholderGlyphs(text, glyphLimit);
    if (glyphCount == 0U) {
        return true;
    }
    const double textWidth = advance * static_cast<double>(glyphCount)
        - (advance - glyphWidth);
    double startX = command.origin.x;
    if (command.align == TextAlign::center) {
        startX -= textWidth * 0.5;
    } else if (command.align == TextAlign::end) {
        startX -= textWidth;
    }
    double startY = command.origin.y;
    switch (command.baseline) {
        case TextBaseline::top:
            break;
        case TextBaseline::middle:
            startY -= glyphHeight * 0.5;
            break;
        case TextBaseline::alphabetic:
            startY -= glyphHeight * 0.8;
            break;
        case TextBaseline::bottom:
            startY -= glyphHeight;
            break;
    }

    const double cellWidth = glyphWidth / 5.0;
    const double cellHeight = glyphHeight / 7.0;
    const double insetX = cellWidth * 0.12;
    const double insetY = cellHeight * 0.12;
    std::size_t offset = 0;
    std::size_t glyphIndex = 0;
    bool drewAny = false;
    while (glyphIndex < glyphCount) {
        std::uint32_t codePoint = 0;
        if (!decodeUtf8CodePoint(text, offset, codePoint)) {
            break;
        }
        for (std::uint32_t row = 0; row < 7U; ++row) {
            for (std::uint32_t column = 0; column < 5U; ++column) {
                if (!placeholderCellIsSet(codePoint, column, row)) {
                    continue;
                }
                const RectF cell{
                    static_cast<float>(
                        startX + advance * static_cast<double>(glyphIndex)
                            + cellWidth * static_cast<double>(column) + insetX
                    ),
                    static_cast<float>(
                        startY + cellHeight * static_cast<double>(row) + insetY
                    ),
                    static_cast<float>(std::max(cellWidth - insetX * 2.0, cellWidth * 0.2)),
                    static_cast<float>(std::max(cellHeight - insetY * 2.0, cellHeight * 0.2))
                };
                QuadD quad;
                if (makeQuad(
                        canvas.mapper(),
                        cell,
                        command.header.coordinateSpace,
                        command.rotationRadians,
                        command.origin.x,
                        command.origin.y,
                        quad
                    )) {
                    drewAny = canvas.drawSolidQuad(
                        quad,
                        command.color,
                        command.header.blendMode
                    ) || drewAny;
                }
            }
        }
        ++glyphIndex;
    }
    return drewAny;
}

[[nodiscard]] bool mapAxisAlignedRect(
    const RasterCanvas& canvas,
    const RectF rect,
    const CommandHeader& header,
    RectD& output
) noexcept {
    QuadD quad;
    if (!makeCommandQuad(
            canvas.mapper(),
            rect,
            header,
            0.0F,
            {0.5F, 0.5F},
            quad
        )) {
        return false;
    }
    output = quadBounds(quad);
    return true;
}

[[nodiscard]] bool uiFlagIsSet(
    const UiCommand& command,
    const UiStateFlag flag
) noexcept {
    return (command.stateFlags & uiStateBits(flag)) != 0U;
}

[[nodiscard]] bool drawUi(
    RasterCanvas& canvas,
    const UiCommand& command
) noexcept {
    RectD bounds;
    if (!mapAxisAlignedRect(canvas, command.bounds, command.header, bounds)) {
        return false;
    }
    const double radius = canvas.mapper().mapLength(
        command.cornerRadius,
        command.header.coordinateSpace
    );
    const double borderWidth = canvas.mapper().mapLength(
        command.borderWidth,
        command.header.coordinateSpace
    );
    const float stateOpacity = uiFlagIsSet(command, UiStateFlag::disabled) ? 0.5F : 1.0F;
    const float stateBrightness = uiFlagIsSet(command, UiStateFlag::pressed) ? 0.78F : 1.0F;
    const PremultipliedRgba background = withOpacity(
        withBrightness(command.backgroundColor, stateBrightness),
        stateOpacity
    );
    PremultipliedRgba border = withOpacity(command.borderColor, stateOpacity);
    if (uiFlagIsSet(command, UiStateFlag::focused)
        || uiFlagIsSet(command, UiStateFlag::selected)
        || uiFlagIsSet(command, UiStateFlag::hovered)) {
        border = withOpacity(command.accentColor, stateOpacity);
    }

    if (command.primitive == UiPrimitive::cursor) {
        const PointD center{
            (bounds.left + bounds.right) * 0.5,
            (bounds.top + bounds.bottom) * 0.5
        };
        const double width = std::max(borderWidth, 1.0);
        const bool horizontal = canvas.drawLineScreen(
            {bounds.left, center.y},
            {bounds.right, center.y},
            width,
            border,
            command.header.blendMode,
            LineCap::round
        );
        const bool vertical = canvas.drawLineScreen(
            {center.x, bounds.top},
            {center.x, bounds.bottom},
            width,
            border,
            command.header.blendMode,
            LineCap::round
        );
        return horizontal || vertical;
    }

    const bool base = drawRoundedRectangleScreen(
        canvas,
        bounds,
        radius,
        borderWidth,
        background,
        border,
        command.header.blendMode,
        true,
        borderWidth > 0.0
    );
    if (command.primitive != UiPrimitive::progress) {
        return base;
    }

    const double inset = std::max(borderWidth, 1.0);
    RectD progress{
        bounds.left + inset,
        bounds.top + inset,
        bounds.left + inset
            + std::max(bounds.right - bounds.left - inset * 2.0, 0.0)
                * clampUnit(command.value),
        bounds.bottom - inset
    };
    if (progress.right <= progress.left || progress.bottom <= progress.top) {
        return base;
    }
    const bool accent = drawRoundedRectangleScreen(
        canvas,
        progress,
        std::max(radius - inset, 0.0),
        0.0,
        withOpacity(command.accentColor, stateOpacity),
        PremultipliedRgba::transparent(),
        command.header.blendMode,
        true,
        false
    );
    return base || accent;
}

[[nodiscard]] bool drawArcScreen(
    RasterCanvas& canvas,
    RectD bounds,
    const double width,
    const double startAngle,
    const double sweepAngle,
    const PremultipliedRgba color,
    const BlendMode blendMode
) noexcept {
    if (bounds.left > bounds.right) {
        std::swap(bounds.left, bounds.right);
    }
    if (bounds.top > bounds.bottom) {
        std::swap(bounds.top, bounds.bottom);
    }
    const double radiusX = (bounds.right - bounds.left) * 0.5;
    const double radiusY = (bounds.bottom - bounds.top) * 0.5;
    const double safeWidth = std::clamp(
        std::isfinite(width) ? width : 0.0,
        0.5,
        std::min(radiusX, radiusY)
    );
    if (!(radiusX > 0.0)
        || !(radiusY > 0.0)
        || !std::isfinite(startAngle)
        || !std::isfinite(sweepAngle)
        || sweepAngle <= 0.0) {
        return false;
    }
    const PixelBounds pixels = canvas.rasterBounds(bounds);
    if (pixels.isEmpty()) {
        return false;
    }
    const double centerX = (bounds.left + bounds.right) * 0.5;
    const double centerY = (bounds.top + bounds.bottom) * 0.5;
    const double innerRadiusX = std::max(radiusX - safeWidth, radiusX * 0.01);
    const double innerRadiusY = std::max(radiusY - safeWidth, radiusY * 0.01);
    const double fullCircle = std::numbers::pi_v<double> * 2.0;
    const double normalizedStart = std::fmod(startAngle, fullCircle) < 0.0
        ? std::fmod(startAngle, fullCircle) + fullCircle
        : std::fmod(startAngle, fullCircle);
    const double clampedSweep = std::min(sweepAngle, fullCircle);
    const std::uint32_t source = packColor(color);

    for (int y = pixels.top; y < pixels.bottom; ++y) {
        for (int x = pixels.left; x < pixels.right; ++x) {
            const double deltaX = static_cast<double>(x) + 0.5 - centerX;
            const double deltaY = static_cast<double>(y) + 0.5 - centerY;
            const double outer = deltaX * deltaX / (radiusX * radiusX)
                + deltaY * deltaY / (radiusY * radiusY);
            const double inner = deltaX * deltaX / (innerRadiusX * innerRadiusX)
                + deltaY * deltaY / (innerRadiusY * innerRadiusY);
            if (outer > 1.0 || inner < 1.0) {
                continue;
            }
            double angle = std::atan2(deltaY / radiusY, deltaX / radiusX);
            if (angle < 0.0) {
                angle += fullCircle;
            }
            double relative = angle - normalizedStart;
            if (relative < 0.0) {
                relative += fullCircle;
            }
            if (relative <= clampedSweep) {
                canvas.blendAt(x, y, source, blendMode);
            }
        }
    }
    return true;
}

[[nodiscard]] bool drawVignette(
    RasterCanvas& canvas,
    const EffectCommand& command
) noexcept {
    RectD bounds;
    if (!mapAxisAlignedRect(canvas, command.bounds, command.header, bounds)) {
        return false;
    }
    if (bounds.left > bounds.right) {
        std::swap(bounds.left, bounds.right);
    }
    if (bounds.top > bounds.bottom) {
        std::swap(bounds.top, bounds.bottom);
    }
    const PixelBounds pixels = canvas.rasterBounds(bounds);
    if (pixels.isEmpty()) {
        return false;
    }
    const double radiusX = (bounds.right - bounds.left) * 0.5;
    const double radiusY = (bounds.bottom - bounds.top) * 0.5;
    if (!(radiusX > 0.0) || !(radiusY > 0.0)) {
        return false;
    }
    const double centerX = (bounds.left + bounds.right) * 0.5;
    const double centerY = (bounds.top + bounds.bottom) * 0.5;
    const double inner = std::clamp(
        static_cast<double>(finiteOr(command.parameters[0], 0.6F)),
        0.0,
        0.98
    );
    const double innerSquared = inner * inner;
    const double denominator = std::max(1.0 - innerSquared, 0.01);
    const double inverseRadiusX = 1.0 / radiusX;
    const double inverseRadiusY = 1.0 / radiusY;
    std::array<std::uint32_t, 256> opacityTable{};
    for (std::size_t index = 0; index < opacityTable.size(); ++index) {
        opacityTable[index] = packColor(withOpacity(
            command.primaryColor,
            static_cast<float>(index) / 255.0F
        ));
    }
    for (int y = pixels.top; y < pixels.bottom; ++y) {
        const double normalizedY = (static_cast<double>(y) + 0.5 - centerY)
            * inverseRadiusY;
        const double verticalDistanceSquared = normalizedY * normalizedY;
        for (int x = pixels.left; x < pixels.right; ++x) {
            const double normalizedX = (static_cast<double>(x) + 0.5 - centerX)
                * inverseRadiusX;
            const double distanceSquared = normalizedX * normalizedX
                + verticalDistanceSquared;
            double intensity = std::clamp((distanceSquared - innerSquared) / denominator, 0.0, 1.0);
            intensity = intensity * intensity * (3.0 - 2.0 * intensity);
            if (intensity > 0.0) {
                const auto opacityIndex = static_cast<std::size_t>(intensity * 255.0 + 0.5);
                const std::uint32_t source = opacityTable[std::min(
                    opacityIndex,
                    opacityTable.size() - 1U
                )];
                if (canvas.hasActiveClip()) {
                    canvas.blendAt(x, y, source, command.header.blendMode);
                } else {
                    std::uint32_t* const destination = canvas.access_.row(y) + x;
                    *destination = blendPixel(
                        *destination,
                        source,
                        command.header.blendMode
                    );
                }
            }
        }
    }
    return true;
}

[[nodiscard]] bool drawEffect(
    RasterCanvas& canvas,
    const EffectCommand& command
) noexcept {
    RectD bounds;
    if (!mapAxisAlignedRect(canvas, command.bounds, command.header, bounds)) {
        return false;
    }
    const double minimumSize = std::min(
        std::abs(bounds.right - bounds.left),
        std::abs(bounds.bottom - bounds.top)
    );
    const float pulse = clampUnit(command.parameters[0]);

    switch (command.effect) {
        case EffectType::magneticShield: {
            const double width = std::max(minimumSize * 0.035, 1.0);
            const bool outer = drawEllipseScreen(
                canvas,
                bounds,
                width,
                PremultipliedRgba::transparent(),
                withOpacity(command.primaryColor, 0.72F + pulse * 0.28F),
                command.header.blendMode,
                false,
                true
            );
            const double inset = std::max(width * 2.2, 2.0);
            const RectD inner{
                bounds.left + inset,
                bounds.top + inset,
                bounds.right - inset,
                bounds.bottom - inset
            };
            const bool innerRing = drawEllipseScreen(
                canvas,
                inner,
                std::max(width * 0.55, 1.0),
                PremultipliedRgba::transparent(),
                withOpacity(command.secondaryColor, 0.48F + pulse * 0.32F),
                command.header.blendMode,
                false,
                true
            );
            return outer || innerRing;
        }
        case EffectType::hexaMergeBoundary: {
            ShapeCommand replacement;
            replacement.header = command.header;
            replacement.shape = ShapeType::hexagon;
            replacement.fillEnabled = 0;
            replacement.strokeEnabled = 1;
            replacement.bounds = command.bounds;
            replacement.strokeWidth = std::max(
                finiteOr(command.parameters[1], 0.06F),
                0.02F
            );
            replacement.rotationRadians = 0.0F;
            replacement.stroke = withBrightness(command.primaryColor, 0.72F + pulse * 0.52F);
            return drawShape(canvas, replacement);
        }
        case EffectType::titleLoadingCircle: {
            const double width = std::max(minimumSize * 0.055, 1.0);
            const double start = -std::numbers::pi_v<double> * 0.5
                + static_cast<double>(pulse) * std::numbers::pi_v<double> * 2.0;
            const double progress = std::clamp(
                static_cast<double>(finiteOr(command.parameters[1], 0.72F)),
                0.04,
                1.0
            );
            const bool track = drawEllipseScreen(
                canvas,
                bounds,
                std::max(width * 0.45, 1.0),
                PremultipliedRgba::transparent(),
                withOpacity(command.secondaryColor, 0.5F),
                command.header.blendMode,
                false,
                true
            );
            const bool arc = drawArcScreen(
                canvas,
                bounds,
                width,
                start,
                progress * std::numbers::pi_v<double> * 2.0,
                command.primaryColor,
                command.header.blendMode
            );
            return track || arc;
        }
        case EffectType::vignette:
            return drawVignette(canvas, command);
        case EffectType::backdropBlur:
            return drawRoundedRectangleScreen(
                canvas,
                bounds,
                minimumSize * 0.04,
                std::max(minimumSize * 0.006, 1.0),
                withOpacity(command.primaryColor, 0.82F),
                withOpacity(command.secondaryColor, 0.75F),
                command.header.blendMode,
                true,
                true
            );
        case EffectType::glassComposite:
            return drawRoundedRectangleScreen(
                canvas,
                bounds,
                minimumSize * 0.06,
                std::max(minimumSize * 0.008, 1.0),
                withOpacity(command.primaryColor, 0.78F),
                command.secondaryColor,
                command.header.blendMode,
                true,
                true
            );
        case EffectType::custom:
            return drawRoundedRectangleScreen(
                canvas,
                bounds,
                0.0,
                1.0,
                PremultipliedRgba::transparent(),
                command.primaryColor,
                command.header.blendMode,
                false,
                true
            );
    }
    return false;
}

[[nodiscard]] bool drawOverlay(
    RasterCanvas& canvas,
    const OverlayCommand& command
) noexcept {
    switch (command.operation) {
        case OverlayOperation::beginSession:
        case OverlayOperation::captureBackdrop:
        case OverlayOperation::endSession:
            return true;
        case OverlayOperation::dim: {
            RectF destination = command.destinationBounds;
            if (!(destination.width > 0.0F) || !(destination.height > 0.0F)) {
                destination = {
                    0.0F,
                    0.0F,
                    canvas.mapper().isValid()
                        ? static_cast<float>(canvas.surface_.w)
                        : 0.0F,
                    canvas.mapper().isValid()
                        ? static_cast<float>(canvas.surface_.h)
                        : 0.0F
                };
                QuadD screenQuad{
                    std::array<PointD, 4>{
                        PointD{0.0, 0.0},
                        PointD{static_cast<double>(canvas.surface_.w), 0.0},
                        PointD{
                            static_cast<double>(canvas.surface_.w),
                            static_cast<double>(canvas.surface_.h)
                        },
                        PointD{0.0, static_cast<double>(canvas.surface_.h)}
                    }
                };
                return canvas.drawSolidQuad(
                    screenQuad,
                    withOpacity(command.tintColor, command.opacity),
                    command.header.blendMode
                );
            }
            QuadD quad;
            return makeCommandQuad(
                    canvas.mapper(),
                    destination,
                    command.header,
                    0.0F,
                    {0.5F, 0.5F},
                    quad
                )
                && canvas.drawSolidQuad(
                    quad,
                    withOpacity(command.tintColor, command.opacity),
                    command.header.blendMode
                );
        }
        case OverlayOperation::glassPanel: {
            RectD bounds;
            if (!mapAxisAlignedRect(
                    canvas,
                    command.destinationBounds,
                    command.header,
                    bounds
                )) {
                return false;
            }
            const double minimumSize = std::min(
                std::abs(bounds.right - bounds.left),
                std::abs(bounds.bottom - bounds.top)
            );
            const double radius = std::max(minimumSize * 0.04, 2.0);
            const double edgeWidth = std::max(
                static_cast<double>(finiteOr(command.edgeStrength, 0.5F)) * 2.0,
                1.0
            );
            RectD shadow = bounds;
            shadow.left += 4.0;
            shadow.right += 4.0;
            shadow.top += 6.0;
            shadow.bottom += 6.0;
            const bool drewShadow = drawRoundedRectangleScreen(
                canvas,
                shadow,
                radius,
                0.0,
                withOpacity(command.shadowColor, command.opacity),
                PremultipliedRgba::transparent(),
                command.header.blendMode,
                true,
                false
            );
            const bool drewPanel = drawRoundedRectangleScreen(
                canvas,
                bounds,
                radius,
                edgeWidth,
                withOpacity(command.tintColor, command.opacity),
                withOpacity(command.edgeColor, command.opacity),
                command.header.blendMode,
                true,
                true
            );
            return drewShadow || drewPanel;
        }
    }
    return false;
}

/** clamp/repeat/reflect를 공통 0..1 gradient parameter로 정규화한다. */
[[nodiscard]] double applyGradientSpread(
    const double parameter,
    const GradientSpread spread
) noexcept {
    if (!std::isfinite(parameter)) {
        return 0.0;
    }
    switch (spread) {
        case GradientSpread::clamp:
            return std::clamp(parameter, 0.0, 1.0);
        case GradientSpread::repeat:
            return parameter - std::floor(parameter);
        case GradientSpread::reflect: {
            double phase = parameter - std::floor(parameter * 0.5) * 2.0;
            if (phase > 1.0) {
                phase = 2.0 - phase;
            }
            return std::clamp(phase, 0.0, 1.0);
        }
    }
    return 0.0;
}

/** 정렬된 PMA stop을 보간하며 같은 offset은 hard-stop으로 해석한다. */
[[nodiscard]] PremultipliedRgba interpolateGradientStops(
    const std::span<const GradientStop> stops,
    const double parameter
) noexcept {
    if (parameter < static_cast<double>(stops.front().offset)) {
        return stops.front().color;
    }

    // 같은 offset을 모두 지난 뒤 구간을 고르면 불연속점의 정확한 위치에서는
    // 마지막 stop을, 그 직전에서는 첫 stop을 사용한다.
    std::size_t upper = 0U;
    while (upper < stops.size()
        && parameter >= static_cast<double>(stops[upper].offset)) {
        ++upper;
    }
    if (upper == 0U) {
        return stops.front().color;
    }
    if (upper == stops.size()) {
        return stops.back().color;
    }

    const GradientStop& first = stops[upper - 1U];
    const GradientStop& second = stops[upper];
    const double firstOffset = static_cast<double>(first.offset);
    const double secondOffset = static_cast<double>(second.offset);
    const double denominator = secondOffset - firstOffset;
    const double amount = denominator > 0.0
        ? std::clamp((parameter - firstOffset) / denominator, 0.0, 1.0)
        : 1.0;
    const auto interpolate = [amount](const float from, const float to) noexcept {
        return static_cast<float>(
            static_cast<double>(from)
            + (static_cast<double>(to) - static_cast<double>(from)) * amount
        );
    };
    return {
        interpolate(first.color.red, second.color.red),
        interpolate(first.color.green, second.color.green),
        interpolate(first.color.blue, second.color.blue),
        interpolate(first.color.alpha, second.color.alpha)
    };
}

/** 두 원으로 정의된 radial gradient의 원뿔 parameter를 계산한다. */
[[nodiscard]] bool radialGradientParameter(
    const GradientCommand& command,
    const PointD point,
    double& parameter
) noexcept {
    const double startX = static_cast<double>(command.start.x);
    const double startY = static_cast<double>(command.start.y);
    const double deltaX = static_cast<double>(command.end.x) - startX;
    const double deltaY = static_cast<double>(command.end.y) - startY;
    const double startRadius = static_cast<double>(command.startRadius);
    const double deltaRadius = static_cast<double>(command.endRadius)
        - startRadius;
    const double relativeX = point.x - startX;
    const double relativeY = point.y - startY;

    const double a = deltaX * deltaX + deltaY * deltaY
        - deltaRadius * deltaRadius;
    const double b = -2.0 * (
        relativeX * deltaX
        + relativeY * deltaY
        + startRadius * deltaRadius
    );
    const double c = relativeX * relativeX + relativeY * relativeY
        - startRadius * startRadius;
    if (!std::isfinite(a) || !std::isfinite(b) || !std::isfinite(c)) {
        return false;
    }

    const auto radiusIsValid = [startRadius, deltaRadius](
        const double candidate
    ) noexcept {
        return std::isfinite(candidate)
            && startRadius + candidate * deltaRadius >= -minimum_denominator;
    };
    if (std::abs(a) <= minimum_denominator) {
        if (std::abs(b) <= minimum_denominator) {
            parameter = 0.0;
            return true;
        }
        const double candidate = -c / b;
        if (!radiusIsValid(candidate)) {
            return false;
        }
        parameter = candidate;
        return true;
    }

    double discriminant = b * b - 4.0 * a * c;
    if (!std::isfinite(discriminant)) {
        return false;
    }
    const double discriminantTolerance = minimum_denominator
        * std::max({1.0, std::abs(b * b), std::abs(4.0 * a * c)});
    if (discriminant < -discriminantTolerance) {
        return false;
    }
    discriminant = std::max(discriminant, 0.0);
    const double root = std::sqrt(discriminant);
    const double first = (-b - root) / (2.0 * a);
    const double second = (-b + root) / (2.0 * a);
    const bool firstValid = radiusIsValid(first);
    const bool secondValid = radiusIsValid(second);
    if (!firstValid && !secondValid) {
        return false;
    }
    if (firstValid && secondValid) {
        // 두 원뿔형 gradient는 sample을 지나는 유효 원 중 바깥쪽 해를 사용한다.
        // 따라서 동심원에서는 +distance/r 해가 선택된다.
        parameter = std::max(first, second);
    } else {
        parameter = firstValid ? first : second;
    }
    return true;
}

/** gradient 종류에 따라 sample의 보간 parameter를 계산한다. */
[[nodiscard]] bool gradientParameter(
    const GradientCommand& command,
    const PointD point,
    double& parameter
) noexcept {
    if (command.type == GradientType::radial) {
        return radialGradientParameter(command, point, parameter);
    }

    const double deltaX = static_cast<double>(command.end.x)
        - static_cast<double>(command.start.x);
    const double deltaY = static_cast<double>(command.end.y)
        - static_cast<double>(command.start.y);
    const double denominator = deltaX * deltaX + deltaY * deltaY;
    if (!std::isfinite(denominator)) {
        return false;
    }
    if (denominator <= minimum_denominator) {
        parameter = 0.0;
        return true;
    }
    parameter = (
        (point.x - static_cast<double>(command.start.x)) * deltaX
        + (point.y - static_cast<double>(command.start.y)) * deltaY
    ) / denominator;
    return std::isfinite(parameter);
}

/** transform과 viewport를 역투영해 GradientCommand를 PMA pixel로 래스터한다. */
[[nodiscard]] bool drawGradient(
    RasterCanvas& canvas,
    const FramePacket& frame,
    const GradientCommand& command
) noexcept {
    if (command.bounds.width == 0.0F || command.bounds.height == 0.0F) {
        return true;
    }
    ProjectiveGeometry geometry;
    if (!makeProjectiveGeometry(
            canvas.mapper(),
            command.header.coordinateSpace,
            command.transform,
            command.bounds,
            geometry
        )) {
        return false;
    }
    const PixelBounds pixels = canvas.rasterBounds(
        quadBounds(geometry.screenQuad)
    );
    if (pixels.isEmpty()) {
        return true;
    }

    const std::span<const GradientStop> stops = frame.gradientStops().subspan(
        static_cast<std::size_t>(command.stops.offset),
        static_cast<std::size_t>(command.stops.count)
    );
    const RectD localBounds{
        command.bounds.x,
        command.bounds.y,
        static_cast<double>(command.bounds.x) + command.bounds.width,
        static_cast<double>(command.bounds.y) + command.bounds.height
    };
    for (int y = pixels.top; y < pixels.bottom; ++y) {
        for (int x = pixels.left; x < pixels.right; ++x) {
            PointD local;
            if (!projectPoint(
                    geometry.screenToLocal,
                    static_cast<double>(x) + 0.5,
                    static_cast<double>(y) + 0.5,
                    local
                )
                || !pointInsideRoundedBounds(local, localBounds, 0.0)) {
                continue;
            }
            double parameter = 0.0;
            if (!gradientParameter(command, local, parameter)) {
                continue;
            }
            const PremultipliedRgba color = interpolateGradientStops(
                stops,
                applyGradientSpread(parameter, command.spread)
            );
            canvas.blendAt(
                x,
                y,
                packColor(color),
                command.header.blendMode
            );
        }
    }
    return true;
}

[[nodiscard]] RectF meshPlaceholderBounds(
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

[[nodiscard]] bool drawV2Placeholder(
    RasterCanvas& canvas,
    const CommandHeader& header,
    const RectF bounds,
    const PremultipliedRgba color
) noexcept {
    if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
        return true;
    }
    RectD mapped;
    if (!mapAxisAlignedRect(canvas, bounds, header, mapped)) {
        return false;
    }
    return drawRoundedRectangleScreen(
        canvas,
        mapped,
        std::min(bounds.width, bounds.height) * 0.04,
        1.0,
        withOpacity(color, 0.64F),
        color,
        header.blendMode,
        true,
        true
    );
}

[[nodiscard]] bool dispatchCommand(
    RasterCanvas& canvas,
    const FramePacket& frame,
    const CommandRef reference,
    bool& placeholder
) noexcept {
    const std::size_t index = static_cast<std::size_t>(reference.index);
    switch (reference.kind) {
        case CommandKind::sprite:
            placeholder = true;
            return index < frame.sprites().size()
                && canvas.drawSprite(frame.sprites()[index]);
        case CommandKind::shape:
            return index < frame.shapes().size()
                && drawShape(canvas, frame.shapes()[index]);
        case CommandKind::line:
            return index < frame.lines().size()
                && canvas.drawLine(frame.lines()[index]);
        case CommandKind::text:
            placeholder = true;
            return index < frame.textRuns().size()
                && drawText(canvas, frame, frame.textRuns()[index]);
        case CommandKind::effect:
            placeholder = true;
            return index < frame.effects().size()
                && drawEffect(canvas, frame.effects()[index]);
        case CommandKind::ui:
            return index < frame.ui().size()
                && drawUi(canvas, frame.ui()[index]);
        case CommandKind::overlay:
            placeholder = true;
            return index < frame.overlays().size()
                && drawOverlay(canvas, frame.overlays()[index]);
        case CommandKind::glyphRun: {
            placeholder = true;
            if (index >= frame.glyphRuns().size()) {
                return false;
            }
            const GlyphRunCommand& command = frame.glyphRuns()[index];
            return drawV2Placeholder(
                canvas,
                command.header,
                {
                    command.origin.x,
                    command.origin.y - command.pixelsPerEm,
                    command.pixelsPerEm * 0.62F * static_cast<float>(command.glyphs.count),
                    command.pixelsPerEm
                },
                command.color
            );
        }
        case CommandKind::texturedMesh: {
            placeholder = true;
            if (index >= frame.texturedMeshes().size()) {
                return false;
            }
            const TexturedMeshCommand& command = frame.texturedMeshes()[index];
            return drawV2Placeholder(
                canvas,
                command.header,
                meshPlaceholderBounds(frame, command),
                command.tint
            );
        }
        case CommandKind::gradient: {
            if (index >= frame.gradients().size()) {
                return false;
            }
            return drawGradient(canvas, frame, frame.gradients()[index]);
        }
        case CommandKind::clip: {
            if (index >= frame.clips().size()) {
                return false;
            }
            return canvas.applyClip(frame.clips()[index]);
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
                canvas,
                command.header,
                bounds,
                command.tintColor.alpha > 0.0F
                    ? command.tintColor
                    : PremultipliedRgba::fromStraight(0.32F, 0.72F, 1.0F, 0.72F)
            );
        }
    }
    return false;
}

[[nodiscard]] bool surfaceIsUsable(const SDL_Surface& surface) noexcept {
    return surface.format == SDL_PIXELFORMAT_ARGB8888
        && surface.w > 0
        && surface.h > 0
        && surface.pixels != nullptr
        && surface.pitch >= surface.w * static_cast<int>(sizeof(std::uint32_t))
        && surface.pitch % static_cast<int>(alignof(std::uint32_t)) == 0;
}

void hashByte(std::uint64_t& hash, const std::uint8_t value) noexcept {
    hash ^= value;
    hash *= fnv_prime;
}

void hashU32(std::uint64_t& hash, const std::uint32_t value) noexcept {
    for (std::uint32_t shift = 0; shift < 32U; shift += 8U) {
        hashByte(hash, static_cast<std::uint8_t>((value >> shift) & 0xffU));
    }
}

} // namespace

RasterError clearSurface(
    SDL_Surface& surface,
    const PremultipliedRgba color
) noexcept {
    if (!surfaceIsUsable(surface)) {
        return RasterError::invalidSurface;
    }
    SurfaceAccess access(surface);
    if (!access.isValid()) {
        return RasterError::surfaceLockFailed;
    }
    const std::uint32_t pixel = packColor(color);
    for (int y = 0; y < surface.h; ++y) {
        std::uint32_t* const row = access.row(y);
        std::fill(row, row + surface.w, pixel);
    }
    return RasterError::none;
}

RasterResult rasterFrame(
    SDL_Surface& surface,
    const FramePacket& frame
) noexcept {
    if (!surfaceIsUsable(surface)) {
        return {RasterError::invalidSurface, 0, 0, 0};
    }
    SurfaceAccess access(surface);
    if (!access.isValid()) {
        return {RasterError::surfaceLockFailed, 0, 0, 0};
    }
    RasterCanvas canvas(surface, access, frame.viewport());
    if (!canvas.isValid()) {
        return {RasterError::invalidViewport, 0, 0, frame.commandStream().size()};
    }

    const std::uint32_t clearPixel = packColor(frame.metadata().clearColor);
    for (int y = 0; y < surface.h; ++y) {
        std::uint32_t* const row = access.row(y);
        std::fill(row, row + surface.w, clearPixel);
    }

    RasterResult result;
    for (const CommandRef reference : frame.commandStream()) {
        bool placeholder = false;
        if (dispatchCommand(canvas, frame, reference, placeholder)) {
            ++result.renderedCommands;
            if (placeholder) {
                ++result.placeholderCommands;
            }
        } else {
            ++result.skippedCommands;
            if (placeholder) {
                ++result.placeholderCommands;
            }
        }
    }
    return result;
}

std::uint64_t hashSurface(SDL_Surface& surface) noexcept {
    if (!surfaceIsUsable(surface)) {
        return 0;
    }
    SurfaceAccess access(surface);
    if (!access.isValid()) {
        return 0;
    }

    std::uint64_t hash = fnv_offset_basis;
    hashU32(hash, static_cast<std::uint32_t>(surface.w));
    hashU32(hash, static_cast<std::uint32_t>(surface.h));
    for (int y = 0; y < surface.h; ++y) {
        const std::uint32_t* const row = access.row(y);
        for (int x = 0; x < surface.w; ++x) {
            hashU32(hash, row[x]);
        }
    }
    return hash;
}

} // namespace cirvivor::render::software::detail
