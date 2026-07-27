#include "platform/sdl/storage/sdl_user_storage.h"

#include <SDL3/SDL_error.h>
#include <SDL3/SDL_filesystem.h>
#include <SDL3/SDL_log.h>
#include <SDL3/SDL_storage.h>

#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <string_view>

namespace cirvivor::platform::sdl {
namespace {

[[nodiscard]] bool hasText(const char* const value) noexcept {
    return value != nullptr && value[0] != '\0';
}

void logBackendFailure(const char* const operation) noexcept {
    SDL_LogError(
        SDL_LOG_CATEGORY_APPLICATION,
        "User storage %s failed: %s",
        operation,
        SDL_GetError()
    );
}

struct ExistsQuery final {
    std::string_view filename;
    bool found = false;
};

SDL_EnumerationResult SDLCALL findStorageEntry(
    void* const userdata,
    const char*,
    const char* const filename
) {
    auto& query = *static_cast<ExistsQuery*>(userdata);
    if (filename != nullptr && query.filename == filename) {
        query.found = true;
        return SDL_ENUM_SUCCESS;
    }
    return SDL_ENUM_CONTINUE;
}

} // namespace

SdlUserStorage::~SdlUserStorage() {
    static_cast<void>(close());
}

StorageResult SdlUserStorage::open(
    const char* const organization,
    const char* const application
) noexcept {
    if (storage_ != nullptr) {
        return StorageResult::alreadyOpen;
    }
    if (!hasText(organization) || !hasText(application)) {
        return StorageResult::invalidArgument;
    }

    storage_ = SDL_OpenUserStorage(organization, application, 0);
    if (storage_ == nullptr) {
        logBackendFailure("open");
        return StorageResult::backendFailure;
    }
    return StorageResult::success;
}

StorageReadyState SdlUserStorage::readyState() const noexcept {
    if (storage_ == nullptr) {
        return StorageReadyState::closed;
    }
    return SDL_StorageReady(storage_)
        ? StorageReadyState::ready
        : StorageReadyState::pending;
}

StorageExistsResult SdlUserStorage::exists(const char* const path) const noexcept {
    StorageExistsResult result;
    result.status = accessStatus(path);
    if (result.status != StorageResult::success) {
        return result;
    }

    const std::string_view fullPath(path);
    const std::size_t separator = fullPath.find_last_of('/');
    const std::string_view filename = separator == std::string_view::npos
        ? fullPath
        : fullPath.substr(separator + 1U);
    if (filename.empty()) {
        result.status = StorageResult::invalidArgument;
        return result;
    }

    if (SDL_GetStoragePathInfo(storage_, path, nullptr)) {
        result.status = StorageResult::success;
        result.exists = true;
        return result;
    }
    SDL_ClearError();

    std::string directory;
    const char* directoryPath = nullptr;
    if (separator != std::string_view::npos) {
        try {
            directory.assign(fullPath.substr(0U, separator));
        } catch (const std::bad_alloc&) {
            result.status = StorageResult::allocationFailed;
            return result;
        } catch (const std::length_error&) {
            result.status = StorageResult::addressSpaceExceeded;
            return result;
        }
        directoryPath = directory.c_str();
    }

    ExistsQuery query{filename};
    if (!SDL_EnumerateStorageDirectory(
            storage_,
            directoryPath,
            findStorageEntry,
            &query
        )) {
        logBackendFailure("existence query");
        result.status = StorageResult::backendFailure;
        return result;
    }
    result.status = StorageResult::success;
    result.exists = query.found;
    SDL_ClearError();
    return result;
}

StorageReadResult SdlUserStorage::read(
    const char* const path,
    const std::uint64_t maximumBytes
) const noexcept {
    StorageReadResult result;
    result.status = accessStatus(path);
    if (result.status != StorageResult::success) {
        return result;
    }

    Uint64 fileLength = 0;
    if (!SDL_GetStorageFileSize(storage_, path, &fileLength)) {
        logBackendFailure("size query");
        result.status = StorageResult::backendFailure;
        return result;
    }
    if (fileLength > maximumBytes) {
        result.status = StorageResult::readLimitExceeded;
        return result;
    }
    if constexpr (std::numeric_limits<std::size_t>::max()
        < std::numeric_limits<Uint64>::max()) {
        if (fileLength > static_cast<Uint64>(std::numeric_limits<std::size_t>::max())) {
            result.status = StorageResult::addressSpaceExceeded;
            return result;
        }
    }

    const std::size_t byteCount = static_cast<std::size_t>(fileLength);
    if (byteCount > result.bytes.max_size()) {
        result.status = StorageResult::addressSpaceExceeded;
        return result;
    }
    try {
        result.bytes.resize(byteCount);
    } catch (const std::bad_alloc&) {
        result.status = StorageResult::allocationFailed;
        return result;
    } catch (const std::length_error&) {
        result.status = StorageResult::addressSpaceExceeded;
        return result;
    }

    std::byte emptyFileDestination{};
    void* const destination = result.bytes.empty()
        ? static_cast<void*>(&emptyFileDestination)
        : static_cast<void*>(result.bytes.data());
    if (!SDL_ReadStorageFile(storage_, path, destination, fileLength)) {
        logBackendFailure("read");
        result.bytes.clear();
        result.status = StorageResult::backendFailure;
        return result;
    }

    result.status = StorageResult::success;
    return result;
}

StorageResult SdlUserStorage::write(
    const char* const path,
    const std::span<const std::byte> bytes
) noexcept {
    const StorageResult status = accessStatus(path);
    if (status != StorageResult::success) {
        return status;
    }

    static_assert(sizeof(std::size_t) <= sizeof(Uint64));
    const Uint64 byteCount = static_cast<Uint64>(bytes.size());
    const std::byte emptyFileSource{};
    const void* const source = bytes.empty()
        ? static_cast<const void*>(&emptyFileSource)
        : static_cast<const void*>(bytes.data());
    if (!SDL_WriteStorageFile(storage_, path, source, byteCount)) {
        logBackendFailure("write");
        return StorageResult::backendFailure;
    }
    return StorageResult::success;
}

StorageResult SdlUserStorage::renameReplace(
    const char* const source,
    const char* const destination
) noexcept {
    const StorageResult sourceStatus = accessStatus(source);
    if (sourceStatus != StorageResult::success) {
        return sourceStatus;
    }
    const StorageResult destinationStatus = accessStatus(destination);
    if (destinationStatus != StorageResult::success) {
        return destinationStatus;
    }
    if (!SDL_RenameStoragePath(storage_, source, destination)) {
        logBackendFailure("rename/replace");
        return StorageResult::backendFailure;
    }
    return StorageResult::success;
}

StorageResult SdlUserStorage::remove(const char* const path) noexcept {
    const StorageResult status = accessStatus(path);
    if (status != StorageResult::success) {
        return status;
    }
    if (!SDL_RemoveStoragePath(storage_, path)) {
        logBackendFailure("remove");
        return StorageResult::backendFailure;
    }
    return StorageResult::success;
}

StorageResult SdlUserStorage::close() noexcept {
    if (storage_ == nullptr) {
        return StorageResult::success;
    }

    SDL_Storage* const storage = storage_;
    storage_ = nullptr;
    if (!SDL_CloseStorage(storage)) {
        logBackendFailure("close/flush");
        return StorageResult::backendFailure;
    }
    return StorageResult::success;
}

bool SdlUserStorage::isOpen() const noexcept {
    return storage_ != nullptr;
}

StorageResult SdlUserStorage::accessStatus(const char* const path) const noexcept {
    if (storage_ == nullptr) {
        return StorageResult::notOpen;
    }
    if (!hasText(path)) {
        return StorageResult::invalidArgument;
    }
    if (readyState() != StorageReadyState::ready) {
        return StorageResult::notReady;
    }
    return StorageResult::success;
}

} // namespace cirvivor::platform::sdl
