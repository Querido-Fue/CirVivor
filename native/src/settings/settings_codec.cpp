#include "settings/settings_codec.h"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <new>
#include <stdexcept>
#include <string_view>
#include <system_error>

namespace cirvivor::settings {
namespace {

constexpr std::size_t maximum_json_nesting = 8U;
constexpr std::size_t maximum_json_object_members = 256U;
constexpr std::size_t maximum_json_array_elements = 256U;
constexpr std::size_t maximum_json_key_bytes = 128U;
constexpr std::size_t maximum_decoded_setting_string_bytes = 256U;
constexpr std::size_t setting_field_count = 15U;

template<std::size_t Capacity>
struct FixedString final {
    std::array<char, Capacity> bytes{};
    std::size_t size = 0U;

    [[nodiscard]] bool append(const char value) noexcept {
        if (size >= Capacity) {
            return false;
        }
        bytes[size++] = value;
        return true;
    }

    [[nodiscard]] std::string_view view() const noexcept {
        return {bytes.data(), size};
    }
};

struct ObjectKeyFrame final {
    std::array<FixedString<maximum_json_key_bytes>, maximum_json_object_members> keys{};
    std::size_t count = 0U;
};

struct NumberToken final {
    std::string_view text;
    bool integerSyntax = true;
};

enum class SettingField : std::uint8_t {
    theme = 0,
    disableTransparency,
    language,
    windowMode,
    widescreenSupport,
    width,
    height,
    renderScale,
    uiScale,
    tooltipDelaySeconds,
    inputBindings,
    bgmVolume,
    sfxVolume,
    screenModeChanged,
    debugMode
};

[[nodiscard]] constexpr std::size_t fieldIndex(const SettingField field) noexcept {
    return static_cast<std::size_t>(field);
}

[[nodiscard]] bool findSettingField(
    const std::string_view name,
    SettingField& out
) noexcept {
    constexpr std::array names{
        std::string_view{"theme"},
        std::string_view{"disableTransparency"},
        std::string_view{"language"},
        std::string_view{"windowMode"},
        std::string_view{"widescreenSupport"},
        std::string_view{"width"},
        std::string_view{"height"},
        std::string_view{"renderScale"},
        std::string_view{"uiScale"},
        std::string_view{"tooltipDelaySeconds"},
        std::string_view{"inputBindings"},
        std::string_view{"bgmVolume"},
        std::string_view{"sfxVolume"},
        std::string_view{"screenModeChanged"},
        std::string_view{"debugMode"}
    };
    for (std::size_t index = 0U; index < names.size(); ++index) {
        if (names[index] == name) {
            out = static_cast<SettingField>(index);
            return true;
        }
    }
    return false;
}

[[nodiscard]] bool legacyRemovedKey(const std::string_view name) noexcept {
    return name == "physicsAccuracy"
        || name == "physicsFps"
        || name == "simulationWorkerAuthorityMode"
        || name == "simulationWorkerShadowMode"
        || name == "simulationWorkerPresentationMode";
}

[[nodiscard]] bool validUtf8(const std::string_view text) noexcept {
    const auto* const bytes = reinterpret_cast<const unsigned char*>(text.data());
    std::size_t index = 0U;
    while (index < text.size()) {
        const unsigned char first = bytes[index];
        if (first <= 0x7FU) {
            ++index;
            continue;
        }
        if (first >= 0xC2U && first <= 0xDFU) {
            if (index + 1U >= text.size()
                || bytes[index + 1U] < 0x80U
                || bytes[index + 1U] > 0xBFU) {
                return false;
            }
            index += 2U;
            continue;
        }
        if (first >= 0xE0U && first <= 0xEFU) {
            if (index + 2U >= text.size()) {
                return false;
            }
            const unsigned char second = bytes[index + 1U];
            const unsigned char third = bytes[index + 2U];
            const bool secondValid = first == 0xE0U
                ? second >= 0xA0U && second <= 0xBFU
                : (first == 0xEDU
                    ? second >= 0x80U && second <= 0x9FU
                    : second >= 0x80U && second <= 0xBFU);
            if (!secondValid || third < 0x80U || third > 0xBFU) {
                return false;
            }
            index += 3U;
            continue;
        }
        if (first >= 0xF0U && first <= 0xF4U) {
            if (index + 3U >= text.size()) {
                return false;
            }
            const unsigned char second = bytes[index + 1U];
            const unsigned char third = bytes[index + 2U];
            const unsigned char fourth = bytes[index + 3U];
            const bool secondValid = first == 0xF0U
                ? second >= 0x90U && second <= 0xBFU
                : (first == 0xF4U
                    ? second >= 0x80U && second <= 0x8FU
                    : second >= 0x80U && second <= 0xBFU);
            if (!secondValid
                || third < 0x80U || third > 0xBFU
                || fourth < 0x80U || fourth > 0xBFU) {
                return false;
            }
            index += 4U;
            continue;
        }
        return false;
    }
    return true;
}

class JsonReader final {
public:
    JsonReader(
        const std::string_view input,
        const SettingsDefaults defaults
    ) noexcept
        : input_(input),
          defaults_(defaults) {
        result_.settings = makeDefaultSettings(defaults);
    }

