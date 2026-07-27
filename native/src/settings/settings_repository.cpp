#include "settings/settings_repository.h"

namespace cirvivor::settings {
namespace {

[[nodiscard]] std::span<const std::byte> bytesOf(
    const std::string_view text
) noexcept {
    return {
        reinterpret_cast<const std::byte*>(text.data()),
        text.size()
    };
}

[[nodiscard]] std::string_view textOf(
    const std::span<const std::byte> bytes
) noexcept {
    static constexpr char empty = '\0';
    const char* const data = bytes.empty()
        ? &empty
        : reinterpret_cast<const char*>(bytes.data());
    return {data, bytes.size()};
}

} // namespace

SettingsRepository::SettingsRepository(
    ISettingsStorage& storage,
    const SettingsDefaults defaults
) noexcept
    : storage_(storage),
      defaults_(defaults),
      current_(makeDefaultSettings(defaults)) {}

const GameSettings& SettingsRepository::current() const noexcept {
    return current_;
}

SettingsLoadResult SettingsRepository::load() noexcept {
    SettingsLoadResult result;
    const SettingsStorageExistsResult existence = storage_.exists(settings_file_path);
    if (!existence.succeeded()) {
        result.storageStatus = existence.status;
        return result;
    }
    if (!existence.exists) {
        current_ = makeDefaultSettings(defaults_);
        result.status = SettingsLoadStatus::defaultsForMissingFile;
        return result;
    }

    SettingsStorageReadResult read = storage_.read(
        settings_file_path,
        maximum_settings_json_bytes
    );
    if (read.status == SettingsStorageStatus::notFound) {
        current_ = makeDefaultSettings(defaults_);
        result.status = SettingsLoadStatus::defaultsForMissingFile;
        result.storageStatus = SettingsStorageStatus::notFound;
        return result;
    }

    bool corrupt = false;
    SettingsDecodeResult decoded;
    if (read.status == SettingsStorageStatus::readLimitExceeded
        || (read.succeeded() && read.bytes.size() > maximum_settings_json_bytes)) {
        corrupt = true;
        decoded.error = SettingsDecodeError::inputTooLarge;
    } else if (!read.succeeded()) {
        result.storageStatus = read.status;
        return result;
    } else {
        decoded = decodeSettingsJson(textOf(read.bytes), defaults_);
        corrupt = !decoded.succeeded();
    }

    if (corrupt) {
        current_ = makeDefaultSettings(defaults_);
        result.status = SettingsLoadStatus::defaultsRecoveredFromCorruptFile;
        result.decodeError = decoded.error;
        result.canonicalRewriteRequired = true;
        result.canonicalRewrite = persistCanonical(current_);
        return result;
    }

    current_ = decoded.settings;
    result.status = SettingsLoadStatus::loaded;
    result.decodeError = SettingsDecodeError::none;
    result.canonicalRewriteRequired = decoded.requiresCanonicalRewrite;
    if (result.canonicalRewriteRequired) {
        result.canonicalRewrite = persistCanonical(current_);
    }
    return result;
}

SettingsSaveResult SettingsRepository::save(
    const GameSettings& candidate
) noexcept {
    SettingsSaveResult result = persistCanonical(candidate);
    if (result.succeeded()) {
        current_ = candidate;
    }
    return result;
}

SettingsSaveResult SettingsRepository::persistCanonical(
    const GameSettings& candidate
) noexcept {
    SettingsSaveResult result;
    const SettingsEncodeResult encoded = encodeSettingsJson(candidate);
    result.encodeError = encoded.error;
    result.validation = encoded.validation;
    if (!encoded.succeeded()) {
        result.error = encoded.error == SettingsEncodeError::invalidSettings
            ? SettingsSaveError::invalidSettings
            : SettingsSaveError::encodeFailed;
        return result;
    }

    const SettingsStorageStatus writeStatus = storage_.write(
        settings_temporary_file_path,
        bytesOf(encoded.json)
    );
    if (writeStatus != SettingsStorageStatus::success) {
        result.error = SettingsSaveError::temporaryWriteFailed;
        result.storageStatus = writeStatus;
        cleanupTemporary(result);
        return result;
    }

    const SettingsStorageStatus replaceStatus = storage_.renameReplace(
        settings_temporary_file_path,
        settings_file_path
    );
    if (replaceStatus != SettingsStorageStatus::success) {
        result.error = SettingsSaveError::replaceFailed;
        result.storageStatus = replaceStatus;
        cleanupTemporary(result);
        return result;
    }
    return result;
}

void SettingsRepository::cleanupTemporary(SettingsSaveResult& result) noexcept {
    result.cleanupAttempted = true;
    const SettingsStorageStatus cleanupStatus = storage_.remove(
        settings_temporary_file_path
    );
    result.cleanupSucceeded = cleanupStatus == SettingsStorageStatus::success
        || cleanupStatus == SettingsStorageStatus::notFound;
}

} // namespace cirvivor::settings
