#include "render/text/font_face.h"

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MULTIPLE_MASTERS_H

#include <hb-ft.h>
#include <hb.h>

#include <algorithm>
#include <climits>
#include <limits>
#include <new>
#include <utility>

namespace cirvivor::render::text {

namespace {

constexpr FT_ULong weightAxisTag = FT_MAKE_TAG('w', 'g', 'h', 't');
constexpr std::size_t maximumGlyphBitmapPixels = 64U * 1024U * 1024U;

[[nodiscard]] std::uint64_t fingerprintBytes(
    const std::vector<std::byte>& bytes
) noexcept {
    std::uint64_t hash = 0xcbf29ce484222325ULL;
    for (const std::byte value : bytes) {
        hash ^= std::to_integer<std::uint8_t>(value);
        hash *= 1'099'511'628'211ULL;
    }
    return hash;
}

enum class WeightConfigurationResult : std::uint8_t {
    success,
    axisUnavailable,
    coordinateFailed
};

struct WeightAxisConfiguration final {
    std::vector<FT_Fixed> coordinates;
    FT_UInt weightAxisIndex = 0;
    FT_Fixed minimum = 0;
    FT_Fixed maximum = 0;
};

[[nodiscard]] bool toFixedWeight(
    const std::int32_t weight,
    FT_Fixed& result
) noexcept {
    constexpr std::int64_t fixedScale = 1LL << 16;
    const std::int64_t value = static_cast<std::int64_t>(weight) * fixedScale;
    if (value < static_cast<std::int64_t>(std::numeric_limits<FT_Fixed>::min())
        || value > static_cast<std::int64_t>(std::numeric_limits<FT_Fixed>::max())) {
        return false;
    }
    result = static_cast<FT_Fixed>(value);
    return true;
}

[[nodiscard]] WeightConfigurationResult initializeWeightAxis(
    FT_Library library,
    FT_Face face,
    const std::int32_t requestedWeight,
    WeightAxisConfiguration& configuration
) {
    FT_MM_Var* variation = nullptr;
    if (FT_Get_MM_Var(face, &variation) != 0 || variation == nullptr) {
        return WeightConfigurationResult::axisUnavailable;
    }

    configuration.coordinates.resize(variation->num_axis);
    bool foundWeightAxis = false;
    for (FT_UInt index = 0; index < variation->num_axis; ++index) {
        const FT_Var_Axis& axis = variation->axis[index];
        configuration.coordinates[index] = axis.def;
        if (axis.tag == weightAxisTag) {
            FT_Fixed requestedFixed = 0;
            if (!toFixedWeight(requestedWeight, requestedFixed)
                || requestedFixed < axis.minimum
                || requestedFixed > axis.maximum) {
                FT_Done_MM_Var(library, variation);
                return WeightConfigurationResult::coordinateFailed;
            }
            configuration.coordinates[index] = requestedFixed;
            configuration.weightAxisIndex = index;
            configuration.minimum = axis.minimum;
            configuration.maximum = axis.maximum;
            foundWeightAxis = true;
        }
    }

    if (!foundWeightAxis) {
        FT_Done_MM_Var(library, variation);
        return WeightConfigurationResult::axisUnavailable;
    }

    const FT_Error coordinateError = FT_Set_Var_Design_Coordinates(
        face,
        variation->num_axis,
        configuration.coordinates.data()
    );
    FT_Done_MM_Var(library, variation);
    return coordinateError == 0
        ? WeightConfigurationResult::success
        : WeightConfigurationResult::coordinateFailed;
}

} // namespace

struct FontFace::Impl final {
    std::vector<std::byte> sourceBytes;
    std::uint64_t sourceFingerprint = 0;
    FT_Library library = nullptr;
    FT_Face face = nullptr;
    hb_font_t* shapingFont = nullptr;
    std::vector<FT_Fixed> variationCoordinates;
    FT_UInt weightAxisIndex = 0;
    FT_Fixed minimumWeight = 0;
    FT_Fixed maximumWeight = 0;
    std::uint32_t pixelSize = 0;
    std::int32_t weightCoordinate = 0;