    [[nodiscard]] SettingsDecodeResult parse() noexcept {
        skipWhitespace();
        if (atEnd()) {
            static_cast<void>(fail(SettingsDecodeError::emptyDocument));
            return result_;
        }
        if (peek() != '{') {
            static_cast<void>(fail(SettingsDecodeError::expectedTopLevelObject));
            return result_;
        }
        if (!parseTopLevelObject()) {
            return result_;
        }
        skipWhitespace();
        if (!atEnd()) {
            static_cast<void>(fail(SettingsDecodeError::trailingContent));
            return result_;
        }

        if (!seen_[fieldIndex(SettingField::theme)] && darkModeSeen_) {
            result_.settings.theme = darkModeValue_ ? Theme::dark : Theme::light;
            result_.migratedLegacy = true;
            result_.requiresCanonicalRewrite = true;
        }
        for (const bool seen : seen_) {
            if (!seen) {
                result_.requiresCanonicalRewrite = true;
            }
        }
        return result_;
    }

private:
    [[nodiscard]] bool parseTopLevelObject() noexcept {
        if (!consume('{')) {
            return fail(SettingsDecodeError::malformedJson);
        }
        resetObjectFrame(0U);
        skipWhitespace();
        if (consume('}')) {
            return true;
        }

        while (!failed()) {
            FixedString<maximum_json_key_bytes> key;
            if (!parseString(key)) {
                return false;
            }
            if (!recordObjectKey(0U, key)) {
                return false;
            }
            skipWhitespace();
            if (!consume(':')) {
                return fail(SettingsDecodeError::malformedJson);
            }
            skipWhitespace();
            if (!parseTopLevelValue(key.view())) {
                return false;
            }
            skipWhitespace();
            if (consume('}')) {
                return true;
            }
            if (!consume(',')) {
                return fail(SettingsDecodeError::malformedJson);
            }
            skipWhitespace();
            if (peek() == '}') {
                return fail(SettingsDecodeError::malformedJson);
            }
        }
        return false;
    }

    [[nodiscard]] bool parseTopLevelValue(const std::string_view key) noexcept {
        SettingField field = SettingField::theme;
        if (!findSettingField(key, field)) {
            if (key == "darkMode") {
                bool value = false;
                if (!parseRequiredBoolean(value)) {
                    return false;
                }
                darkModeSeen_ = true;
                darkModeValue_ = value;
                result_.migratedLegacy = true;
                result_.requiresCanonicalRewrite = true;
                return true;
            }
            if (!skipValue(1U)) {
                return false;
            }
            result_.requiresCanonicalRewrite = true;
            if (legacyRemovedKey(key)) {
                result_.migratedLegacy = true;
            }
            return true;
        }

        seen_[fieldIndex(field)] = true;
        switch (field) {
        case SettingField::theme:
            return parseThemeValue();
        case SettingField::disableTransparency:
            return parseRequiredBoolean(result_.settings.disableTransparency);
        case SettingField::language:
            return parseLanguageValue();
        case SettingField::windowMode:
            return parseWindowModeValue();
        case SettingField::widescreenSupport:
            return parseRequiredBoolean(result_.settings.widescreenSupport);
        case SettingField::width:
            return parseBoundedInteger(
                minimum_window_width,
                std::numeric_limits<std::int32_t>::max(),
                result_.settings.width
            );
        case SettingField::height:
            return parseBoundedInteger(
                minimum_window_height,
                std::numeric_limits<std::int32_t>::max(),
                result_.settings.height
            );
        case SettingField::renderScale:
            return parseBoundedInteger(
                minimum_render_scale_percent,
                maximum_render_scale_percent,
                result_.settings.renderScalePercent
            );
        case SettingField::uiScale:
            return parseBoundedInteger(
                minimum_ui_scale_percent,
                maximum_ui_scale_percent,
                result_.settings.uiScalePercent
            );
        case SettingField::tooltipDelaySeconds:
            return parseTooltipDelay();
        case SettingField::inputBindings:
            return parseInputBindings();
        case SettingField::bgmVolume:
            return parseBoundedInteger(
                std::uint8_t{0U},
                maximum_volume_percent,
                result_.settings.bgmVolumePercent
            );
        case SettingField::sfxVolume:
            return parseBoundedInteger(
                std::uint8_t{0U},
                maximum_volume_percent,
                result_.settings.sfxVolumePercent
            );
        case SettingField::screenModeChanged:
            return parseRequiredBoolean(result_.settings.screenModeChanged);
        case SettingField::debugMode:
            return parseRequiredBoolean(result_.settings.debugMode);
        }
        return fail(SettingsDecodeError::invalidValue);
    }

