#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>
#include <type_traits>

namespace cirvivor::settings {

inline constexpr std::int32_t minimum_window_width = 1'280;
inline constexpr std::int32_t minimum_window_height = 720;
inline constexpr std::uint8_t minimum_render_scale_percent = 75U;
inline constexpr std::uint8_t maximum_render_scale_percent = 100U;
inline constexpr std::uint16_t minimum_ui_scale_percent = 75U;
inline constexpr std::uint16_t maximum_ui_scale_percent = 150U;
inline constexpr std::uint8_t maximum_tooltip_delay_tenths = 20U;
inline constexpr std::uint8_t maximum_volume_percent = 100U;
inline constexpr std::size_t maximum_input_bindings_per_action = 4U;
inline constexpr std::size_t maximum_keyboard_code_bytes = 64U;

enum class Theme : std::uint8_t {
    light = 0,
    dark = 1
};

enum class Language : std::uint8_t {
    korean = 0,
    english = 1,
    userLanguage = 2
};

enum class WindowMode : std::uint8_t {
    fullscreen = 0,
    windowed = 1
};

enum class InputAction : std::uint8_t {
    moveUp = 0,
    moveDown,
    moveLeft,
    moveRight,
    primaryAction,
    pause,
    reload,
    debugPause,
    debugStep,
    count
};

inline constexpr std::size_t input_action_count =
    static_cast<std::size_t>(InputAction::count);

struct KeyboardCode final {
    std::array<char, maximum_keyboard_code_bytes> bytes{};
    std::uint8_t size = 0U;

    [[nodiscard]] constexpr std::string_view view() const noexcept {
        const std::size_t boundedSize = size <= bytes.size()
            ? static_cast<std::size_t>(size)
            : bytes.size();
        return {bytes.data(), boundedSize};
    }

    [[nodiscard]] constexpr bool operator==(
        const KeyboardCode& other
    ) const noexcept {
        if (size != other.size || size > maximum_keyboard_code_bytes) {
            return false;
        }
        for (std::size_t index = 0U; index < size; ++index) {
            if (bytes[index] != other.bytes[index]) {
                return false;
            }
        }
        return true;
    }
};

struct InputBindingOverride final {
    std::array<KeyboardCode, maximum_input_bindings_per_action> codes{};
    std::uint8_t count = 0U;
    bool present = false;

    [[nodiscard]] constexpr bool operator==(
        const InputBindingOverride& other
    ) const noexcept {
        if (present != other.present
            || count != other.count
            || count > maximum_input_bindings_per_action) {
            return false;
        }
        for (std::size_t index = 0U; index < count; ++index) {
            if (codes[index] != other.codes[index]) {
                return false;
            }
        }
        return true;
    }
};

struct InputBindings final {
    std::array<InputBindingOverride, input_action_count> actions{};

    [[nodiscard]] InputBindingOverride* tryForAction(InputAction action) noexcept;
    [[nodiscard]] const InputBindingOverride* tryForAction(
        InputAction action
    ) const noexcept;

    constexpr bool operator==(const InputBindings&) const noexcept = default;
};

struct SettingsDefaults final {
    Language language = Language::english;

    constexpr bool operator==(const SettingsDefaults&) const noexcept = default;
};

struct GameSettings final {
    Theme theme = Theme::dark;
    bool disableTransparency = false;
    Language language = Language::english;
    WindowMode windowMode = WindowMode::fullscreen;
    bool widescreenSupport = true;
    std::int32_t width = minimum_window_width;
    std::int32_t height = minimum_window_height;
    std::uint8_t renderScalePercent = maximum_render_scale_percent;
    std::uint16_t uiScalePercent = 100U;
    std::uint8_t tooltipDelayTenths = 3U;
    InputBindings inputBindings{};
    std::uint8_t bgmVolumePercent = 25U;
    std::uint8_t sfxVolumePercent = 40U;
    bool screenModeChanged = false;
    bool debugMode = false;

    constexpr bool operator==(const GameSettings&) const noexcept = default;
};

enum class SettingsValidationError : std::uint8_t {
    none = 0,
    invalidTheme,
    invalidLanguage,
    invalidWindowMode,
    invalidWindowWidth,
    invalidWindowHeight,
    invalidRenderScale,
    invalidUiScale,
    invalidTooltipDelay,
    invalidInputBindingCount,
    invalidKeyboardCode,
    duplicateKeyboardCode,
    invalidBgmVolume,
    invalidSfxVolume
};

struct SettingsValidationResult final {
    SettingsValidationError error = SettingsValidationError::none;
    InputAction action = InputAction::moveUp;
    std::uint8_t bindingIndex = 0U;

    [[nodiscard]] bool succeeded() const noexcept {
        return error == SettingsValidationError::none;
    }

    constexpr bool operator==(const SettingsValidationResult&) const noexcept = default;
};

[[nodiscard]] GameSettings makeDefaultSettings(
    SettingsDefaults defaults = {}
) noexcept;

[[nodiscard]] std::string_view themeName(Theme value) noexcept;
[[nodiscard]] std::string_view languageName(Language value) noexcept;
[[nodiscard]] std::string_view windowModeName(WindowMode value) noexcept;
[[nodiscard]] std::string_view inputActionName(InputAction value) noexcept;

[[nodiscard]] bool parseTheme(std::string_view value, Theme& out) noexcept;
[[nodiscard]] bool parseLanguage(std::string_view value, Language& out) noexcept;
[[nodiscard]] bool parseWindowMode(std::string_view value, WindowMode& out) noexcept;
[[nodiscard]] bool parseInputAction(std::string_view value, InputAction& out) noexcept;

[[nodiscard]] bool isValidKeyboardCode(std::string_view value) noexcept;
[[nodiscard]] bool tryMakeKeyboardCode(
    std::string_view value,
    KeyboardCode& out
) noexcept;

[[nodiscard]] SettingsValidationResult validateSettings(
    const GameSettings& settings
) noexcept;

/** 실패 시 destination을 변경하지 않습니다. */
[[nodiscard]] SettingsValidationResult tryReplaceSettings(
    GameSettings& destination,
    const GameSettings& candidate
) noexcept;

static_assert(input_action_count == 9U);
static_assert(maximum_keyboard_code_bytes <= 255U);
static_assert(maximum_input_bindings_per_action <= 255U);
static_assert(std::is_trivially_copyable_v<KeyboardCode>);
static_assert(std::is_trivially_copyable_v<InputBindings>);
static_assert(std::is_trivially_copyable_v<GameSettings>);
static_assert(std::is_standard_layout_v<GameSettings>);

} // namespace cirvivor::settings
