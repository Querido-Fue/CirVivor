#include "settings/settings_model.h"

#include <algorithm>

namespace cirvivor::settings {
namespace {

[[nodiscard]] bool asciiLetter(const char value) noexcept {
    return (value >= 'A' && value <= 'Z')
        || (value >= 'a' && value <= 'z');
}

[[nodiscard]] bool asciiAlphaNumeric(const char value) noexcept {
    return asciiLetter(value) || (value >= '0' && value <= '9');
}

} // namespace

InputBindingOverride* InputBindings::tryForAction(
    const InputAction action
) noexcept {
    const std::size_t index = static_cast<std::size_t>(action);
    return index < actions.size() ? &actions[index] : nullptr;
}

const InputBindingOverride* InputBindings::tryForAction(
    const InputAction action
) const noexcept {
    const std::size_t index = static_cast<std::size_t>(action);
    return index < actions.size() ? &actions[index] : nullptr;
}

GameSettings makeDefaultSettings(const SettingsDefaults defaults) noexcept {
    GameSettings result;
    switch (defaults.language) {
    case Language::korean:
    case Language::english:
    case Language::userLanguage:
        result.language = defaults.language;
        break;
    default:
        result.language = Language::english;
        break;
    }
    return result;
}

std::string_view themeName(const Theme value) noexcept {
    switch (value) {
    case Theme::light:
        return "light";
    case Theme::dark:
        return "dark";
    }
    return {};
}

std::string_view languageName(const Language value) noexcept {
    switch (value) {
    case Language::korean:
        return "korean";
    case Language::english:
        return "english";
    case Language::userLanguage:
        return "userLanguage";
    }
    return {};
}

std::string_view windowModeName(const WindowMode value) noexcept {
    switch (value) {
    case WindowMode::fullscreen:
        return "fullscreen";
    case WindowMode::windowed:
        return "windowed";
    }
    return {};
}

std::string_view inputActionName(const InputAction value) noexcept {
    switch (value) {
    case InputAction::moveUp:
        return "moveUp";
    case InputAction::moveDown:
        return "moveDown";
    case InputAction::moveLeft:
        return "moveLeft";
    case InputAction::moveRight:
        return "moveRight";
    case InputAction::primaryAction:
        return "primaryAction";
    case InputAction::pause:
        return "pause";
    case InputAction::reload:
        return "reload";
    case InputAction::debugPause:
        return "debugPause";
    case InputAction::debugStep:
        return "debugStep";
    case InputAction::count:
        break;
    }
    return {};
}

bool parseTheme(const std::string_view value, Theme& out) noexcept {
    if (value == "light") {
        out = Theme::light;
        return true;
    }
    if (value == "dark") {
        out = Theme::dark;
        return true;
    }
    return false;
}

bool parseLanguage(const std::string_view value, Language& out) noexcept {
    if (value == "korean") {
        out = Language::korean;
        return true;
    }
    if (value == "english") {
        out = Language::english;
        return true;
    }
    if (value == "userLanguage") {
        out = Language::userLanguage;
        return true;
    }
    return false;
}

bool parseWindowMode(const std::string_view value, WindowMode& out) noexcept {
    if (value == "fullscreen") {
        out = WindowMode::fullscreen;
        return true;
    }
    if (value == "windowed") {
        out = WindowMode::windowed;
        return true;
    }
    return false;
}

bool parseInputAction(const std::string_view value, InputAction& out) noexcept {
    for (std::size_t index = 0U; index < input_action_count; ++index) {
        const InputAction candidate = static_cast<InputAction>(index);
        if (inputActionName(candidate) == value) {
            out = candidate;
            return true;
        }
    }
    return false;
}

bool isValidKeyboardCode(const std::string_view value) noexcept {
    if (value.empty() || value.size() > maximum_keyboard_code_bytes) {
        return false;
    }
    if (!asciiLetter(value.front())) {
        return false;
    }
    for (const char byte : value.substr(1U)) {
        if (!asciiAlphaNumeric(byte)) {
            return false;
        }
    }
    return true;
}

bool tryMakeKeyboardCode(
    const std::string_view value,
    KeyboardCode& out
) noexcept {
    if (!isValidKeyboardCode(value)) {
        return false;
    }
    KeyboardCode candidate;
    std::copy(value.begin(), value.end(), candidate.bytes.begin());
    candidate.size = static_cast<std::uint8_t>(value.size());
    out = candidate;
    return true;
}

SettingsValidationResult validateSettings(const GameSettings& settings) noexcept {
    if (themeName(settings.theme).empty()) {
        return {SettingsValidationError::invalidTheme};
    }
    if (languageName(settings.language).empty()) {
        return {SettingsValidationError::invalidLanguage};
    }
    if (windowModeName(settings.windowMode).empty()) {
        return {SettingsValidationError::invalidWindowMode};
    }
    if (settings.width < minimum_window_width) {
        return {SettingsValidationError::invalidWindowWidth};
    }
    if (settings.height < minimum_window_height) {
        return {SettingsValidationError::invalidWindowHeight};
    }
    if (settings.renderScalePercent < minimum_render_scale_percent
        || settings.renderScalePercent > maximum_render_scale_percent) {
        return {SettingsValidationError::invalidRenderScale};
    }
    if (settings.uiScalePercent < minimum_ui_scale_percent
        || settings.uiScalePercent > maximum_ui_scale_percent) {
        return {SettingsValidationError::invalidUiScale};
    }
    if (settings.tooltipDelayTenths > maximum_tooltip_delay_tenths) {
        return {SettingsValidationError::invalidTooltipDelay};
    }
    for (std::size_t actionIndexValue = 0U;
         actionIndexValue < input_action_count;
         ++actionIndexValue) {
        const InputAction action = static_cast<InputAction>(actionIndexValue);
        const InputBindingOverride& binding = settings.inputBindings.actions[actionIndexValue];
        if (binding.count > maximum_input_bindings_per_action) {
            return {
                SettingsValidationError::invalidInputBindingCount,
                action
            };
        }
        if (!binding.present && binding.count != 0U) {
            return {
                SettingsValidationError::invalidInputBindingCount,
                action
            };
        }
        for (std::size_t index = 0U; index < binding.count; ++index) {
            if (binding.codes[index].size > maximum_keyboard_code_bytes
                || !isValidKeyboardCode(binding.codes[index].view())) {
                return {
                    SettingsValidationError::invalidKeyboardCode,
                    action,
                    static_cast<std::uint8_t>(index)
                };
            }
            for (std::size_t other = 0U; other < index; ++other) {
                if (binding.codes[index].view() == binding.codes[other].view()) {
                    return {
                        SettingsValidationError::duplicateKeyboardCode,
                        action,
                        static_cast<std::uint8_t>(index)
                    };
                }
            }
        }
    }
    if (settings.bgmVolumePercent > maximum_volume_percent) {
        return {SettingsValidationError::invalidBgmVolume};
    }
    if (settings.sfxVolumePercent > maximum_volume_percent) {
        return {SettingsValidationError::invalidSfxVolume};
    }
    return {};
}

SettingsValidationResult tryReplaceSettings(
    GameSettings& destination,
    const GameSettings& candidate
) noexcept {
    const SettingsValidationResult validation = validateSettings(candidate);
    if (!validation.succeeded()) {
        return validation;
    }
    destination = candidate;
    return {};
}

} // namespace cirvivor::settings