    [[nodiscard]] bool parseThemeValue() noexcept {
        FixedString<maximum_decoded_setting_string_bytes> value;
        if (!parseRequiredString(value)) {
            return false;
        }
        Theme theme = Theme::dark;
        if (!parseTheme(value.view(), theme)) {
            result_.settings.theme = Theme::dark;
            result_.requiresCanonicalRewrite = true;
            return true;
        }
        result_.settings.theme = theme;
        return true;
    }

    [[nodiscard]] bool parseLanguageValue() noexcept {
        FixedString<maximum_decoded_setting_string_bytes> value;
        if (!parseRequiredString(value)) {
            return false;
        }
        Language language = defaults_.language;
        if (!parseLanguage(value.view(), language)) {
            // JS used English as its static validator fallback. The host/OS
            // default applies only when the language member is absent.
            result_.settings.language = Language::english;
            result_.requiresCanonicalRewrite = true;
            return true;
        }
        result_.settings.language = language;
        return true;
    }

    [[nodiscard]] bool parseWindowModeValue() noexcept {
        FixedString<maximum_decoded_setting_string_bytes> value;
        if (!parseRequiredString(value)) {
            return false;
        }
        if (value.view() == "borderless") {
            result_.settings.windowMode = WindowMode::fullscreen;
            result_.migratedLegacy = true;
            result_.requiresCanonicalRewrite = true;
            return true;
        }
        WindowMode mode = WindowMode::fullscreen;
        if (!parseWindowMode(value.view(), mode)) {
            // JS legacy migration normalized an existing invalid value to windowed.
            result_.settings.windowMode = WindowMode::windowed;
            result_.migratedLegacy = true;
            result_.requiresCanonicalRewrite = true;
            return true;
        }
        result_.settings.windowMode = mode;
        return true;
    }

    template<typename Integer>
    [[nodiscard]] bool parseBoundedInteger(
        const Integer minimum,
        const Integer maximum,
        Integer& out
    ) noexcept {
        NumberToken token;
        double value = 0.0;
        if (!parseRequiredNumber(token, value)) {
            return false;
        }
        if (std::trunc(value) != value) {
            return fail(SettingsDecodeError::invalidValue);
        }
        const double lower = static_cast<double>(minimum);
        const double upper = static_cast<double>(maximum);
        const double bounded = std::clamp(value, lower, upper);
        out = static_cast<Integer>(bounded);
        if (bounded != value || !token.integerSyntax || token.text == "-0") {
            result_.requiresCanonicalRewrite = true;
        }
        return true;
    }

    [[nodiscard]] bool parseTooltipDelay() noexcept {
        NumberToken token;
        double value = 0.0;
        if (!parseRequiredNumber(token, value)) {
            return false;
        }
        const double bounded = std::clamp(value, 0.0, 2.0);
        const double scaled = std::floor((bounded * 10.0) + 0.5);
        const auto tenths = static_cast<std::uint8_t>(scaled);
        result_.settings.tooltipDelayTenths = tenths;

        std::array<char, 8> canonical{};
        const unsigned int whole = static_cast<unsigned int>(tenths / 10U);
        const unsigned int fraction = static_cast<unsigned int>(tenths % 10U);
        canonical[0] = static_cast<char>('0' + whole);
        canonical[1] = '.';
        canonical[2] = static_cast<char>('0' + fraction);
        const std::string_view canonicalView(canonical.data(), 3U);
        if (bounded != value || token.text != canonicalView) {
            result_.requiresCanonicalRewrite = true;
        }
        return true;
    }

