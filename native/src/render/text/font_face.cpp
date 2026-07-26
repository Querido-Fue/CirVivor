#include "render/text/font_face.h"

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MULTIPLE_MASTERS_H

#include <hb-ft.h>
#include <hb.h>

#include <algorithm>
#include <climits>
#include <limits>
#include <utility>

namespace cirvivor::render::text {

namespace {

constexpr FT_ULong weightAxisTag = FT_MAKE_TAG('w', 'g', 'h', 't');

enum class WeightConfigurationResult : std::uint8_t {
    success,
    axisUnavailable,
    coordinateFailed
};

[[nodiscard]] WeightConfigurationResult applyCanonicalWeight(
    FT_Library library,
    FT_Face face
) {
    FT_MM_Var* variation = nullptr;
    if (FT_Get_MM_Var(face, &variation) != 0 || variation == nullptr) {
        return WeightConfigurationResult::axisUnavailable;
    }

    std::vector<FT_Fixed> coordinates(variation->num_axis);
    bool foundWeightAxis = false;
    for (FT_UInt index = 0; index < variation->num_axis; ++index) {
        const FT_Var_Axis& axis = variation->axis[index];
        coordinates[index] = axis.def;
        if (axis.tag == weightAxisTag) {
            constexpr FT_Fixed requestedWeight =
                static_cast<FT_Fixed>(FontFace::canonicalWeight) << 16;
            coordinates[index] = std::clamp(requestedWeight, axis.minimum, axis.maximum);
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
        coordinates.data()
    );
    FT_Done_MM_Var(library, variation);
    return coordinateError == 0
        ? WeightConfigurationResult::success
        : WeightConfigurationResult::coordinateFailed;
}

} // namespace

struct FontFace::Impl final {
    std::vector<std::byte> sourceBytes;
    FT_Library library = nullptr;
    FT_Face face = nullptr;
    hb_font_t* shapingFont = nullptr;
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
    const WeightConfigurationResult weightResult = applyCanonicalWeight(
        implementation->library,
        implementation->face
    );
    if (weightResult == WeightConfigurationResult::axisUnavailable) {
        error = FontLoadError::weightAxisUnavailable;
        return nullptr;
    }
    if (weightResult == WeightConfigurationResult::coordinateFailed) {
        error = FontLoadError::weightCoordinateFailed;
        return nullptr;
    }

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
    if (pixelSize == 0U || pixelSize > static_cast<std::uint32_t>(INT_MAX / 64)) {
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

std::uint32_t FontFace::pixelSize() const noexcept {
    return implementation_->pixelSize;
}

std::int32_t FontFace::weightCoordinate() const noexcept {
    return implementation_->weightCoordinate;
}

} // namespace cirvivor::render::text
