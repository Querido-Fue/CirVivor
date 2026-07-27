#include "render/text/font_face.h"
#include "render/text/glyph_atlas.h"
#include "render/text/shaped_text_cache.h"
#include "render/text/title_text_catalog.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

class TestFailure final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void require(
    const bool condition,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!condition) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)

[[nodiscard]] std::vector<std::byte> readBytes(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) {
        throw TestFailure("unable to open " + path.string());
    }
    const std::streampos end = input.tellg();
    if (end < 0) {
        throw TestFailure("unable to measure " + path.string());
    }
    const auto fileSize = static_cast<std::uintmax_t>(end);
    if (fileSize > static_cast<std::uintmax_t>(std::numeric_limits<std::size_t>::max())) {
        throw TestFailure("file is too large " + path.string());
    }

    std::vector<std::byte> bytes(static_cast<std::size_t>(fileSize));
    input.seekg(0, std::ios::beg);
    if (!bytes.empty()) {
        input.read(
            reinterpret_cast<char*>(bytes.data()),
            static_cast<std::streamsize>(bytes.size())
        );
    }
    if (!input) {
        throw TestFailure("unable to read " + path.string());
    }
    return bytes;
}

[[nodiscard]] constexpr std::uint32_t choose(
    const std::uint32_t x,
    const std::uint32_t y,
    const std::uint32_t z
) noexcept {
    return (x & y) ^ (~x & z);
}

[[nodiscard]] constexpr std::uint32_t majority(
    const std::uint32_t x,
    const std::uint32_t y,
    const std::uint32_t z
) noexcept {
    return (x & y) ^ (x & z) ^ (y & z);
}

[[nodiscard]] std::string sha256(const std::vector<std::byte>& source) {
    constexpr std::array<std::uint32_t, 64> roundConstants{
        0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
        0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
        0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
        0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
        0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
        0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
        0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
        0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
        0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
        0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
        0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
        0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
        0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
        0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
        0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
        0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U
    };
    std::array<std::uint32_t, 8> state{
        0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
        0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U
    };

    std::vector<std::byte> message = source;
    const std::uint64_t bitLength = static_cast<std::uint64_t>(source.size()) * 8U;
    message.push_back(std::byte{0x80});
    while ((message.size() % 64U) != 56U) {
        message.push_back(std::byte{0});
    }
    for (int shift = 56; shift >= 0; shift -= 8) {
        message.push_back(static_cast<std::byte>((bitLength >> shift) & 0xffU));
    }

    std::array<std::uint32_t, 64> words{};
    for (std::size_t block = 0; block < message.size(); block += 64U) {
        for (std::size_t index = 0; index < 16U; ++index) {
            const std::size_t offset = block + index * 4U;
            words[index] =
                (std::to_integer<std::uint32_t>(message[offset]) << 24U)
                | (std::to_integer<std::uint32_t>(message[offset + 1U]) << 16U)
                | (std::to_integer<std::uint32_t>(message[offset + 2U]) << 8U)
                | std::to_integer<std::uint32_t>(message[offset + 3U]);
        }
        for (std::size_t index = 16U; index < words.size(); ++index) {
            const std::uint32_t s0 = std::rotr(words[index - 15U], 7)
                ^ std::rotr(words[index - 15U], 18)
                ^ (words[index - 15U] >> 3U);
            const std::uint32_t s1 = std::rotr(words[index - 2U], 17)
                ^ std::rotr(words[index - 2U], 19)
                ^ (words[index - 2U] >> 10U);
            words[index] = words[index - 16U] + s0 + words[index - 7U] + s1;
        }

        std::uint32_t a = state[0];
        std::uint32_t b = state[1];
        std::uint32_t c = state[2];
        std::uint32_t d = state[3];
        std::uint32_t e = state[4];
        std::uint32_t f = state[5];
        std::uint32_t g = state[6];
        std::uint32_t h = state[7];
        for (std::size_t index = 0; index < words.size(); ++index) {
            const std::uint32_t sum1 = std::rotr(e, 6) ^ std::rotr(e, 11) ^ std::rotr(e, 25);
            const std::uint32_t temporary1 = h + sum1 + choose(e, f, g)
                + roundConstants[index] + words[index];
            const std::uint32_t sum0 = std::rotr(a, 2) ^ std::rotr(a, 13) ^ std::rotr(a, 22);
            const std::uint32_t temporary2 = sum0 + majority(a, b, c);
            h = g;
            g = f;
            f = e;
            e = d + temporary1;
            d = c;
            c = b;
            b = a;
            a = temporary1 + temporary2;
        }
        state[0] += a;
        state[1] += b;
        state[2] += c;
        state[3] += d;
        state[4] += e;
        state[5] += f;
        state[6] += g;
        state[7] += h;
    }

    constexpr std::string_view digits = "0123456789abcdef";
    std::string digest;
    digest.resize(64U);
    for (std::size_t index = 0; index < state.size(); ++index) {
        for (std::size_t nibble = 0; nibble < 8U; ++nibble) {
            const std::uint32_t shift = static_cast<std::uint32_t>((7U - nibble) * 4U);
            digest[index * 8U + nibble] = digits[(state[index] >> shift) & 0x0fU];
        }
    }
    return digest;
}