    ~Impl() {
        if (shapingFont != nullptr) {
            hb_font_destroy(shapingFont);
        }
        if (face != nullptr) {
            FT_Done_Face(face);
        }
        if (library != nullptr) {
            FT_Done_FreeType(library);
        }
    }
};

std::unique_ptr<FontFace> FontFace::loadFromMemory(
    std::vector<std::byte> sourceBytes,
    FontLoadError& error
) {
    error = FontLoadError::none;
    if (sourceBytes.empty()) {
        error = FontLoadError::emptyData;
        return nullptr;
    }
    if (sourceBytes.size() > static_cast<std::size_t>(std::numeric_limits<FT_Long>::max())) {
        error = FontLoadError::dataTooLarge;
        return nullptr;
    }

    auto implementation = std::make_unique<Impl>();
    implementation->sourceBytes = std::move(sourceBytes);
    implementation->sourceFingerprint = fingerprintBytes(implementation->sourceBytes);
    if (FT_Init_FreeType(&implementation->library) != 0) {
        error = FontLoadError::libraryInitializationFailed;
        return nullptr;
    }

    const auto* bytes = reinterpret_cast<const FT_Byte*>(
        implementation->sourceBytes.data()
    );
    if (FT_New_Memory_Face(
        implementation->library,
        bytes,
        static_cast<FT_Long>(implementation->sourceBytes.size()),
        0,
        &implementation->face
    ) != 0) {
        error = FontLoadError::memoryFaceCreationFailed;
        return nullptr;
    }
    if (FT_Select_Charmap(implementation->face, FT_ENCODING_UNICODE) != 0) {
        error = FontLoadError::unicodeCharmapUnavailable;
        return nullptr;
    }
    WeightAxisConfiguration weightConfiguration;
    const WeightConfigurationResult weightResult = initializeWeightAxis(
        implementation->library,
        implementation->face,
        canonicalWeight,
        weightConfiguration
    );
    if (weightResult == WeightConfigurationResult::axisUnavailable) {
        error = FontLoadError::weightAxisUnavailable;
        return nullptr;
    }
    if (weightResult == WeightConfigurationResult::coordinateFailed) {
        error = FontLoadError::weightCoordinateFailed;
        return nullptr;
    }

    implementation->variationCoordinates = std::move(weightConfiguration.coordinates);
    implementation->weightAxisIndex = weightConfiguration.weightAxisIndex;
    implementation->minimumWeight = weightConfiguration.minimum;
    implementation->maximumWeight = weightConfiguration.maximum;
    implementation->weightCoordinate = canonicalWeight;
    implementation->shapingFont = hb_ft_font_create_referenced(implementation->face);
    if (implementation->shapingFont == nullptr) {
        error = FontLoadError::shapingFontCreationFailed;
        return nullptr;
    }
    hb_ft_font_set_load_flags(
        implementation->shapingFont,
        FT_LOAD_NO_HINTING | FT_LOAD_NO_AUTOHINT | FT_LOAD_NO_BITMAP
    );

    auto result = std::unique_ptr<FontFace>(new FontFace(std::move(implementation)));
    if (!result->setPixelSize(canonicalPixelSize)) {
        error = FontLoadError::sizeConfigurationFailed;
        return nullptr;
    }
    return result;
}

FontFace::FontFace(std::unique_ptr<Impl> implementation) noexcept
    : implementation_(std::move(implementation)) {}

FontFace::~FontFace() = default;

bool FontFace::setPixelSize(const std::uint32_t pixelSize) noexcept {
    if (pixelSize == 0U
        || pixelSize > maximumPixelSize
        || pixelSize > static_cast<std::uint32_t>(INT_MAX / 64)) {
        return false;
    }
    const auto characterHeight = static_cast<FT_F26Dot6>(pixelSize * 64U);
    if (FT_Set_Char_Size(implementation_->face, 0, characterHeight, 72, 72) != 0) {
        return false;
    }
    implementation_->pixelSize = pixelSize;
    hb_ft_font_changed(implementation_->shapingFont);
    return true;
}

bool FontFace::setWeightCoordinate(const std::int32_t weight) noexcept {
    FT_Fixed requestedWeight = 0;
    if (!toFixedWeight(weight, requestedWeight)
        || requestedWeight < implementation_->minimumWeight
        || requestedWeight > implementation_->maximumWeight
        || implementation_->weightAxisIndex >= implementation_->variationCoordinates.size()) {
        return false;
    }

    const FT_Fixed previousWeight =
        implementation_->variationCoordinates[implementation_->weightAxisIndex];
    implementation_->variationCoordinates[implementation_->weightAxisIndex] = requestedWeight;
    if (FT_Set_Var_Design_Coordinates(
        implementation_->face,
        static_cast<FT_UInt>(implementation_->variationCoordinates.size()),
        implementation_->variationCoordinates.data()
    ) != 0) {
        implementation_->variationCoordinates[implementation_->weightAxisIndex] = previousWeight;
        static_cast<void>(FT_Set_Var_Design_Coordinates(
            implementation_->face,
            static_cast<FT_UInt>(implementation_->variationCoordinates.size()),
            implementation_->variationCoordinates.data()
        ));
        return false;
    }

    implementation_->weightCoordinate = weight;
    hb_ft_font_changed(implementation_->shapingFont);
    return true;
}

ShapeResult FontFace::shapeUtf8(const std::string_view utf8) const {
    ShapeResult result;
    if (utf8.size() > static_cast<std::size_t>(INT_MAX)) {
        return result;
    }

    using BufferOwner = std::unique_ptr<hb_buffer_t, decltype(&hb_buffer_destroy)>;
    BufferOwner buffer(hb_buffer_create(), &hb_buffer_destroy);
    if (buffer == nullptr || !hb_buffer_allocation_successful(buffer.get())) {
        return result;
    }

    hb_buffer_add_utf8(
        buffer.get(),
        utf8.data(),
        static_cast<int>(utf8.size()),
        0,
        static_cast<int>(utf8.size())
    );
    hb_buffer_guess_segment_properties(buffer.get());
    hb_shape(implementation_->shapingFont, buffer.get(), nullptr, 0);

    unsigned int glyphCount = 0;
    const hb_glyph_info_t* glyphInfos = hb_buffer_get_glyph_infos(
        buffer.get(),
        &glyphCount
    );
    const hb_glyph_position_t* glyphPositions = hb_buffer_get_glyph_positions(
        buffer.get(),
        &glyphCount
    );
    if ((glyphCount > 0U && (glyphInfos == nullptr || glyphPositions == nullptr))
        || !hb_buffer_allocation_successful(buffer.get())) {
        return result;
    }

    result.glyphs.reserve(glyphCount);
    for (unsigned int index = 0; index < glyphCount; ++index) {
        const hb_glyph_position_t& position = glyphPositions[index];
        result.glyphs.push_back({
            glyphInfos[index].codepoint,
            glyphInfos[index].cluster,
            position.x_advance,
            position.y_advance,
            position.x_offset,
            position.y_offset
        });
        result.totalXAdvance26Dot6 += position.x_advance;
        result.totalYAdvance26Dot6 += position.y_advance;
    }
    result.success = true;
    return result;
}

GlyphRasterResult FontFace::rasterizeGlyph(const std::uint32_t glyphIndex) const {
    GlyphRasterResult result;
    if (glyphIndex >= static_cast<std::uint64_t>(implementation_->face->num_glyphs)) {
        result.error = GlyphRasterError::invalidGlyphIndex;
        return result;
    }

    constexpr FT_Int32 loadFlags =
        FT_LOAD_NO_HINTING | FT_LOAD_NO_AUTOHINT | FT_LOAD_NO_BITMAP | FT_LOAD_TARGET_NORMAL;
    if (FT_Load_Glyph(implementation_->face, glyphIndex, loadFlags) != 0) {
        result.error = GlyphRasterError::glyphLoadFailed;
        return result;
    }
    if (FT_Render_Glyph(implementation_->face->glyph, FT_RENDER_MODE_NORMAL) != 0) {
        result.error = GlyphRasterError::glyphRenderFailed;
        return result;
    }

    const FT_GlyphSlot slot = implementation_->face->glyph;
    const FT_Bitmap& bitmap = slot->bitmap;
    if (slot->bitmap_left < std::numeric_limits<std::int32_t>::min()
        || slot->bitmap_left > std::numeric_limits<std::int32_t>::max()
        || slot->bitmap_top < std::numeric_limits<std::int32_t>::min()
        || slot->bitmap_top > std::numeric_limits<std::int32_t>::max()
        || slot->advance.x < std::numeric_limits<std::int32_t>::min()
        || slot->advance.x > std::numeric_limits<std::int32_t>::max()
        || slot->advance.y < std::numeric_limits<std::int32_t>::min()
        || slot->advance.y > std::numeric_limits<std::int32_t>::max()) {
        result.error = GlyphRasterError::invalidBitmapLayout;
        return result;
    }

    RasterizedGlyph& output = result.glyph;
    output.width = bitmap.width;
    output.height = bitmap.rows;
    output.bearingX = static_cast<std::int32_t>(slot->bitmap_left);
    output.bearingY = static_cast<std::int32_t>(slot->bitmap_top);
    output.advanceX26Dot6 = static_cast<std::int32_t>(slot->advance.x);
    output.advanceY26Dot6 = static_cast<std::int32_t>(slot->advance.y);

    if (output.width == 0U || output.height == 0U) {
        result.error = GlyphRasterError::none;
        return result;
    }
    if (bitmap.pixel_mode != FT_PIXEL_MODE_GRAY) {
        result.error = GlyphRasterError::unsupportedPixelMode;
        return result;
    }
    if (bitmap.buffer == nullptr || bitmap.pitch == 0 || bitmap.num_grays <= 1U) {
        result.error = GlyphRasterError::invalidBitmapLayout;
        return result;
    }

    const std::int64_t signedPitch = bitmap.pitch;
    const std::uint64_t absolutePitch = static_cast<std::uint64_t>(
        signedPitch < 0 ? -signedPitch : signedPitch
    );
    if (absolutePitch < output.width) {
        result.error = GlyphRasterError::invalidBitmapLayout;
        return result;
    }
    const std::uint64_t pixelCount =
        static_cast<std::uint64_t>(output.width) * output.height;
    if (pixelCount > maximumGlyphBitmapPixels
        || pixelCount > std::numeric_limits<std::size_t>::max()) {
        result.error = GlyphRasterError::bitmapTooLarge;
        return result;
    }

    try {
        output.coverage.resize(static_cast<std::size_t>(pixelCount));
    } catch (const std::bad_alloc&) {
        result.error = GlyphRasterError::allocationFailed;
        return result;
    }

    for (std::uint32_t row = 0; row < output.height; ++row) {
        const std::uint32_t sourceRow = signedPitch >= 0
            ? row
            : (output.height - 1U - row);
        const auto* source = bitmap.buffer
            + static_cast<std::size_t>(sourceRow * absolutePitch);
        auto* destination = output.coverage.data()
            + static_cast<std::size_t>(row) * output.width;
        if (bitmap.num_grays == 256U) {
            std::copy_n(source, output.width, destination);
            continue;
        }
        for (std::uint32_t column = 0; column < output.width; ++column) {
            const std::uint32_t scaled =
                static_cast<std::uint32_t>(source[column]) * 255U
                / static_cast<std::uint32_t>(bitmap.num_grays - 1U);
            destination[column] = static_cast<std::uint8_t>(scaled);
        }
    }

    result.error = GlyphRasterError::none;
    return result;
}

bool FontFace::containsCodepoint(const char32_t codepoint) const noexcept {
    if (codepoint > static_cast<char32_t>(0x10FFFFU)) {
        return false;
    }
    return FT_Get_Char_Index(
        implementation_->face,
        static_cast<FT_ULong>(codepoint)
    ) != 0U;
}

std::size_t FontFace::sourceByteCount() const noexcept {
    return implementation_->sourceBytes.size();
}

std::uint64_t FontFace::sourceFingerprint() const noexcept {
    return implementation_->sourceFingerprint;
}

std::uint32_t FontFace::pixelSize() const noexcept {
    return implementation_->pixelSize;
}

std::int32_t FontFace::weightCoordinate() const noexcept {
    return implementation_->weightCoordinate;
}

std::int32_t FontFace::minimumWeightCoordinate() const noexcept {
    return static_cast<std::int32_t>(implementation_->minimumWeight / 65'536);
}

std::int32_t FontFace::maximumWeightCoordinate() const noexcept {
    return static_cast<std::int32_t>(implementation_->maximumWeight / 65'536);
}

std::int32_t FontFace::ascender26Dot6() const noexcept {
    return implementation_->face->size == nullptr
        ? 0
        : static_cast<std::int32_t>(implementation_->face->size->metrics.ascender);
}

std::int32_t FontFace::descender26Dot6() const noexcept {
    return implementation_->face->size == nullptr
        ? 0
        : static_cast<std::int32_t>(implementation_->face->size->metrics.descender);
}

std::int32_t FontFace::lineHeight26Dot6() const noexcept {
    return implementation_->face->size == nullptr
        ? 0
        : static_cast<std::int32_t>(implementation_->face->size->metrics.height);
}

} // namespace cirvivor::render::text
