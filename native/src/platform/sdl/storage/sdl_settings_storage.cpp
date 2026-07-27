#include "platform/sdl/storage/sdl_settings_storage.h"

#include "platform/sdl/storage/sdl_user_storage.h"

#include <algorithm>
#include <array>
#include <limits>
#include <utility>

namespace cirvivor::platform::sdl {
namespace {

constexpr std::size_t maximum_storage_path_bytes = 1'024U;

using settings::SettingsStorageStatus;

[[nodiscard]] SettingsStorageStatus mapStatus(
    const StorageResult status
) noexcept {
    switch (status) {
    case StorageResult::success:
        return SettingsStorageStatus::success;
    case StorageResult::invalidArgument:
        return SettingsStorageStatus::invalidArgument;
    case StorageResult::readLimitExceeded:
        return SettingsStorageStatus::readLimitExceeded;
    case StorageResult::addressSpaceExceeded:
    case StorageResult::allocationFailed:
        return SettingsStorageStatus::allocationFailed;
    case StorageResult::alreadyOpen:
    case StorageResult::notOpen:
    case StorageResult::notReady:
    case StorageResult::backendFailure:
        return SettingsStorageStatus::ioFailure;
    }
    return SettingsStorageStatus::ioFailure;
}

[[nodiscard]] bool copyPath(
    const std::string_view path,
    std::array<char, maximum_storage_path_bytes + 1U>& destination
) noexcept {
    if (path.empty()
        || path.size() > maximum_storage_path_bytes
        || std::find(path.begin(), path.end(), '\0') != path.end()) {
        return false;
    }
    std::copy(path.begin(), path.end(), destination.begin());
    destination[path.size()] = '\0';
    return true;
}

} // namespace

SdlSettingsStorage::SdlSettingsStorage(SdlUserStorage& storage) noexcept
    : storage_(storage) {}

settings::SettingsStorageExistsResult SdlSettingsStorage::exists(
    const std::string_view path
) const noexcept {
    settings::SettingsStorageExistsResult result;
    std::array<char, maximum_storage_path_bytes + 1U> nativePath{};
    if (!copyPath(path, nativePath)) {
        result.status = SettingsStorageStatus::invalidArgument;
        return result;
    }

    const StorageExistsResult existsResult = storage_.exists(nativePath.data());
    result.status = mapStatus(existsResult.status);
    result.exists = existsResult.exists;
    return result;
}

settings::SettingsStorageReadResult SdlSettingsStorage::read(
    const std::string_view path,
    const std::size_t maximumBytes
) const noexcept {
    settings::SettingsStorageReadResult result;
    std::array<char, maximum_storage_path_bytes + 1U> nativePath{};
    if (!copyPath(path, nativePath)) {
        result.status = SettingsStorageStatus::invalidArgument;
        return result;
    }
    if constexpr (std::numeric_limits<std::size_t>::max()
        > std::numeric_limits<std::uint64_t>::max()) {
        if (maximumBytes > static_cast<std::size_t>(
                std::numeric_limits<std::uint64_t>::max()
            )) {
            result.status = SettingsStorageStatus::readLimitExceeded;
            return result;
        }
    }

    const StorageExistsResult existence = storage_.exists(nativePath.data());
    if (existence.status != StorageResult::success) {
        result.status = mapStatus(existence.status);
        return result;
    }
    if (!existence.exists) {
        result.status = SettingsStorageStatus::notFound;
        return result;
    }

    StorageReadResult readResult = storage_.read(
        nativePath.data(),
        static_cast<std::uint64_t>(maximumBytes)
    );
    result.status = mapStatus(readResult.status);
    result.bytes = std::move(readResult.bytes);
    return result;
}

SettingsStorageStatus SdlSettingsStorage::write(
    const std::string_view path,
    const std::span<const std::byte> bytes
) noexcept {
    std::array<char, maximum_storage_path_bytes + 1U> nativePath{};
    if (!copyPath(path, nativePath)) {
        return SettingsStorageStatus::invalidArgument;
    }
    return mapStatus(storage_.write(nativePath.data(), bytes));
}

SettingsStorageStatus SdlSettingsStorage::renameReplace(
    const std::string_view source,
    const std::string_view destination
) noexcept {
    std::array<char, maximum_storage_path_bytes + 1U> nativeSource{};
    std::array<char, maximum_storage_path_bytes + 1U> nativeDestination{};
    if (!copyPath(source, nativeSource)
        || !copyPath(destination, nativeDestination)) {
        return SettingsStorageStatus::invalidArgument;
    }
    const StorageExistsResult existence = storage_.exists(nativeSource.data());
    if (existence.status != StorageResult::success) {
        return mapStatus(existence.status);
    }
    if (!existence.exists) {
        return SettingsStorageStatus::notFound;
    }
    return mapStatus(storage_.renameReplace(
        nativeSource.data(),
        nativeDestination.data()
    ));
}

SettingsStorageStatus SdlSettingsStorage::remove(
    const std::string_view path
) noexcept {
    std::array<char, maximum_storage_path_bytes + 1U> nativePath{};
    if (!copyPath(path, nativePath)) {
        return SettingsStorageStatus::invalidArgument;
    }
    const StorageExistsResult existence = storage_.exists(nativePath.data());
    if (existence.status != StorageResult::success) {
        return mapStatus(existence.status);
    }
    if (!existence.exists) {
        return SettingsStorageStatus::notFound;
    }
    return mapStatus(storage_.remove(nativePath.data()));
}

} // namespace cirvivor::platform::sdl
