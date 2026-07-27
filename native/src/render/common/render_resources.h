#pragma once

#include "render/common/render_command.h"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>

namespace cirvivor::render {

/**
 * 한 번의 render() 호출 동안만 빌려 쓰는 A8 texture view입니다. pixels의 소유권은
 * 호출자에게 있으며 backend는 포인터를 저장하거나 호출 뒤에 접근하면 안 됩니다.
 */
struct Alpha8TextureResourceView final {
    ResourceId id = invalid_resource_id;
    std::uint64_t generation = 0;
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    std::uint32_t rowPitch = 0;
    std::span<const std::uint8_t> pixels;

    [[nodiscard]] constexpr bool isValid() const noexcept {
        if (id == invalid_resource_id || generation == 0U || width == 0U ||
            height == 0U || rowPitch < width) {
            return false;
        }

        constexpr std::size_t maximum = std::numeric_limits<std::size_t>::max();
        if (static_cast<std::size_t>(height) >
            maximum / static_cast<std::size_t>(rowPitch)) {
            return false;
        }

        const std::size_t required =
            static_cast<std::size_t>(height) * static_cast<std::size_t>(rowPitch);
        return pixels.size() >= required;
    }
};

/**
 * backend-neutral resource table입니다. lookup과 검증은 선형·allocation-free이며,
 * 작은 per-frame immutable table을 전제로 합니다. 같은 ID의 중복은 잘못된 table입니다.
 */
class RenderResourcesView final {
public:
    constexpr RenderResourcesView() noexcept = default;

    explicit constexpr RenderResourcesView(
        const std::span<const Alpha8TextureResourceView> alpha8Textures
    ) noexcept
        : alpha8Textures_(alpha8Textures) {}

    [[nodiscard]] constexpr bool isValid() const noexcept {
        for (std::size_t index = 0; index < alpha8Textures_.size(); ++index) {
            if (!alpha8Textures_[index].isValid()) {
                return false;
            }
            for (std::size_t other = index + 1U; other < alpha8Textures_.size(); ++other) {
                if (alpha8Textures_[index].id == alpha8Textures_[other].id) {
                    return false;
                }
            }
        }
        return true;
    }

    [[nodiscard]] constexpr const Alpha8TextureResourceView* findAlpha8(
        const ResourceId id
    ) const noexcept {
        if (id == invalid_resource_id) {
            return nullptr;
        }
        for (const Alpha8TextureResourceView& texture : alpha8Textures_) {
            if (texture.id == id) {
                return &texture;
            }
        }
        return nullptr;
    }

    [[nodiscard]] constexpr const Alpha8TextureResourceView* findAlpha8(
        const ResourceId id,
        const std::uint64_t generation
    ) const noexcept {
        if (id == invalid_resource_id || generation == 0U) {
            return nullptr;
        }
        for (const Alpha8TextureResourceView& texture : alpha8Textures_) {
            if (texture.id == id && texture.generation == generation) {
                return &texture;
            }
        }
        return nullptr;
    }

    [[nodiscard]] constexpr std::span<const Alpha8TextureResourceView>
    alpha8Textures() const noexcept {
        return alpha8Textures_;
    }

private:
    std::span<const Alpha8TextureResourceView> alpha8Textures_;
};

} // namespace cirvivor::render
