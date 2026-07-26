#pragma once

#include "render/text/font_face.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <vector>

namespace cirvivor::render::text {

enum class GlyphAtlasCreateError : std::uint8_t {
    none,
    invalidDimensions,
    invalidCapacity,
    allocationFailed
};

enum class GlyphAtlasCacheStatus : std::uint8_t {
    inserted,
    alreadyCached,
    invalidFaceConfiguration,
    glyphRasterizationFailed,
    entryCapacityExceeded,
    atlasSpaceExceeded
};

struct GlyphAtlasKey final {
    std::uint64_t fontSourceFingerprint = 0;
    std::uint32_t glyphIndex = 0;
    std::uint32_t pixelSize = 0;
    std::int32_t weight = 0;

    [[nodiscard]] constexpr bool operator==(const GlyphAtlasKey&) const noexcept = default;
};

struct GlyphAtlasEntry final {
    GlyphAtlasKey key{};
    std::uint32_t x = 0;
    std::uint32_t y = 0;
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    std::int32_t bearingX = 0;
    std::int32_t bearingY = 0;
    std::int32_t advanceX26Dot6 = 0;
    std::int32_t advanceY26Dot6 = 0;
};

struct GlyphAtlasCacheResult final {
    static constexpr std::uint32_t invalidEntryIndex = UINT32_MAX;

    GlyphAtlasCacheStatus status = GlyphAtlasCacheStatus::invalidFaceConfiguration;
    std::uint32_t entryIndex = invalidEntryIndex;
    GlyphRasterError rasterError = GlyphRasterError::none;

    [[nodiscard]] constexpr bool success() const noexcept {
        return status == GlyphAtlasCacheStatus::inserted
            || status == GlyphAtlasCacheStatus::alreadyCached;
    }
};

class GlyphAtlas final {
public:
    static constexpr std::uint32_t maximumDimension = 16'384;
    static constexpr std::size_t maximumPixelCount = 64U * 1024U * 1024U;
    static constexpr std::uint32_t maximumEntryCapacity = 1U << 20U;
    static constexpr std::uint32_t padding = 1;

    [[nodiscard]] static std::unique_ptr<GlyphAtlas> create(
        std::uint32_t width,
        std::uint32_t height,
        std::uint32_t entryCapacity,
        GlyphAtlasCreateError& error
    );

    GlyphAtlas(const GlyphAtlas&) = delete;
    GlyphAtlas& operator=(const GlyphAtlas&) = delete;
    GlyphAtlas(GlyphAtlas&&) = delete;
    GlyphAtlas& operator=(GlyphAtlas&&) = delete;
    ~GlyphAtlas() = default;

    [[nodiscard]] GlyphAtlasCacheResult cacheGlyph(
        const FontFace& face,
        std::uint32_t glyphIndex
    );
    [[nodiscard]] std::uint32_t find(const GlyphAtlasKey& key) const noexcept;
    [[nodiscard]] const GlyphAtlasEntry* entry(std::uint32_t index) const noexcept;
    [[nodiscard]] std::span<const std::uint8_t> pixels() const noexcept;
    [[nodiscard]] std::uint32_t width() const noexcept;
    [[nodiscard]] std::uint32_t height() const noexcept;
    [[nodiscard]] std::uint32_t entryCapacity() const noexcept;
    [[nodiscard]] std::uint32_t entryCount() const noexcept;
    [[nodiscard]] std::uint64_t generation() const noexcept;
    void clear() noexcept;

private:
    static constexpr std::uint32_t emptyLookupSlot = UINT32_MAX;

    GlyphAtlas(
        std::uint32_t width,
        std::uint32_t height,
        std::uint32_t entryCapacity,
        std::size_t lookupCapacity
    );

    [[nodiscard]] static std::uint64_t hashKey(const GlyphAtlasKey& key) noexcept;
    [[nodiscard]] std::size_t findLookupSlot(
        const GlyphAtlasKey& key,
        bool& found
    ) const noexcept;

    std::uint32_t width_ = 0;
    std::uint32_t height_ = 0;
    std::uint32_t entryCapacity_ = 0;
    std::vector<std::uint8_t> pixels_;
    std::vector<GlyphAtlasEntry> entries_;
    std::vector<std::uint32_t> lookupSlots_;
    std::uint32_t cursorX_ = 0;
    std::uint32_t cursorY_ = 0;
    std::uint32_t shelfHeight_ = 0;
    std::uint64_t generation_ = 0;
};

} // namespace cirvivor::render::text
