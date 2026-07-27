#pragma once

#include "render/common/pre_shaped_text.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <string_view>
#include <vector>

namespace cirvivor::render::text {

inline constexpr ResourceId pretendard_font_resource_id = stableResourceId(
    "ui.font.pretendard-variable"
);
inline constexpr ResourceId pretendard_glyph_atlas_resource_id = stableResourceId(
    "ui.font.pretendard-variable.a8-atlas"
);

enum class ShapedTextCacheBuildError : std::uint8_t {
    none = 0,
    emptyFont,
    invalidGeneration,
    invalidSpec,
    duplicateKey,
    fontLoadFailed,
    faceConfigurationFailed,
    shapingFailed,
    missingGlyph,
    atlasCreationFailed,
    glyphCacheFailed,
    allocationFailed
};

struct TextPreloadSpec final {
    PreShapedTextKey key{};
    std::string_view utf8;
};

/**
 * shape 결과와 A8 atlas를 한 덩어리로 소유하는 immutable snapshot입니다. create가
 * 성공한 후보만 swap하면 resize/reload 실패 시 기존 snapshot이 그대로 유지됩니다.
 */
class ShapedTextCache final {
public:
    struct OwnedRun;
    struct Impl;

    static constexpr std::uint32_t raster_pixel_size = 64U;
    static constexpr std::uint32_t atlas_dimension = 2'048U;
    static constexpr std::uint32_t atlas_entry_capacity = 2'048U;

    [[nodiscard]] static std::unique_ptr<ShapedTextCache> create(
        std::span<const std::byte> fontBytes,
        std::span<const TextPreloadSpec> specs,
        std::uint64_t generation,
        ShapedTextCacheBuildError& error
    );

    ShapedTextCache(const ShapedTextCache&) = delete;
    ShapedTextCache& operator=(const ShapedTextCache&) = delete;
    ShapedTextCache(ShapedTextCache&&) = delete;
    ShapedTextCache& operator=(ShapedTextCache&&) = delete;
    ~ShapedTextCache();

    [[nodiscard]] PreShapedTextResourcesView textResources() const noexcept;
    [[nodiscard]] RenderResourcesView renderResources() const noexcept;
    [[nodiscard]] std::uint64_t generation() const noexcept;
    [[nodiscard]] std::size_t runCount() const noexcept;

private:
    explicit ShapedTextCache(std::unique_ptr<Impl> implementation) noexcept;

    std::unique_ptr<Impl> implementation_;
};

} // namespace cirvivor::render::text