    [[nodiscard]] bool parseInputBindings() noexcept {
        if (peek() != '{') {
            return fail(SettingsDecodeError::typeMismatch);
        }
        static_cast<void>(consume('{'));
        resetObjectFrame(1U);
        skipWhitespace();
        if (consume('}')) {
            return true;
        }

        while (!failed()) {
            FixedString<maximum_json_key_bytes> key;
            if (!parseString(key) || !recordObjectKey(1U, key)) {
                return false;
            }
            skipWhitespace();
            if (!consume(':')) {
                return fail(SettingsDecodeError::malformedJson);
            }
            skipWhitespace();

            InputAction action = InputAction::moveUp;
            if (!parseInputAction(key.view(), action)) {
                if (!skipValue(2U)) {
                    return false;
                }
                result_.requiresCanonicalRewrite = true;
            } else if (!parseInputBindingArray(action)) {
                return false;
            }

            skipWhitespace();
            if (consume('}')) {
                return true;
            }
            if (!consume(',')) {
                return fail(SettingsDecodeError::malformedJson);
            }
            skipWhitespace();
            if (peek() == '}') {
                return fail(SettingsDecodeError::malformedJson);
            }
        }
        return false;
    }

    [[nodiscard]] bool parseInputBindingArray(const InputAction action) noexcept {
        if (peek() != '[') {
            return fail(SettingsDecodeError::typeMismatch);
        }
        static_cast<void>(consume('['));
        InputBindingOverride* const bindingPointer =
            result_.settings.inputBindings.tryForAction(action);
        if (bindingPointer == nullptr) {
            return fail(SettingsDecodeError::invalidValue);
        }
        InputBindingOverride& binding = *bindingPointer;
        binding = {};
        binding.present = true;
        skipWhitespace();
        if (consume(']')) {
            return true;
        }

        std::size_t elementCount = 0U;
        while (!failed()) {
            if (elementCount >= maximum_json_array_elements) {
                return fail(SettingsDecodeError::memberLimitExceeded);
            }
            ++elementCount;
            if (peek() != '"') {
                return fail(SettingsDecodeError::typeMismatch);
            }
            FixedString<maximum_decoded_setting_string_bytes> rawCode;
            if (!parseString(rawCode)) {
                return false;
            }
            KeyboardCode code;
            if (!tryMakeKeyboardCode(rawCode.view(), code)) {
                result_.requiresCanonicalRewrite = true;
            } else {
                bool duplicate = false;
                for (std::size_t index = 0U; index < binding.count; ++index) {
                    duplicate = duplicate || binding.codes[index] == code;
                }
                if (duplicate
                    || binding.count >= maximum_input_bindings_per_action) {
                    result_.requiresCanonicalRewrite = true;
                } else {
                    binding.codes[binding.count++] = code;
                }
            }

            skipWhitespace();
            if (consume(']')) {
                return true;
            }
            if (!consume(',')) {
                return fail(SettingsDecodeError::malformedJson);
            }
            skipWhitespace();
            if (peek() == ']') {
                return fail(SettingsDecodeError::malformedJson);
            }
        }
        return false;
    }

    template<std::size_t Capacity>
    [[nodiscard]] bool parseRequiredString(FixedString<Capacity>& out) noexcept {
        if (peek() != '"') {
            return fail(SettingsDecodeError::typeMismatch);
        }
        return parseString(out);
    }

    [[nodiscard]] bool parseRequiredBoolean(bool& out) noexcept {
        if (matchLiteral("true")) {
            position_ += 4U;
            out = true;
            return true;
        }
        if (matchLiteral("false")) {
            position_ += 5U;
            out = false;
            return true;
        }
        return fail(SettingsDecodeError::typeMismatch);
    }

    [[nodiscard]] bool parseRequiredNumber(
        NumberToken& token,
        double& value
    ) noexcept {
        const char current = peek();
        if (current != '-' && (current < '0' || current > '9')) {
            return fail(SettingsDecodeError::typeMismatch);
        }
        if (!parseNumber(token)) {
            return false;
        }
        const char* const begin = token.text.data();
        const char* const end = begin + token.text.size();
        const auto conversion = std::from_chars(
            begin,
            end,
            value,
            std::chars_format::general
        );
        if (conversion.ec != std::errc{} || conversion.ptr != end || !std::isfinite(value)) {
            return fail(SettingsDecodeError::invalidValue);
        }
        return true;
    }

