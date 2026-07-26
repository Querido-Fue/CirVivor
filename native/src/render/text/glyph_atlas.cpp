#include "render/text/glyph_atlas.h"

#include <algorithm>
#include <limits>
#include <new>
#include <stdexcept>

namespace cirvivor::render::text {

namespace {

[[nodiscard]] std::size_t lookupCapacityFor(
    const std::uint32_t entryCapacity
) noexcept {
    std::size_t result = 1;
    const std::size_t minimum = static_cast<std::size_t>(entryCapacity) * 2U;
    while (result < minimum) {
        result <<= 1U;
    }
    return result;
}

} // namespace

std::unique_ptr<GlyphAtlas> GlyphAtlas::create(
    const std::uint32_t width,
    const std::uint32_t height,
    const std::uint32_t entryCapacity,
    GlyphAtlasCreateError& error
) {
    error = GlyphAtlasCreateError::none;
    if (width == 0U || height == 0U
        || width > maximumDimension || height > maximumDimension) {
        error = GlyphAtlasCreateError::invalidDimensions;
        return nullptr;
    }
    const std::uint64_t pixelCount =
        static_cast<std::uint64_t>(width) * height;
    if (pixelCount > maximumPixelCount
        || pixelCount > std::numeric_limits<std::size_t>::max()) {
        error = GlyphAtlasCreateError::invalidDimensions;
        return nullptr;
    }
    if (entryCapacity == 0U || entryCapacity > maximumEntryCapacity) {
        error = GlyphAtlasCreateError::invalidCapacity;
        return nullptr;
    }

    try {
        return std::unique_ptr<GlyphAtlas>(new GlyphAtlas(
            width,
            height,
            entryCapacity,
            lookupCapacityFor(entryCapacity)
        ));
    } catch (const std::bad_alloc&) {
        error = GlyphAtlasCreateError::allocationFailed;
        return nullptr;
    } catch (const std::length_error&) {
        error = GlyphAtlasCreateError::allocationFailed;
        return nullptr;
    }
}

GlyphAtlas::GlyphAtlas(
    const std::uint32_t width,
    const std::uint32_t height,
    const std::uint32_t entryCapacity,
    const std::size_t lookupCapacity
)
    : width_(width),
      height_(height),
      entryCapacity_(entryCapacity),
      pixels_(static_cast<std::size_t>(width) * height, std::uint8_t{0}),
      lookupSlots_(lookupCapacity, emptyLookupSlot) {
    entries_.reserve(entryCapacity);
}

GlyphAtlasCacheResult GlyphAtlas::cacheGlyph(
    const FontFace& face,
    const std::uint32_t glyphIndex
) {
    GlyphAtlasCacheResult result;
    if (face.pixelSize() == 0U
        || face.pixelSize() > FontFace::maximumPixelSize
        || face.weightCoordinate() < face.minimumWeightCoordinate()
        || face.weightCoordinate() > face.maximumWeightCoordinate()) {
        return result;
    }

    const GlyphAtlasKey key{
        face.sourceFingerprint(),
        glyphIndex,
        face.pixelSize(),
        face.weightCoordinate()
    };
    bool found = false;
    const std::size_t lookupSlot = findLookupSlot(key, found);
    if (found) {
        result.status = GlyphAtlasCacheStatus::alreadyCached;
        result.entryIndex = lookupSlots_[lookupSlot];
        return result;
    }
    if (entries_.size() >= entryCapacity_) {
        result.status = GlyphAtlasCacheStatus::entryCapacityExceeded;
        return result;
    }

    GlyphRasterResult raster = face.rasterizeGlyph(glyphIndex);
    if (!raster.success()) {
        result.status = GlyphAtlasCacheStatus::glyphRasterizationFailed;
        result.rasterError = raster.error;
        return result;
    }

    std::uint32_t nextCursorX = cursorX_;
    std::uint32_t nextCursorY = cursorY_;
    std::uint32_t nextShelfHeight = shelfHeight_;
    std::uint32_t targetX = 0;
    std::uint32_t targetY = 0;
    const RasterizedGlyph& glyph = raster.glyph;
    if (glyph.width > 0U && glyph.height > 0U) {
        const std::uint64_t paddedWidth =
            static_cast<std::uint64_t>(glyph.width) + padding * 2U;
        const std::uint64_t paddedHeight =
            static_cast<std::uint64_t>(glyph.height) + padding * 2U;
        if (paddedWidth > width_ || paddedHeight > height_) {
            result.status = GlyphAtlasCacheStatus::atlasSpaceExceeded;
            return result;
        }
        if (static_cast<std::uint64_t>(nextCursorX) + paddedWidth > width_) {
            nextCursorX = 0;
            nextCursorY += nextShelfHeight;
            nextShelfHeight = 0;
        }
        if (static_cast<std::uint64_t>(nextCursorY) + paddedHeight > height_) {
            result.status = GlyphAtlasCacheStatus::atlasSpaceExceeded;
            return result;
        }

        targetX = nextCursorX + padding;
        targetY = nextCursorY + padding;
        nextCursorX += static_cast<std::uint32_t>(paddedWidth);
        nextShelfHeight = std::max(
            nextShelfHeight,
            static_cast<std::uint32_t>(paddedHeight)
        );
    }

    const auto entryIndex = static_cast<std::uint32_t>(entries_.size());
    if (glyph.width > 0U && glyph.height > 0U) {
        for (std::uint32_t row = 0; row < glyph.height; ++row) {
            const auto* source = glyph.coverage.data()
                + static_cast<std::size_t>(row) * glyph.width;
            auto* destination = pixels_.data()
                + static_cast<std::size_t>(targetY + row) * width_
                + targetX;
            std::copy_n(source, glyph.width, destination);
        }
    }

    entries_.push_back({
        key,
        targetX,
        targetY,
        glyph.width,
        glyph.height,
        glyph.bearingX,
        glyph.bearingY,
        glyph.advanceX26Dot6,
        glyph.advanceY26Dot6
    });
    lookupSlots_[lookupSlot] = entryIndex;
    cursorX_ = nextCursorX;
    cursorY_ = nextCursorY;
    shelfHeight_ = nextShelfHeight;
    ++generation_;

    result.status = GlyphAtlasCacheStatus::inserted;
    result.entryIndex = entryIndex;
    return result;
}

std::uint32_t GlyphAtlas::find(const GlyphAtlasKey& key) const noexcept {
    bool found = false;
    const std::size_t slot = findLookupSlot(key, found);
    return found ? lookupSlots_[slot] : GlyphAtlasCacheResult::invalidEntryIndex;
}

const GlyphAtlasEntry* GlyphAtlas::entry(const std::uint32_t index) const noexcept {
    return index < entries_.size() ? &entries_[index] : nullptr;
}

std::span<const std::uint8_t> GlyphAtlas::pixels() const noexcept {
    return pixels_;
}

std::uint32_t GlyphAtlas::width() const noexcept {
    return width_;
}

std::uint32_t GlyphAtlas::height() const noexcept {
    return height_;
}

std::uint32_t GlyphAtlas::entryCapacity() const noexcept {
    return entryCapacity_;
}

std::uint32_t GlyphAtlas::entryCount() const noexcept {
    return static_cast<std::uint32_t>(entries_.size());
}

std::uint64_t GlyphAtlas::generation() const noexcept {
    return generation_;
}

void GlyphAtlas::clear() noexcept {
    std::fill(pixels_.begin(), pixels_.end(), std::uint8_t{0});
    entries_.clear();
    std::fill(lookupSlots_.begin(), lookupSlots_.end(), emptyLookupSlot);
    cursorX_ = 0;
    cursorY_ = 0;
    shelfHeight_ = 0;
    ++generation_;
}

std::uint64_t GlyphAtlas::hashKey(const GlyphAtlasKey& key) noexcept {
    std::uint64_t hash = 0xcbf29ce484222325ULL;
    const auto mix = [&hash](const std::uint32_t value) noexcept {
        for (std::uint32_t shift = 0; shift < 32U; shift += 8U) {
            hash ^= (value >> shift) & 0xffU;
            hash *= 1'099'511'628'211ULL;
        }
    };
    mix(static_cast<std::uint32_t>(key.fontSourceFingerprint));
    mix(static_cast<std::uint32_t>(key.fontSourceFingerprint >> 32U));
    mix(key.glyphIndex);
    mix(key.pixelSize);
    mix(static_cast<std::uint32_t>(key.weight));
    return hash;
}

std::size_t GlyphAtlas::findLookupSlot(
    const GlyphAtlasKey& key,
    bool& found
) const noexcept {
    const std::size_t mask = lookupSlots_.size() - 1U;
    std::size_t slot = static_cast<std::size_t>(hashKey(key)) & mask;
    for (std::size_t probe = 0; probe < lookupSlots_.size(); ++probe) {
        const std::uint32_t entryIndex = lookupSlots_[slot];
        if (entryIndex == emptyLookupSlot) {
            found = false;
            return slot;
        }
        if (entryIndex < entries_.size() && entries_[entryIndex].key == key) {
            found = true;
            return slot;
        }
        slot = (slot + 1U) & mask;
    }

    found = false;
    return 0;
}

} // namespace cirvivor::render::text
