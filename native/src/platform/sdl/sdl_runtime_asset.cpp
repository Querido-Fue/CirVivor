#include "platform/sdl/sdl_runtime_asset.h"

#include <SDL3/SDL.h>

#include <algorithm>
#include <memory>
#include <new>
#include <stdexcept>
#include <string>

namespace cirvivor::platform::sdl {
namespace {

[[nodiscard]] bool relativePathIsSafe(const std::string_view path) noexcept {
    return !path.empty()
        && path.front() != '/'
        && path.front() != '\\'
        && path.find(':') == std::string_view::npos
        && path.find("..") == std::string_view::npos
        && path.find('\\') == std::string_view::npos;
}

struct SdlMemoryDeleter final {
    void operator()(void* const memory) const noexcept {
        SDL_free(memory);
    }
};

} // namespace

RuntimeAssetReadResult readRuntimeAsset(
    const std::string_view relativePath,
    const std::size_t maximumBytes
) noexcept {
    RuntimeAssetReadResult result;
    if (!relativePathIsSafe(relativePath) || maximumBytes == 0U) {
        result.error = RuntimeAssetError::invalidRelativePath;
        return result;
    }
    const char* const basePath = SDL_GetBasePath();
    if (basePath == nullptr || basePath[0] == '\0') {
        result.error = RuntimeAssetError::basePathUnavailable;
        return result;
    }

    try {
        std::string path(basePath);
        if (!path.empty() && path.back() != '/' && path.back() != '\\') {
            path.push_back('/');
        }
        path += "runtime_assets/";
        path.append(relativePath);

        std::size_t byteCount = 0U;
        std::unique_ptr<void, SdlMemoryDeleter> memory(
            SDL_LoadFile(path.c_str(), &byteCount)
        );
        if (memory == nullptr) {
            result.error = RuntimeAssetError::loadFailed;
            return result;
        }
        if (byteCount == 0U || byteCount > maximumBytes) {
            result.error = RuntimeAssetError::assetTooLarge;
            return result;
        }
        const auto* const first = static_cast<const std::byte*>(memory.get());
        result.bytes.assign(first, first + byteCount);
        return result;
    } catch (const std::bad_alloc&) {
        result.bytes.clear();
        result.error = RuntimeAssetError::allocationFailed;
        return result;
    } catch (const std::length_error&) {
        result.bytes.clear();
        result.error = RuntimeAssetError::allocationFailed;
        return result;
    }
}

} // namespace cirvivor::platform::sdl