    [[nodiscard]] bool parseNumber(NumberToken& token) noexcept {
        const std::size_t start = position_;
        if (consume('-') && atEnd()) {
            return fail(SettingsDecodeError::malformedJson);
        }

        if (consume('0')) {
            if (peek() >= '0' && peek() <= '9') {
                return fail(SettingsDecodeError::malformedJson);
            }
        } else {
            if (peek() < '1' || peek() > '9') {
                return fail(SettingsDecodeError::malformedJson);
            }
            while (peek() >= '0' && peek() <= '9') {
                ++position_;
            }
        }

        bool integerSyntax = true;
        if (consume('.')) {
            integerSyntax = false;
            if (peek() < '0' || peek() > '9') {
                return fail(SettingsDecodeError::malformedJson);
            }
            while (peek() >= '0' && peek() <= '9') {
                ++position_;
            }
        }
        if (peek() == 'e' || peek() == 'E') {
            integerSyntax = false;
            ++position_;
            if (peek() == '+' || peek() == '-') {
                ++position_;
            }
            if (peek() < '0' || peek() > '9') {
                return fail(SettingsDecodeError::malformedJson);
            }
            while (peek() >= '0' && peek() <= '9') {
                ++position_;
            }
        }
        token = {input_.substr(start, position_ - start), integerSyntax};
        return true;
    }

    template<std::size_t Capacity>
    [[nodiscard]] bool parseString(FixedString<Capacity>& out) noexcept {
        out = {};
        if (!consume('"')) {
            return fail(SettingsDecodeError::malformedJson);
        }
        while (!atEnd()) {
            const unsigned char byte = static_cast<unsigned char>(input_[position_++]);
            if (byte == static_cast<unsigned char>('"')) {
                return true;
            }
            if (byte < 0x20U) {
                return fail(SettingsDecodeError::malformedJson, position_ - 1U);
            }
            if (byte != static_cast<unsigned char>('\\')) {
                if (!out.append(static_cast<char>(byte))) {
                    return fail(SettingsDecodeError::stringLimitExceeded);
                }
                continue;
            }
            if (atEnd()) {
                return fail(SettingsDecodeError::malformedJson);
            }
            const char escape = input_[position_++];
            char decoded = '\0';
            switch (escape) {
            case '"':
            case '\\':
            case '/':
                decoded = escape;
                break;
            case 'b':
                decoded = '\b';
                break;
            case 'f':
                decoded = '\f';
                break;
            case 'n':
                decoded = '\n';
                break;
            case 'r':
                decoded = '\r';
                break;
            case 't':
                decoded = '\t';
                break;
            case 'u': {
                std::uint32_t codePoint = 0U;
                if (!parseUnicodeEscape(codePoint)) {
                    return false;
                }
                if (!appendCodePoint(out, codePoint)) {
                    return fail(SettingsDecodeError::stringLimitExceeded);
                }
                continue;
            }
            default:
                return fail(SettingsDecodeError::malformedJson, position_ - 1U);
            }
            if (!out.append(decoded)) {
                return fail(SettingsDecodeError::stringLimitExceeded);
            }
        }
        return fail(SettingsDecodeError::malformedJson);
    }

    [[nodiscard]] bool parseDiscardedString() noexcept {
        FixedString<maximum_decoded_setting_string_bytes> bounded;
        // Unknown strings are still bounded to keep the codec's resource use deterministic.
        return parseString(bounded);
    }

    [[nodiscard]] bool parseUnicodeEscape(std::uint32_t& codePoint) noexcept {
        std::uint32_t first = 0U;
        if (!parseHexQuad(first)) {
            return false;
        }
        if (first >= 0xD800U && first <= 0xDBFFU) {
            if (position_ + 2U > input_.size()
                || input_[position_] != '\\'
                || input_[position_ + 1U] != 'u') {
                return fail(SettingsDecodeError::malformedJson);
            }
            position_ += 2U;
            std::uint32_t second = 0U;
            if (!parseHexQuad(second)
                || second < 0xDC00U
                || second > 0xDFFFU) {
                return fail(SettingsDecodeError::malformedJson);
            }
            codePoint = 0x10000U
                + ((first - 0xD800U) << 10U)
                + (second - 0xDC00U);
            return true;
        }
        if (first >= 0xDC00U && first <= 0xDFFFU) {
            return fail(SettingsDecodeError::malformedJson);
        }
        codePoint = first;
        return true;
    }

