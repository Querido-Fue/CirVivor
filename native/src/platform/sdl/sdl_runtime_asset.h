#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

namespace cirvivor::platform::sdl {

enum class RuntimeAssetError : std::uint8_t {
    none = 0,
    invalidRelativePath,
    basePathUnavailable,
    loadFailed,
    assetTooLarge,
    allocationFailed
};

struct RuntimeAssetReadResult final {
    RuntimeAssetError error = RuntimeAssetError::none;
    std::vector<std::byte> bytes;

    [[nodiscard]] bool success() const noexcept {
        return error == RuntimeAssetError::none;
    }
};

/** SDL_GetBasePath()/runtime_assets 아래의 번들 파일만 읽습니다. */
[[nodiscard]] RuntimeAssetReadResult readRuntimeAsset(
    std::string_view relativePath,
    std::size_t maximumBytes
) noexcept;

} // namespace cirvivor::platform::sdl