template<std::size_t Size>
void requireShapeContract(
    const cirvivor::render::text::ShapeResult& actual,
    const std::array<cirvivor::render::text::ShapedGlyph, Size>& expected,
    const std::int64_t expectedTotalAdvance
) {
    REQUIRE(actual.success);
    REQUIRE(actual.glyphs.size() == expected.size());
    REQUIRE(actual.totalXAdvance26Dot6 == expectedTotalAdvance);
    REQUIRE(actual.totalYAdvance26Dot6 == 0);
    for (std::size_t index = 0; index < expected.size(); ++index) {
        REQUIRE(actual.glyphs[index] == expected[index]);
    }
}

void testAssetIntegrityAndMemoryFace() {
    using namespace cirvivor::render::text;

    std::vector<std::byte> fontBytes = readBytes(CIRVIVOR_PRETENDARD_FONT_PATH);
    const std::vector<std::byte> licenseBytes = readBytes(CIRVIVOR_PRETENDARD_LICENSE_PATH);
    REQUIRE(fontBytes.size() == 2'057'688U);
    REQUIRE(licenseBytes.size() == 4'916U);
    REQUIRE(sha256(fontBytes) == "9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4");
    REQUIRE(sha256(licenseBytes) == "dbbfd9862cc8513c40d307d892a446b33ef4767e6423a3f74a913b8a210b91fd");

    FontLoadError error = FontLoadError::none;
    std::unique_ptr<FontFace> face = FontFace::loadFromMemory(std::move(fontBytes), error);
    REQUIRE(error == FontLoadError::none);
    REQUIRE(face != nullptr);
    REQUIRE(face->sourceByteCount() == 2'057'688U);
    REQUIRE(face->sourceFingerprint() == 0x3f4eab9610b4cfb3ULL);
    REQUIRE(face->weightCoordinate() == FontFace::canonicalWeight);
    REQUIRE(face->pixelSize() == FontFace::canonicalPixelSize);

    REQUIRE(!face->containsCodepoint(U'\U0001F3C6'));
    REQUIRE(!face->containsCodepoint(U'\U0001F4D6'));
    REQUIRE(iconAssetReplacementFor(U'\U0001F3C6') == IconAssetReplacement::trophy);
    REQUIRE(iconAssetReplacementFor(U'\U0001F4D6') == IconAssetReplacement::book);
    REQUIRE(iconAssetReplacementFor(U'A') == IconAssetReplacement::none);

    const ShapeResult korean = face->shapeUtf8("설정");
    const ShapeResult latin = face->shapeUtf8("Lonely Tower");
    constexpr std::array expectedKorean{
        ShapedGlyph{6'948U, 0U, 3'540, 0, 0, 0},
        ShapedGlyph{8'725U, 3U, 3'540, 0, 0, 0}
    };
    constexpr std::array expectedLatin{
        ShapedGlyph{147U, 0U, 2'184, 0, 0, 0},
        ShapedGlyph{645U, 1U, 2'324, 0, 0, 0},
        ShapedGlyph{630U, 2U, 2'280, 0, 0, 0},
        ShapedGlyph{489U, 3U, 2'264, 0, 0, 0},
        ShapedGlyph{605U, 4U, 892, 0, 0, 0},
        ShapedGlyph{826U, 5U, 2'168, 0, 0, 0},
        ShapedGlyph{2U, 6U, 1'028, 0, 0, 0},
        ShapedGlyph{243U, 7U, 2'188, 0, 0, 0},
        ShapedGlyph{645U, 8U, 2'252, 0, 0, 0},
        ShapedGlyph{813U, 9U, 3'112, 0, 0, 0},
        ShapedGlyph{489U, 10U, 2'264, 0, 0, 0},
        ShapedGlyph{692U, 11U, 1'432, 0, 0, 0}
    };
    requireShapeContract(korean, expectedKorean, 7'080);
    requireShapeContract(latin, expectedLatin, 24'388);
}

[[nodiscard]] std::unique_ptr<cirvivor::render::text::FontFace> loadPretendardFace() {
    using namespace cirvivor::render::text;

    FontLoadError error = FontLoadError::none;
    std::unique_ptr<FontFace> face = FontFace::loadFromMemory(
        readBytes(CIRVIVOR_PRETENDARD_FONT_PATH),
        error
    );
    REQUIRE(error == FontLoadError::none);
    REQUIRE(face != nullptr);
    return face;
}

[[nodiscard]] std::uint64_t fnv1a64(const std::span<const std::uint8_t> bytes) noexcept {
    std::uint64_t hash = 0xcbf29ce484222325ULL;
    for (const std::uint8_t value : bytes) {
        hash ^= value;
        hash *= 1'099'511'628'211ULL;
    }
    return hash;
}

void testVariableWeightAndDeterministicRaster() {
    using namespace cirvivor::render::text;

    std::unique_ptr<FontFace> face = loadPretendardFace();
    REQUIRE(face->minimumWeightCoordinate() == 45);
    REQUIRE(face->maximumWeightCoordinate() == 930);

    REQUIRE(!face->setPixelSize(0));
    REQUIRE(!face->setPixelSize(FontFace::maximumPixelSize + 1U));
    REQUIRE(face->pixelSize() == FontFace::canonicalPixelSize);
    REQUIRE(!face->setWeightCoordinate(44));
    REQUIRE(!face->setWeightCoordinate(931));
    REQUIRE(face->weightCoordinate() == FontFace::canonicalWeight);

    REQUIRE(face->setPixelSize(32));
    REQUIRE(face->setWeightCoordinate(300));
    const ShapeResult lightShape = face->shapeUtf8("설정");
    REQUIRE(lightShape.success);
    REQUIRE(lightShape.glyphs.size() == 2U);
    const GlyphRasterResult first = face->rasterizeGlyph(lightShape.glyphs[0].glyphIndex);
    const GlyphRasterResult repeated = face->rasterizeGlyph(lightShape.glyphs[0].glyphIndex);
    REQUIRE(first.success());
    REQUIRE(repeated.success());
    REQUIRE(first.glyph.width > 0U);
    REQUIRE(first.glyph.height > 0U);
    REQUIRE(first.glyph.coverage.size()
        == static_cast<std::size_t>(first.glyph.width) * first.glyph.height);
    REQUIRE(first.glyph.width == repeated.glyph.width);
    REQUIRE(first.glyph.height == repeated.glyph.height);
    REQUIRE(first.glyph.bearingX == repeated.glyph.bearingX);
    REQUIRE(first.glyph.bearingY == repeated.glyph.bearingY);
    REQUIRE(first.glyph.advanceX26Dot6 == repeated.glyph.advanceX26Dot6);
    REQUIRE(first.glyph.coverage == repeated.glyph.coverage);
    REQUIRE(std::any_of(
        first.glyph.coverage.begin(),
        first.glyph.coverage.end(),
        [](const std::uint8_t value) { return value != 0U; }
    ));
    REQUIRE(fnv1a64(first.glyph.coverage) == 0xa432e67001540319ULL);

    REQUIRE(face->setWeightCoordinate(700));
    const ShapeResult boldShape = face->shapeUtf8("설정");
    REQUIRE(boldShape.success);
    REQUIRE(boldShape.glyphs.size() == lightShape.glyphs.size());
    const GlyphRasterResult bold = face->rasterizeGlyph(boldShape.glyphs[0].glyphIndex);
    REQUIRE(bold.success());
    REQUIRE(bold.glyph.coverage != first.glyph.coverage);

    const ShapeResult spaceShape = face->shapeUtf8(" ");
    REQUIRE(spaceShape.success);
    REQUIRE(spaceShape.glyphs.size() == 1U);
    const GlyphRasterResult space = face->rasterizeGlyph(spaceShape.glyphs[0].glyphIndex);
    REQUIRE(space.success());
    REQUIRE(space.glyph.width == 0U);
    REQUIRE(space.glyph.height == 0U);
    REQUIRE(space.glyph.coverage.empty());

    const GlyphRasterResult invalid = face->rasterizeGlyph(UINT32_MAX);
    REQUIRE(!invalid.success());
    REQUIRE(invalid.error == GlyphRasterError::invalidGlyphIndex);
}

void testFixedCapacityGlyphAtlas() {
    using namespace cirvivor::render::text;

    GlyphAtlasCreateError createError = GlyphAtlasCreateError::none;
    REQUIRE(GlyphAtlas::create(0, 256, 16, createError) == nullptr);
    REQUIRE(createError == GlyphAtlasCreateError::invalidDimensions);
    REQUIRE(GlyphAtlas::create(256, 256, 0, createError) == nullptr);
    REQUIRE(createError == GlyphAtlasCreateError::invalidCapacity);

    std::unique_ptr<GlyphAtlas> atlas = GlyphAtlas::create(256, 256, 16, createError);
    REQUIRE(createError == GlyphAtlasCreateError::none);
    REQUIRE(atlas != nullptr);
    REQUIRE(atlas->width() == 256U);
    REQUIRE(atlas->height() == 256U);
    REQUIRE(atlas->entryCapacity() == 16U);

    std::unique_ptr<FontFace> face = loadPretendardFace();
    REQUIRE(face->setPixelSize(32));
    REQUIRE(face->setWeightCoordinate(400));
    const ShapeResult shaped = face->shapeUtf8("설정 설정");
    REQUIRE(shaped.success);
    REQUIRE(shaped.glyphs.size() == 5U);

    const GlyphAtlasCacheResult first = atlas->cacheGlyph(
        *face,
        shaped.glyphs[0].glyphIndex
    );
    const GlyphAtlasCacheResult second = atlas->cacheGlyph(
        *face,
        shaped.glyphs[1].glyphIndex
    );
    const GlyphAtlasCacheResult space = atlas->cacheGlyph(
        *face,
        shaped.glyphs[2].glyphIndex
    );
    REQUIRE(first.status == GlyphAtlasCacheStatus::inserted);
    REQUIRE(second.status == GlyphAtlasCacheStatus::inserted);
    REQUIRE(space.status == GlyphAtlasCacheStatus::inserted);
    REQUIRE(atlas->entryCount() == 3U);
    REQUIRE(atlas->generation() == 3U);

    const std::uint64_t populatedPixelHash = fnv1a64(atlas->pixels());
    REQUIRE(populatedPixelHash == 0xced22a0a2891f249ULL);
    REQUIRE(populatedPixelHash != fnv1a64(
        std::vector<std::uint8_t>(65'536U, std::uint8_t{0})
    ));
    const std::uint64_t generationBeforeDuplicate = atlas->generation();
    const GlyphAtlasCacheResult duplicate = atlas->cacheGlyph(
        *face,
        shaped.glyphs[3].glyphIndex
    );
    REQUIRE(duplicate.status == GlyphAtlasCacheStatus::alreadyCached);
    REQUIRE(duplicate.entryIndex == first.entryIndex);
    REQUIRE(atlas->generation() == generationBeforeDuplicate);
    REQUIRE(fnv1a64(atlas->pixels()) == populatedPixelHash);

    const GlyphAtlasEntry* firstEntry = atlas->entry(first.entryIndex);
    REQUIRE(firstEntry != nullptr);
    REQUIRE(firstEntry->x >= GlyphAtlas::padding);
    REQUIRE(firstEntry->y >= GlyphAtlas::padding);
    REQUIRE(atlas->find(firstEntry->key) == first.entryIndex);
    REQUIRE(atlas->entry(UINT32_MAX) == nullptr);
    const GlyphAtlasKey firstKey = firstEntry->key;

    std::unique_ptr<GlyphAtlas> capacityLimited = GlyphAtlas::create(
        256,
        256,
        1,
        createError
    );
    REQUIRE(capacityLimited != nullptr);
    REQUIRE(capacityLimited->cacheGlyph(*face, shaped.glyphs[0].glyphIndex).success());
    const std::uint64_t limitedGeneration = capacityLimited->generation();
    const std::uint64_t limitedHash = fnv1a64(capacityLimited->pixels());
    const GlyphAtlasCacheResult capacityFailure = capacityLimited->cacheGlyph(
        *face,
        shaped.glyphs[1].glyphIndex
    );
    REQUIRE(capacityFailure.status == GlyphAtlasCacheStatus::entryCapacityExceeded);
    REQUIRE(capacityLimited->entryCount() == 1U);
    REQUIRE(capacityLimited->generation() == limitedGeneration);
    REQUIRE(fnv1a64(capacityLimited->pixels()) == limitedHash);

    std::unique_ptr<GlyphAtlas> spaceLimited = GlyphAtlas::create(4, 4, 4, createError);
    REQUIRE(spaceLimited != nullptr);
    const GlyphAtlasCacheResult spaceFailure = spaceLimited->cacheGlyph(
        *face,
        shaped.glyphs[0].glyphIndex
    );
    REQUIRE(spaceFailure.status == GlyphAtlasCacheStatus::atlasSpaceExceeded);
    REQUIRE(spaceLimited->entryCount() == 0U);
    REQUIRE(spaceLimited->generation() == 0U);
    REQUIRE(std::all_of(
        spaceLimited->pixels().begin(),
        spaceLimited->pixels().end(),
        [](const std::uint8_t value) { return value == 0U; }
    ));

    const std::uint64_t generationBeforeClear = atlas->generation();
    atlas->clear();
    REQUIRE(atlas->entryCount() == 0U);
    REQUIRE(atlas->generation() == generationBeforeClear + 1U);
    REQUIRE(atlas->find(firstKey) == GlyphAtlasCacheResult::invalidEntryIndex);
    REQUIRE(std::all_of(
        atlas->pixels().begin(),
        atlas->pixels().end(),
        [](const std::uint8_t value) { return value == 0U; }
    ));
}

[[nodiscard]] std::vector<cirvivor::render::text::TextPreloadSpec>
makeCompleteTitleTextSpecs() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::text;

    std::vector<TextPreloadSpec> specs;
    specs.reserve(title_text_catalog.size() * 2U);
    for (const TitleTextCatalogEntry& entry : title_text_catalog) {
        specs.push_back({titleTextKey(entry.semantic, UiTextLocale::korean), entry.korean});
        specs.push_back({titleTextKey(entry.semantic, UiTextLocale::english), entry.english});
    }
    return specs;
}

void testTransactionalShapedTextCache() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::text;

    const std::vector<std::byte> fontBytes = readBytes(CIRVIVOR_PRETENDARD_FONT_PATH);
    const std::vector<TextPreloadSpec> specs = makeCompleteTitleTextSpecs();
    ShapedTextCacheBuildError error = ShapedTextCacheBuildError::none;
    std::unique_ptr<ShapedTextCache> cache = ShapedTextCache::create(
        fontBytes,
        specs,
        7U,
        error
    );
    REQUIRE(error == ShapedTextCacheBuildError::none);
    REQUIRE(cache != nullptr);
    REQUIRE(cache->generation() == 7U);
    REQUIRE(cache->runCount() == specs.size());

    const PreShapedTextResourcesView textResources = cache->textResources();
    const RenderResourcesView renderResources = cache->renderResources();
    REQUIRE(textResources.isValid());
    REQUIRE(renderResources.isValid());
    REQUIRE(textResources.generation() == 7U);
    REQUIRE(textResources.runs().size() == specs.size());
    REQUIRE(renderResources.alpha8Textures().size() == 1U);
    const Alpha8TextureResourceView& atlas = renderResources.alpha8Textures().front();
    REQUIRE(atlas.id == pretendard_glyph_atlas_resource_id);
    REQUIRE(atlas.generation == 7U);
    REQUIRE(atlas.width == ShapedTextCache::atlas_dimension);
    REQUIRE(atlas.height == ShapedTextCache::atlas_dimension);
    REQUIRE(atlas.rowPitch == ShapedTextCache::atlas_dimension);
    REQUIRE(atlas.pixels.size()
        == static_cast<std::size_t>(ShapedTextCache::atlas_dimension)
            * ShapedTextCache::atlas_dimension);
    REQUIRE(std::any_of(
        atlas.pixels.begin(),
        atlas.pixels.end(),
        [](const std::uint8_t value) { return value != 0U; }
    ));

    for (const TextPreloadSpec& spec : specs) {
        const PreShapedTextRunView* const run = textResources.find(spec.key);
        REQUIRE(run != nullptr);
        REQUIRE(run->fontId == pretendard_font_resource_id);
        REQUIRE(run->glyphAtlasId == pretendard_glyph_atlas_resource_id);
        REQUIRE(run->rasterPixelSize == ShapedTextCache::raster_pixel_size);
        REQUIRE(run->advance >= 0.0F);
        REQUIRE(run->ascent > 0.0F);
        REQUIRE(run->descent >= 0.0F);
        REQUIRE(!run->glyphs.empty());
        for (const GlyphInstance& glyph : run->glyphs) {
            REQUIRE(glyph.atlasPage == 0U);
            REQUIRE(glyph.uv.x >= 0.0F);
            REQUIRE(glyph.uv.y >= 0.0F);
            REQUIRE(glyph.uv.width >= 0.0F);
            REQUIRE(glyph.uv.height >= 0.0F);
            REQUIRE(glyph.uv.x + glyph.uv.width <= 1.0F);
            REQUIRE(glyph.uv.y + glyph.uv.height <= 1.0F);
        }
    }
    REQUIRE(textResources.find({
        UiTextSemanticId::titleCardStart,
        UiTextLocale::korean,
        16'001U,
        700
    }) == nullptr);

    const std::uint8_t* const originalAtlasAddress = atlas.pixels.data();
    const std::uint64_t originalAtlasHash = fnv1a64(atlas.pixels);
    const std::array duplicateSpecs{
        TextPreloadSpec{specs[0].key, "A"},
        TextPreloadSpec{specs[0].key, "B"}
    };
    std::unique_ptr<ShapedTextCache> rejected = ShapedTextCache::create(
        fontBytes,
        duplicateSpecs,
        8U,
        error
    );
    REQUIRE(rejected == nullptr);
    REQUIRE(error == ShapedTextCacheBuildError::duplicateKey);
    REQUIRE(cache->generation() == 7U);
    REQUIRE(cache->renderResources().alpha8Textures().front().pixels.data()
        == originalAtlasAddress);
    REQUIRE(fnv1a64(cache->renderResources().alpha8Textures().front().pixels)
        == originalAtlasHash);

    const TextPreloadSpec missingGlyphSpec{
        titleTextKey(UiTextSemanticId::utilityAchievements, UiTextLocale::korean),
        "\xF0\x9F\x8F\x86"
    };
    rejected = ShapedTextCache::create(fontBytes, {&missingGlyphSpec, 1U}, 8U, error);
    REQUIRE(rejected == nullptr);
    REQUIRE(error == ShapedTextCacheBuildError::missingGlyph);

    rejected = ShapedTextCache::create({}, specs, 8U, error);
    REQUIRE(rejected == nullptr);
    REQUIRE(error == ShapedTextCacheBuildError::emptyFont);
    rejected = ShapedTextCache::create(fontBytes, specs, 0U, error);
    REQUIRE(rejected == nullptr);
    REQUIRE(error == ShapedTextCacheBuildError::invalidGeneration);

    const std::array<std::uint8_t, 1> pixel{255U};
    const std::array resource{
        Alpha8TextureResourceView{
            pretendard_glyph_atlas_resource_id,
            9U,
            1U,
            1U,
            1U,
            pixel
        }
    };
    const std::array run{
        PreShapedTextRunView{
            specs[0].key,
            pretendard_font_resource_id,
            pretendard_glyph_atlas_resource_id,
            ShapedTextCache::raster_pixel_size,
            1.0F,
            1.0F,
            0.0F,
            {}
        }
    };
    const PreShapedTextResourcesView mismatchedGeneration(
        8U,
        run,
        RenderResourcesView(resource)
    );
    REQUIRE(!mismatchedGeneration.isValid());
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    constexpr std::array tests{
        TestCase{"asset integrity, memory face, and shaping", testAssetIntegrityAndMemoryFace},
        TestCase{"variable weight and deterministic raster", testVariableWeightAndDeterministicRaster},
        TestCase{"fixed-capacity glyph atlas", testFixedCapacityGlyphAtlas},
        TestCase{"transactional shaped text cache", testTransactionalShapedTextCache}
    };

    std::size_t passed = 0;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }

    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