    [[nodiscard]] bool parseHexQuad(std::uint32_t& value) noexcept {
        if (position_ + 4U > input_.size()) {
            return fail(SettingsDecodeError::malformedJson);
        }
        value = 0U;
        for (std::size_t index = 0U; index < 4U; ++index) {
            const char byte = input_[position_++];
            std::uint32_t digit = 0U;
            if (byte >= '0' && byte <= '9') {
                digit = static_cast<std::uint32_t>(byte - '0');
            } else if (byte >= 'a' && byte <= 'f') {
                digit = 10U + static_cast<std::uint32_t>(byte - 'a');
            } else if (byte >= 'A' && byte <= 'F') {
                digit = 10U + static_cast<std::uint32_t>(byte - 'A');
            } else {
                return fail(SettingsDecodeError::malformedJson, position_ - 1U);
            }
            value = (value << 4U) | digit;
        }
        return true;
    }

    template<std::size_t Capacity>
    [[nodiscard]] bool appendCodePoint(
        FixedString<Capacity>& out,
        const std::uint32_t codePoint
    ) noexcept {
        if (codePoint <= 0x7FU) {
            return out.append(static_cast<char>(codePoint));
        }
        if (codePoint <= 0x7FFU) {
            return out.append(static_cast<char>(0xC0U | (codePoint >> 6U)))
                && out.append(static_cast<char>(0x80U | (codePoint & 0x3FU)));
        }
        if (codePoint <= 0xFFFFU) {
            return out.append(static_cast<char>(0xE0U | (codePoint >> 12U)))
                && out.append(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3FU)))
                && out.append(static_cast<char>(0x80U | (codePoint & 0x3FU)));
        }
        return out.append(static_cast<char>(0xF0U | (codePoint >> 18U)))
            && out.append(static_cast<char>(0x80U | ((codePoint >> 12U) & 0x3FU)))
            && out.append(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3FU)))
            && out.append(static_cast<char>(0x80U | (codePoint & 0x3FU)));
    }

    [[nodiscard]] bool skipValue(const std::size_t depth) noexcept {
        const char current = peek();
        if (current == '"') {
            return parseDiscardedString();
        }
        if (current == '{') {
            if (depth >= maximum_json_nesting) {
                return fail(SettingsDecodeError::nestingLimitExceeded);
            }
            return skipObject(depth);
        }
        if (current == '[') {
            if (depth >= maximum_json_nesting) {
                return fail(SettingsDecodeError::nestingLimitExceeded);
            }
            return skipArray(depth);
        }
        if (matchLiteral("true")) {
            position_ += 4U;
            return true;
        }
        if (matchLiteral("false")) {
            position_ += 5U;
            return true;
        }
        if (matchLiteral("null")) {
            position_ += 4U;
            return true;
        }
        if (current == '-' || (current >= '0' && current <= '9')) {
            NumberToken ignored;
            return parseNumber(ignored);
        }
        return fail(SettingsDecodeError::malformedJson);
    }

    [[nodiscard]] bool skipObject(const std::size_t depth) noexcept {
        if (!consume('{')) {
            return fail(SettingsDecodeError::malformedJson);
        }
        resetObjectFrame(depth);
        skipWhitespace();
        if (consume('}')) {
            return true;
        }
        while (!failed()) {
            FixedString<maximum_json_key_bytes> key;
            if (!parseString(key) || !recordObjectKey(depth, key)) {
                return false;
            }
            skipWhitespace();
            if (!consume(':')) {
                return fail(SettingsDecodeError::malformedJson);
            }
            skipWhitespace();
            if (!skipValue(depth + 1U)) {
                return false;
            }
            skipWhitespace();
            if (consume('}')) {
                return true;
            }
            if (!consume(',')) {
                return fail(SettingsDecodeError::malformedJson);
            }
            skipWhitespace();
            if (peek() == '}') {
                return fail(SettingsDecodeError::malformedJson);
            }
        }
        return false;
    }

    [[nodiscard]] bool skipArray(const std::size_t depth) noexcept {
        if (!consume('[')) {
            return fail(SettingsDecodeError::malformedJson);
        }
        skipWhitespace();
        if (consume(']')) {
            return true;
        }
        std::size_t count = 0U;
        while (!failed()) {
            if (count >= maximum_json_array_elements) {
                return fail(SettingsDecodeError::memberLimitExceeded);
            }
            ++count;
            if (!skipValue(depth + 1U)) {
                return false;
            }
            skipWhitespace();
            if (consume(']')) {
                return true;
            }
            if (!consume(',')) {
                return fail(SettingsDecodeError::malformedJson);
            }
            skipWhitespace();
            if (peek() == ']') {
                return fail(SettingsDecodeError::malformedJson);
            }
        }
        return false;
    }

    void resetObjectFrame(const std::size_t depth) noexcept {
        objectFrames_[depth].count = 0U;
    }

    template<std::size_t Capacity>
    [[nodiscard]] bool recordObjectKey(
        const std::size_t depth,
        const FixedString<Capacity>& key
    ) noexcept {
        ObjectKeyFrame& frame = objectFrames_[depth];
        for (std::size_t index = 0U; index < frame.count; ++index) {
            if (frame.keys[index].view() == key.view()) {
                return fail(SettingsDecodeError::duplicateKey);
            }
        }
        if (frame.count >= frame.keys.size()) {
            return fail(SettingsDecodeError::memberLimitExceeded);
        }
        FixedString<maximum_json_key_bytes> stored;
        for (const char byte : key.view()) {
            if (!stored.append(byte)) {
                return fail(SettingsDecodeError::stringLimitExceeded);
            }
        }
        frame.keys[frame.count++] = stored;
        return true;
    }

    void skipWhitespace() noexcept {
        while (!atEnd()) {
            const char byte = input_[position_];
            if (byte != ' ' && byte != '\t' && byte != '\n' && byte != '\r') {
                return;
            }
            ++position_;
        }
    }

    [[nodiscard]] bool matchLiteral(const std::string_view literal) const noexcept {
        return input_.substr(position_, literal.size()) == literal;
    }

    [[nodiscard]] char peek() const noexcept {
        return atEnd() ? '\0' : input_[position_];
    }

    [[nodiscard]] bool consume(const char expected) noexcept {
        if (peek() != expected) {
            return false;
        }
        ++position_;
        return true;
    }

    [[nodiscard]] bool atEnd() const noexcept {
        return position_ >= input_.size();
    }

    [[nodiscard]] bool failed() const noexcept {
        return result_.error != SettingsDecodeError::none;
    }

    [[nodiscard]] bool fail(
        const SettingsDecodeError error,
        const std::size_t offset = std::numeric_limits<std::size_t>::max()
    ) noexcept {
        if (!failed()) {
            result_.error = error;
            result_.errorOffset = offset == std::numeric_limits<std::size_t>::max()
                ? position_
                : offset;
        }
        return false;
    }

    std::string_view input_;
    SettingsDefaults defaults_{};
    SettingsDecodeResult result_{};
    std::size_t position_ = 0U;
    std::array<ObjectKeyFrame, maximum_json_nesting> objectFrames_{};
    std::array<bool, setting_field_count> seen_{};
    bool darkModeSeen_ = false;
    bool darkModeValue_ = false;
};

