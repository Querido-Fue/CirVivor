#pragma once

#include "settings/settings_model.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace cirvivor::settings {

inline constexpr std::size_t maximum_settings_json_bytes = 64U * 1'024U;

enum class SettingsDecodeError : std::uint8_t {
    none = 0,
    emptyDocument,
    inputTooLarge,
    invalidUtf8,
    expectedTopLevelObject,
    malformedJson,
    trailingContent,
    duplicateKey,
    nestingLimitExceeded,
    memberLimitExceeded,
    stringLimitExceeded,
    typeMismatch,
    invalidValue
};

struct SettingsDecodeResult final {
    SettingsDecodeError error = SettingsDecodeError::none;
    GameSettings settings{};
    bool requiresCanonicalRewrite = false;
    bool migratedLegacy = false;
    std::size_t errorOffset = 0U;

    [[nodiscard]] bool succeeded() const noexcept {
        return error == SettingsDecodeError::none;
    }
};

enum class SettingsEncodeError : std::uint8_t {
    none = 0,
    invalidSettings,
    outputTooLarge,
    allocationFailed
};

struct SettingsEncodeResult final {
    SettingsEncodeError error = SettingsEncodeError::none;
    SettingsValidationResult validation{};
    std::string json;

    [[nodiscard]] bool succeeded() const noexcept {
        return error == SettingsEncodeError::none;
    }
};

/**
 * 성공 시 항상 완전한 GameSettings를 반환합니다. 누락·legacy·범위 보정·알 수 없는
 * 키가 있으면 requiresCanonicalRewrite가 true입니다. 문법·타입 오류는 복구하지 않습니다.
 */
[[nodiscard]] SettingsDecodeResult decodeSettingsJson(
    std::string_view json,
    SettingsDefaults defaults = {}
) noexcept;

/** 유효한 모델을 고정 키 순서와 숫자 형식으로 직렬화합니다. */
[[nodiscard]] SettingsEncodeResult encodeSettingsJson(
    const GameSettings& settings
) noexcept;

} // namespace cirvivor::settings
