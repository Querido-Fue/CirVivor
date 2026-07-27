#include "render/text/shaped_text_cache.h"

#include "render/text/font_face.h"
#include "render/text/glyph_atlas.h"

#include <array>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <utility>

namespace cirvivor::render::text {

struct ShapedTextCache::OwnedRun final {
    PreShapedTextKey key{};
    float advance = 0.0F;
    float ascent = 0.0F;
    float descent = 0.0F;
    std::vector<GlyphInstance> glyphs;
};

struct ShapedTextCache::Impl final {
    std::unique_ptr<GlyphAtlas> atlas;
    std::vector<OwnedRun> ownedRuns;
    std::vector<PreShapedTextRunView> runViews;
    std::array<Alpha8TextureResourceView, 1> resourceViews{};
    std::uint64_t generation = 0;
};

namespace {

[[nodiscard]] bool keyIsValid(const PreShapedTextKey& key) noexcept {
    return key.logicalPixelSizeMilli > 0U
        && key.logicalPixelSizeMilli <= 4'096'000U
        && key.weight > 0;
}

[[nodiscard]] bool appendRun(
    ShapedTextCache::Impl& implementation,
    FontFace& face,
    const TextPreloadSpec& spec,
    ShapedTextCacheBuildError& error
) {
    if (!face.setPixelSize(ShapedTextCache::raster_pixel_size)
        || !face.setWeightCoordinate(spec.key.weight)) {
        error = ShapedTextCacheBuildError::faceConfigurationFailed;
        return false;
    }
    const ShapeResult shaped = face.shapeUtf8(spec.utf8);
    if (!shaped.success) {
        error = ShapedTextCacheBuildError::shapingFailed;
        return false;
    }

    ShapedTextCache::OwnedRun run;
    run.key = spec.key;
    run.advance = static_cast<float>(shaped.totalXAdvance26Dot6) / 64.0F;
    run.ascent = static_cast<float>(face.ascender26Dot6()) / 64.0F;
    run.descent = -static_cast<float>(face.descender26Dot6()) / 64.0F;
    run.glyphs.reserve(shaped.glyphs.size());
    std::int64_t penX26Dot6 = 0;
    std::int64_t penY26Dot6 = 0;
    for (const ShapedGlyph& shapedGlyph : shaped.glyphs) {
        if (shapedGlyph.glyphIndex == 0U) {
            error = ShapedTextCacheBuildError::missingGlyph;
            return false;
        }
        const GlyphAtlasCacheResult cached = implementation.atlas->cacheGlyph(
            face,
            shapedGlyph.glyphIndex
        );
        if (!cached.success()) {
            error = ShapedTextCacheBuildError::glyphCacheFailed;
            return false;
        }
        const GlyphAtlasEntry* const entry = implementation.atlas->entry(
            cached.entryIndex
        );
        if (entry == nullptr) {
            error = ShapedTextCacheBuildError::glyphCacheFailed;
            return false;
        }

        GlyphInstance glyph{};
        glyph.glyphIndex = shapedGlyph.glyphIndex;
        glyph.atlasPage = 0U;
        glyph.position = {
            static_cast<float>(penX26Dot6 + shapedGlyph.xOffset26Dot6) / 64.0F
                + static_cast<float>(entry->bearingX),
            -static_cast<float>(penY26Dot6 + shapedGlyph.yOffset26Dot6) / 64.0F
                - static_cast<float>(entry->bearingY)
        };
        glyph.advance = {
            static_cast<float>(shapedGlyph.xAdvance26Dot6) / 64.0F,
            -static_cast<float>(shapedGlyph.yAdvance26Dot6) / 64.0F
        };
        glyph.uv = {
            static_cast<float>(entry->x) / static_cast<float>(implementation.atlas->width()),
            static_cast<float>(entry->y) / static_cast<float>(implementation.atlas->height()),
            static_cast<float>(entry->width) / static_cast<float>(implementation.atlas->width()),
            static_cast<float>(entry->height) / static_cast<float>(implementation.atlas->height())
        };
        run.glyphs.push_back(glyph);
        penX26Dot6 += shapedGlyph.xAdvance26Dot6;
        penY26Dot6 += shapedGlyph.yAdvance26Dot6;
    }
    implementation.ownedRuns.push_back(std::move(run));
    return true;
}

} // namespace

std::unique_ptr<ShapedTextCache> ShapedTextCache::create(
    const std::span<const std::byte> fontBytes,
    const std::span<const TextPreloadSpec> specs,
    const std::uint64_t generation,
    ShapedTextCacheBuildError& error
) {
    error = ShapedTextCacheBuildError::none;
    if (fontBytes.empty()) {
        error = ShapedTextCacheBuildError::emptyFont;
        return nullptr;
    }
    if (generation == 0U) {
        error = ShapedTextCacheBuildError::invalidGeneration;
        return nullptr;
    }
    try {
        for (std::size_t index = 0U; index < specs.size(); ++index) {
            if (!keyIsValid(specs[index].key) || specs[index].utf8.empty()) {
                error = ShapedTextCacheBuildError::invalidSpec;
                return nullptr;
            }
            for (std::size_t other = index + 1U; other < specs.size(); ++other) {
                if (specs[index].key == specs[other].key) {
                    error = ShapedTextCacheBuildError::duplicateKey;
                    return nullptr;
                }
            }
        }

        std::vector<std::byte> sourceBytes(fontBytes.begin(), fontBytes.end());
        FontLoadError fontError = FontLoadError::none;
        std::unique_ptr<FontFace> face = FontFace::loadFromMemory(
            std::move(sourceBytes),
            fontError
        );
        if (face == nullptr) {
            error = ShapedTextCacheBuildError::fontLoadFailed;
            return nullptr;
        }
        GlyphAtlasCreateError atlasError = GlyphAtlasCreateError::none;
        std::unique_ptr<GlyphAtlas> atlas = GlyphAtlas::create(
            atlas_dimension,
            atlas_dimension,
            atlas_entry_capacity,
            atlasError
        );
        if (atlas == nullptr) {
            error = ShapedTextCacheBuildError::atlasCreationFailed;
            return nullptr;
        }

        auto implementation = std::make_unique<Impl>();
        implementation->atlas = std::move(atlas);
        implementation->generation = generation;
        implementation->ownedRuns.reserve(specs.size());
        implementation->runViews.reserve(specs.size());
        for (const TextPreloadSpec& spec : specs) {
            if (!appendRun(*implementation, *face, spec, error)) {
                return nullptr;
            }
        }
        for (const OwnedRun& run : implementation->ownedRuns) {
            implementation->runViews.push_back({
                run.key,
                pretendard_font_resource_id,
                pretendard_glyph_atlas_resource_id,
                raster_pixel_size,
                run.advance,
                run.ascent,
                run.descent,
                run.glyphs
            });
        }
        implementation->resourceViews[0] = {
            pretendard_glyph_atlas_resource_id,
            generation,
            implementation->atlas->width(),
            implementation->atlas->height(),
            implementation->atlas->width(),
            implementation->atlas->pixels()
        };

        const PreShapedTextResourcesView view(
            generation,
            implementation->runViews,
            RenderResourcesView(implementation->resourceViews)
        );
        if (!view.isValid()) {
            error = ShapedTextCacheBuildError::invalidSpec;
            return nullptr;
        }
        return std::unique_ptr<ShapedTextCache>(
            new ShapedTextCache(std::move(implementation))
        );
    } catch (const std::bad_alloc&) {
        error = ShapedTextCacheBuildError::allocationFailed;
        return nullptr;
    } catch (const std::length_error&) {
        error = ShapedTextCacheBuildError::allocationFailed;
        return nullptr;
    }
}

ShapedTextCache::ShapedTextCache(std::unique_ptr<Impl> implementation) noexcept
    : implementation_(std::move(implementation)) {}

ShapedTextCache::~ShapedTextCache() = default;

PreShapedTextResourcesView ShapedTextCache::textResources() const noexcept {
    return {
        implementation_->generation,
        implementation_->runViews,
        renderResources()
    };
}

RenderResourcesView ShapedTextCache::renderResources() const noexcept {
    return RenderResourcesView(implementation_->resourceViews);
}

std::uint64_t ShapedTextCache::generation() const noexcept {
    return implementation_->generation;
}

std::size_t ShapedTextCache::runCount() const noexcept {
    return implementation_->runViews.size();
}

} // namespace cirvivor::render::text