class FixedJsonWriter final {
public:
    [[nodiscard]] bool append(const std::string_view value) noexcept {
        if (value.size() > bytes_.size() - size_) {
            return false;
        }
        std::copy(value.begin(), value.end(), bytes_.begin() + static_cast<std::ptrdiff_t>(size_));
        size_ += value.size();
        return true;
    }

    template<typename Integer>
    [[nodiscard]] bool appendInteger(const Integer value) noexcept {
        std::array<char, 32> buffer{};
        const auto conversion = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value);
        if (conversion.ec != std::errc{}) {
            return false;
        }
        return append(std::string_view(
            buffer.data(),
            static_cast<std::size_t>(conversion.ptr - buffer.data())
        ));
    }

    [[nodiscard]] std::string_view view() const noexcept {
        return {bytes_.data(), size_};
    }

private:
    std::array<char, maximum_settings_json_bytes> bytes_{};
    std::size_t size_ = 0U;
};

[[nodiscard]] bool appendBoolean(FixedJsonWriter& writer, const bool value) noexcept {
    return writer.append(value ? "true" : "false");
}

[[nodiscard]] bool appendInputBindings(
    FixedJsonWriter& writer,
    const InputBindings& bindings
) noexcept {
    std::size_t presentCount = 0U;
    for (const InputBindingOverride& binding : bindings.actions) {
        presentCount += binding.present ? 1U : 0U;
    }
    if (presentCount == 0U) {
        return writer.append("{}");
    }
    if (!writer.append("{\n")) {
        return false;
    }
    std::size_t written = 0U;
    for (std::size_t actionIndexValue = 0U;
         actionIndexValue < input_action_count;
         ++actionIndexValue) {
        const InputBindingOverride& binding = bindings.actions[actionIndexValue];
        if (!binding.present) {
            continue;
        }
        const InputAction action = static_cast<InputAction>(actionIndexValue);
        if (!writer.append("    \"")
            || !writer.append(inputActionName(action))
            || !writer.append("\": [")) {
            return false;
        }
        for (std::size_t index = 0U; index < binding.count; ++index) {
            if ((index > 0U && !writer.append(", "))
                || !writer.append("\"")
                || !writer.append(binding.codes[index].view())
                || !writer.append("\"")) {
                return false;
            }
        }
        ++written;
        if (!writer.append(written < presentCount ? "],\n" : "]\n")) {
            return false;
        }
    }
    return writer.append("  }");
}

