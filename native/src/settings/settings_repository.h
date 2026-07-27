#pragma once

#include "settings/settings_codec.h"

#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

namespace cirvivor::settings {

inline constexpr std::string_view settings_file_path = "settings.json";
inline constexpr std::string_view settings_temporary_file_path = "settings.json.tmp";

enum class SettingsStorageStatus : std::uint8_t {
    success = 0,
    notFound,
    invalidArgument,
    readLimitExceeded,
    allocationFailed,
    ioFailure
};

struct SettingsStorageExistsResult final {
    SettingsStorageStatus status = SettingsStorageStatus::ioFailure;
    bool exists = false;

    [[nodiscard]] bool succeeded() const noexcept {
        return status == SettingsStorageStatus::success;
    }
};

struct SettingsStorageReadResult final {
    SettingsStorageStatus status = SettingsStorageStatus::ioFailure;
    std::vector<std::byte> bytes;

    [[nodiscard]] bool succeeded() const noexcept {
        return status == SettingsStorageStatus::success;
    }
};

/**
 * SettingsRepository의 SDL 비의존 저장 경계입니다.
 * renameReplace()는 성공할 때 destination을 한 번에 교체하고, 실패하면 기존
 * destination을 보존해야 합니다.
 */
class ISettingsStorage {
public:
    virtual ~ISettingsStorage() = default;

    [[nodiscard]] virtual SettingsStorageExistsResult exists(
        std::string_view path
    ) const noexcept = 0;
    [[nodiscard]] virtual SettingsStorageReadResult read(
        std::string_view path,
        std::size_t maximumBytes
    ) const noexcept = 0;
    [[nodiscard]] virtual SettingsStorageStatus write(
        std::string_view path,
        std::span<const std::byte> bytes
    ) noexcept = 0;
    [[nodiscard]] virtual SettingsStorageStatus renameReplace(
        std::string_view source,
        std::string_view destination
    ) noexcept = 0;
    [[nodiscard]] virtual SettingsStorageStatus remove(
        std::string_view path
    ) noexcept = 0;
};

enum class SettingsSaveError : std::uint8_t {
    none = 0,
    invalidSettings,
    encodeFailed,
    temporaryWriteFailed,
    replaceFailed
};

struct SettingsSaveResult final {
    SettingsSaveError error = SettingsSaveError::none;
    SettingsStorageStatus storageStatus = SettingsStorageStatus::success;
    SettingsEncodeError encodeError = SettingsEncodeError::none;
    SettingsValidationResult validation{};
    bool cleanupAttempted = false;
    bool cleanupSucceeded = false;

    [[nodiscard]] bool succeeded() const noexcept {
        return error == SettingsSaveError::none;
    }
};

enum class SettingsLoadStatus : std::uint8_t {
    loaded = 0,
    defaultsForMissingFile,
    defaultsRecoveredFromCorruptFile,
    storageFailure
};

struct SettingsLoadResult final {
    SettingsLoadStatus status = SettingsLoadStatus::storageFailure;
    SettingsStorageStatus storageStatus = SettingsStorageStatus::success;
    SettingsDecodeError decodeError = SettingsDecodeError::none;
    bool canonicalRewriteRequired = false;
    SettingsSaveResult canonicalRewrite{};

    [[nodiscard]] bool succeeded() const noexcept {
        return status != SettingsLoadStatus::storageFailure;
    }

    [[nodiscard]] bool canonicalRewriteSucceeded() const noexcept {
        return canonicalRewriteRequired && canonicalRewrite.succeeded();
    }
};

/**
 * settings.json을 읽고 강타입 GameSettings를 소유합니다.
 *
 * - missing file은 defaults로 초기화하며 파일을 즉시 만들지 않습니다.
 * - valid non-canonical/legacy 파일은 읽은 의미 값을 보존한 채 canonical rewrite를
 *   시도합니다.
 * - malformed/oversized 파일은 defaults로 복구한 뒤 canonical rewrite를 시도합니다.
 * - public save는 tmp write + replace가 모두 성공한 뒤에만 current()를 교체합니다.
 */
class SettingsRepository final {
public:
    explicit SettingsRepository(
        ISettingsStorage& storage,
        SettingsDefaults defaults = {}
    ) noexcept;

    [[nodiscard]] const GameSettings& current() const noexcept;
    [[nodiscard]] SettingsLoadResult load() noexcept;
    [[nodiscard]] SettingsSaveResult save(
        const GameSettings& candidate
    ) noexcept;

private:
    [[nodiscard]] SettingsSaveResult persistCanonical(
        const GameSettings& candidate
    ) noexcept;
    void cleanupTemporary(SettingsSaveResult& result) noexcept;

    ISettingsStorage& storage_;
    SettingsDefaults defaults_{};
    GameSettings current_{};
};

} // namespace cirvivor::settings
