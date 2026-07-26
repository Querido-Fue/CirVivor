#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string_view>
#include <vector>

namespace cirvivor::render::text {

enum class FontLoadError : std::uint8_t {
    none,
    emptyData,
    dataTooLarge,
    libraryInitializationFailed,
    memoryFaceCreationFailed,
    unicodeCharmapUnavailable,
    weightAxisUnavailable,
    weightCoordinateFailed,
    sizeConfigurationFailed,
    shapingFontCreationFailed
};

enum class IconAssetReplacement : std::uint8_t {
    none,
    trophy,
    book
};

enum class GlyphRasterError : std::uint8_t {
    none,
    invalidGlyphIndex,
    glyphLoadFailed,
    glyphRenderFailed,
    unsupportedPixelMode,
    invalidBitmapLayout,
    bitmapTooLarge,
    allocationFailed
};

[[nodiscard]] constexpr IconAssetReplacement iconAssetReplacementFor(
    const char32_t codepoint
) noexcept {
    switch (codepoint) {
    case U'\U0001F3C6':
        return IconAssetReplacement::trophy;
    case U'\U0001F4D6':
        return IconAssetReplacement::book;
    default:
        return IconAssetReplacement::none;
    }
}

struct ShapedGlyph final {
    std::uint32_t glyphIndex = 0;
    std::uint32_t cluster = 0;
    std::int32_t xAdvance26Dot6 = 0;
    std::int32_t yAdvance26Dot6 = 0;
    std::int32_t xOffset26Dot6 = 0;
    std::int32_t yOffset26Dot6 = 0;

    [[nodiscard]] constexpr bool operator==(const ShapedGlyph&) const noexcept = default;
};

struct ShapeResult final {
    bool success = false;
    std::vector<ShapedGlyph> glyphs;
    std::int64_t totalXAdvance26Dot6 = 0;
    std::int64_t totalYAdvance26Dot6 = 0;
};

struct RasterizedGlyph final {
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    std::int32_t bearingX = 0;
    std::int32_t bearingY = 0;
    std::int32_t advanceX26Dot6 = 0;
    std::int32_t advanceY26Dot6 = 0;
    std::vector<std::uint8_t> coverage;
};

struct GlyphRasterResult final {
    GlyphRasterError error = GlyphRasterError::none;
    RasterizedGlyph glyph;

    [[nodiscard]] constexpr bool success() const noexcept {
        return error == GlyphRasterError::none;
    }
};

class FontFace final {
public:
    static constexpr std::uint32_t canonicalPixelSize = 64;
    static constexpr std::int32_t canonicalWeight = 400;
    static constexpr std::uint32_t maximumPixelSize = 4'096;

    [[nodiscard]] static std::unique_ptr<FontFace> loadFromMemory(
        std::vector<std::byte> sourceBytes,
        FontLoadError& error
    );

    ~FontFace();

    FontFace(const FontFace&) = delete;
    FontFace& operator=(const FontFace&) = delete;
    FontFace(FontFace&&) = delete;
    FontFace& operator=(FontFace&&) = delete;

    [[nodiscard]] bool setPixelSize(std::uint32_t pixelSize) noexcept;
    [[nodiscard]] bool setWeightCoordinate(std::int32_t weight) noexcept;
    [[nodiscard]] ShapeResult shapeUtf8(std::string_view utf8) const;
    [[nodiscard]] GlyphRasterResult rasterizeGlyph(std::uint32_t glyphIndex) const;
    [[nodiscard]] bool containsCodepoint(char32_t codepoint) const noexcept;
    [[nodiscard]] std::size_t sourceByteCount() const noexcept;
    [[nodiscard]] std::uint64_t sourceFingerprint() const noexcept;
    [[nodiscard]] std::uint32_t pixelSize() const noexcept;
    [[nodiscard]] std::int32_t weightCoordinate() const noexcept;
    [[nodiscard]] std::int32_t minimumWeightCoordinate() const noexcept;
    [[nodiscard]] std::int32_t maximumWeightCoordinate() const noexcept;

private:
    struct Impl;

    explicit FontFace(std::unique_ptr<Impl> implementation) noexcept;

    std::unique_ptr<Impl> implementation_;
};

} // namespace cirvivor::render::text