[[nodiscard]] bool buildCanonicalJson(
    const GameSettings& settings,
    FixedJsonWriter& writer
) noexcept {
    return writer.append("{\n  \"theme\": \"")
        && writer.append(themeName(settings.theme))
        && writer.append("\",\n  \"disableTransparency\": ")
        && appendBoolean(writer, settings.disableTransparency)
        && writer.append(",\n  \"language\": \"")
        && writer.append(languageName(settings.language))
        && writer.append("\",\n  \"windowMode\": \"")
        && writer.append(windowModeName(settings.windowMode))
        && writer.append("\",\n  \"widescreenSupport\": ")
        && appendBoolean(writer, settings.widescreenSupport)
        && writer.append(",\n  \"width\": ")
        && writer.appendInteger(settings.width)
        && writer.append(",\n  \"height\": ")
        && writer.appendInteger(settings.height)
        && writer.append(",\n  \"renderScale\": ")
        && writer.appendInteger(static_cast<unsigned int>(settings.renderScalePercent))
        && writer.append(",\n  \"uiScale\": ")
        && writer.appendInteger(settings.uiScalePercent)
        && writer.append(",\n  \"tooltipDelaySeconds\": ")
        && writer.appendInteger(static_cast<unsigned int>(settings.tooltipDelayTenths / 10U))
        && writer.append(".")
        && writer.appendInteger(static_cast<unsigned int>(settings.tooltipDelayTenths % 10U))
        && writer.append(",\n  \"inputBindings\": ")
        && appendInputBindings(writer, settings.inputBindings)
        && writer.append(",\n  \"bgmVolume\": ")
        && writer.appendInteger(static_cast<unsigned int>(settings.bgmVolumePercent))
        && writer.append(",\n  \"sfxVolume\": ")
        && writer.appendInteger(static_cast<unsigned int>(settings.sfxVolumePercent))
        && writer.append(",\n  \"screenModeChanged\": ")
        && appendBoolean(writer, settings.screenModeChanged)
        && writer.append(",\n  \"debugMode\": ")
        && appendBoolean(writer, settings.debugMode)
        && writer.append("\n}\n");
}

} // namespace

SettingsDecodeResult decodeSettingsJson(
    const std::string_view json,
    const SettingsDefaults defaults
) noexcept {
    SettingsDecodeResult early;
    early.settings = makeDefaultSettings(defaults);
    if (json.size() > maximum_settings_json_bytes) {
        early.error = SettingsDecodeError::inputTooLarge;
        early.errorOffset = maximum_settings_json_bytes;
        return early;
    }
    if (!validUtf8(json)) {
        early.error = SettingsDecodeError::invalidUtf8;
        return early;
    }

    JsonReader reader(json, defaults);
    SettingsDecodeResult result = reader.parse();
    if (!result.succeeded()) {
        return result;
    }
    const SettingsValidationResult validation = validateSettings(result.settings);
    if (!validation.succeeded()) {
        result.error = SettingsDecodeError::invalidValue;
        return result;
    }

    FixedJsonWriter canonical;
    if (!buildCanonicalJson(result.settings, canonical)) {
        result.error = SettingsDecodeError::invalidValue;
        return result;
    }
    if (canonical.view() != json) {
        result.requiresCanonicalRewrite = true;
    }
    return result;
}

SettingsEncodeResult encodeSettingsJson(const GameSettings& settings) noexcept {
    SettingsEncodeResult result;
    result.validation = validateSettings(settings);
    if (!result.validation.succeeded()) {
        result.error = SettingsEncodeError::invalidSettings;
        return result;
    }

    FixedJsonWriter writer;
    if (!buildCanonicalJson(settings, writer)) {
        result.error = SettingsEncodeError::outputTooLarge;
        return result;
    }
    try {
        result.json.assign(writer.view());
    } catch (const std::bad_alloc&) {
        result.error = SettingsEncodeError::allocationFailed;
        result.json.clear();
    } catch (const std::length_error&) {
        result.error = SettingsEncodeError::allocationFailed;
        result.json.clear();
    }
    return result;
}

} // namespace cirvivor::settings
