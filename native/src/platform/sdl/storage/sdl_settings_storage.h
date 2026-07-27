#pragma once

#include "settings/settings_repository.h"

namespace cirvivor::platform::sdl {

class SdlUserStorage;

/** SettingsRepository의 저장 계약을 열린 SDL user storage에 연결합니다. */
class SdlSettingsStorage final : public settings::ISettingsStorage {
public:
    explicit SdlSettingsStorage(SdlUserStorage& storage) noexcept;

    [[nodiscard]] settings::SettingsStorageExistsResult exists(
        std::string_view path
    ) const noexcept override;
    [[nodiscard]] settings::SettingsStorageReadResult read(
        std::string_view path,
        std::size_t maximumBytes
    ) const noexcept override;
    [[nodiscard]] settings::SettingsStorageStatus write(
        std::string_view path,
        std::span<const std::byte> bytes
    ) noexcept override;
    [[nodiscard]] settings::SettingsStorageStatus renameReplace(
        std::string_view source,
        std::string_view destination
    ) noexcept override;
    [[nodiscard]] settings::SettingsStorageStatus remove(
        std::string_view path
    ) noexcept override;

private:
    SdlUserStorage& storage_;
};

} // namespace cirvivor::platform::sdl
