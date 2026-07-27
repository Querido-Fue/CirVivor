#include "settings/settings_codec.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

using namespace cirvivor::settings;

class TestFailure final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void require(
    const bool condition,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!condition) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)

void expectDecodeError(
    const std::string_view json,
    const SettingsDecodeError expected
) {
    const SettingsDecodeResult result = decodeSettingsJson(json);
    REQUIRE(!result.succeeded());
    REQUIRE(result.error == expected);
}

KeyboardCode makeCode(const std::string_view value) {
    KeyboardCode result;
    REQUIRE(tryMakeKeyboardCode(value, result));
    return result;
}

void appendCode(
    InputBindingOverride& binding,
    const std::string_view value
) {
    REQUIRE(binding.count < maximum_input_bindings_per_action);
    binding.present = true;
    binding.codes[binding.count++] = makeCode(value);
}

InputBindingOverride& bindingFor(
    InputBindings& bindings,
    const InputAction action
) {
    InputBindingOverride* const result = bindings.tryForAction(action);
    REQUIRE(result != nullptr);
    return *result;
}

const InputBindingOverride& bindingFor(
    const InputBindings& bindings,
    const InputAction action
) {
    const InputBindingOverride* const result = bindings.tryForAction(action);
    REQUIRE(result != nullptr);
    return *result;
}

void expectAtomicRejection(
    GameSettings candidate,
    const SettingsValidationError expected
) {
    GameSettings destination = makeDefaultSettings({Language::korean});
    destination.debugMode = true;
    const GameSettings before = destination;
    const SettingsValidationResult validation = tryReplaceSettings(
        destination,
        candidate
    );
    REQUIRE(validation.error == expected);
    REQUIRE(destination == before);
}

void testModelDefaultsAndNames() {
    const GameSettings settings = makeDefaultSettings();
    REQUIRE(settings.theme == Theme::dark);
    REQUIRE(!settings.disableTransparency);
    REQUIRE(settings.language == Language::english);
    REQUIRE(settings.windowMode == WindowMode::fullscreen);
    REQUIRE(settings.widescreenSupport);
    REQUIRE(settings.width == 1'280);
    REQUIRE(settings.height == 720);
    REQUIRE(settings.renderScalePercent == 100U);
    REQUIRE(settings.uiScalePercent == 100U);
    REQUIRE(settings.tooltipDelayTenths == 3U);
    REQUIRE(settings.bgmVolumePercent == 25U);
    REQUIRE(settings.sfxVolumePercent == 40U);
    REQUIRE(!settings.screenModeChanged);
    REQUIRE(!settings.debugMode);
    REQUIRE(validateSettings(settings).succeeded());
    REQUIRE(makeDefaultSettings({Language::korean}).language == Language::korean);
    REQUIRE(makeDefaultSettings({static_cast<Language>(255U)}).language == Language::english);

    REQUIRE(themeName(Theme::light) == "light");
    REQUIRE(languageName(Language::korean) == "korean");
    REQUIRE(languageName(Language::userLanguage) == "userLanguage");
    REQUIRE(windowModeName(WindowMode::windowed) == "windowed");
    REQUIRE(inputActionName(InputAction::debugStep) == "debugStep");

    KeyboardCode code;
    REQUIRE(tryMakeKeyboardCode("ArrowUp", code));
    REQUIRE(code.view() == "ArrowUp");
    REQUIRE(!tryMakeKeyboardCode("bad-code", code));
    REQUIRE(!isValidKeyboardCode("1Key"));
    REQUIRE(isValidKeyboardCode(std::string(64U, 'A')));
    REQUIRE(!isValidKeyboardCode(std::string(65U, 'A')));

    KeyboardCode corruptSize;
    corruptSize.size = 255U;
    REQUIRE(corruptSize.view().size() == maximum_keyboard_code_bytes);

    KeyboardCode clean = makeCode("KeyW");
    KeyboardCode dirtyTail = clean;
    dirtyTail.bytes.back() = 'X';
    REQUIRE(clean == dirtyTail);

    InputBindingOverride cleanBinding;
    cleanBinding.present = true;
    cleanBinding.count = 1U;
    cleanBinding.codes[0] = clean;
    InputBindingOverride dirtyInactiveTail = cleanBinding;
    dirtyInactiveTail.codes[3].bytes.back() = 'X';
    REQUIRE(cleanBinding == dirtyInactiveTail);

    InputBindings bindings;
    const InputBindings before = bindings;
    REQUIRE(bindings.tryForAction(static_cast<InputAction>(255U)) == nullptr);
    REQUIRE(bindings == before);
}

void testRuntimeValidationIsAtomic() {
    GameSettings candidate = makeDefaultSettings();
    candidate.theme = static_cast<Theme>(255U);
    expectAtomicRejection(candidate, SettingsValidationError::invalidTheme);

    candidate = makeDefaultSettings();
    candidate.width = minimum_window_width - 1;
    expectAtomicRejection(candidate, SettingsValidationError::invalidWindowWidth);

    candidate = makeDefaultSettings();
    candidate.renderScalePercent = minimum_render_scale_percent - 1U;
    expectAtomicRejection(candidate, SettingsValidationError::invalidRenderScale);

    candidate = makeDefaultSettings();
    candidate.uiScalePercent = maximum_ui_scale_percent + 1U;
    expectAtomicRejection(candidate, SettingsValidationError::invalidUiScale);

    candidate = makeDefaultSettings();
    candidate.tooltipDelayTenths = maximum_tooltip_delay_tenths + 1U;
    expectAtomicRejection(candidate, SettingsValidationError::invalidTooltipDelay);

    candidate = makeDefaultSettings();
    InputBindingOverride& invalidBinding =
        bindingFor(candidate.inputBindings, InputAction::moveUp);
    invalidBinding.present = true;
    invalidBinding.count = 1U;
    expectAtomicRejection(candidate, SettingsValidationError::invalidKeyboardCode);

    candidate = makeDefaultSettings();
    InputBindingOverride& duplicateBinding =
        bindingFor(candidate.inputBindings, InputAction::pause);
    appendCode(duplicateBinding, "Escape");
    appendCode(duplicateBinding, "Escape");
    expectAtomicRejection(candidate, SettingsValidationError::duplicateKeyboardCode);

    candidate = makeDefaultSettings();
    InputBindingOverride& dirtyTailDuplicate =
        bindingFor(candidate.inputBindings, InputAction::reload);
    dirtyTailDuplicate.present = true;
    dirtyTailDuplicate.count = 2U;
    dirtyTailDuplicate.codes[0] = makeCode("KeyR");
    dirtyTailDuplicate.codes[1] = dirtyTailDuplicate.codes[0];
    dirtyTailDuplicate.codes[1].bytes.back() = 'X';
    expectAtomicRejection(candidate, SettingsValidationError::duplicateKeyboardCode);

    candidate = makeDefaultSettings();
    InputBindingOverride& oversizedCode =
        bindingFor(candidate.inputBindings, InputAction::debugStep);
    oversizedCode.present = true;
    oversizedCode.count = 1U;
    oversizedCode.codes[0].size = 255U;
    expectAtomicRejection(candidate, SettingsValidationError::invalidKeyboardCode);

    candidate = makeDefaultSettings();
    candidate.sfxVolumePercent = maximum_volume_percent + 1U;
    expectAtomicRejection(candidate, SettingsValidationError::invalidSfxVolume);

    GameSettings destination = makeDefaultSettings();
    candidate = makeDefaultSettings({Language::korean});
    candidate.debugMode = true;
    REQUIRE(tryReplaceSettings(destination, candidate).succeeded());
    REQUIRE(destination == candidate);
}

void testCanonicalEncodingAndRoundTrip() {
    GameSettings settings = makeDefaultSettings({Language::userLanguage});
    settings.theme = Theme::light;
    settings.disableTransparency = true;
    settings.windowMode = WindowMode::windowed;
    settings.widescreenSupport = false;
    settings.width = 1'920;
    settings.height = 1'080;
    settings.renderScalePercent = 88U;
    settings.uiScalePercent = 125U;
    settings.tooltipDelayTenths = 10U;
    appendCode(bindingFor(settings.inputBindings, InputAction::moveUp), "KeyW");
    appendCode(bindingFor(settings.inputBindings, InputAction::moveUp), "ArrowUp");
    bindingFor(settings.inputBindings, InputAction::moveUp).codes[3].bytes.back() = 'X';
    bindingFor(settings.inputBindings, InputAction::pause).present = true;
    settings.inputBindings.actions[static_cast<std::size_t>(InputAction::debugStep)]
        .codes[0].bytes.back() = 'Y';
    settings.bgmVolumePercent = 0U;
    settings.sfxVolumePercent = 100U;
    settings.screenModeChanged = true;
    settings.debugMode = true;

    constexpr std::string_view expected =
        "{\n"
        "  \"theme\": \"light\",\n"
        "  \"disableTransparency\": true,\n"
        "  \"language\": \"userLanguage\",\n"
        "  \"windowMode\": \"windowed\",\n"
        "  \"widescreenSupport\": false,\n"
        "  \"width\": 1920,\n"
        "  \"height\": 1080,\n"
        "  \"renderScale\": 88,\n"
        "  \"uiScale\": 125,\n"
        "  \"tooltipDelaySeconds\": 1.0,\n"
        "  \"inputBindings\": {\n"
        "    \"moveUp\": [\"KeyW\", \"ArrowUp\"],\n"
        "    \"pause\": []\n"
        "  },\n"
        "  \"bgmVolume\": 0,\n"
        "  \"sfxVolume\": 100,\n"
        "  \"screenModeChanged\": true,\n"
        "  \"debugMode\": true\n"
        "}\n";

    const SettingsEncodeResult encoded = encodeSettingsJson(settings);
    REQUIRE(encoded.succeeded());
    REQUIRE(encoded.json == expected);
    REQUIRE(encoded.json.size() <= maximum_settings_json_bytes);

    const SettingsDecodeResult decoded = decodeSettingsJson(encoded.json);
    REQUIRE(decoded.succeeded());
    REQUIRE(decoded.settings == settings);
    REQUIRE(!decoded.requiresCanonicalRewrite);
    REQUIRE(!decoded.migratedLegacy);
    REQUIRE(encodeSettingsJson(decoded.settings).json == encoded.json);

    GameSettings invalid = settings;
    invalid.windowMode = static_cast<WindowMode>(255U);
    const SettingsEncodeResult rejected = encodeSettingsJson(invalid);
    REQUIRE(rejected.error == SettingsEncodeError::invalidSettings);
    REQUIRE(rejected.validation.error == SettingsValidationError::invalidWindowMode);
    REQUIRE(rejected.json.empty());
}

void testDefaultsAndCanonicalRewrite() {
    const SettingsDecodeResult decoded = decodeSettingsJson(
        "{}",
        {Language::korean}
    );
    REQUIRE(decoded.succeeded());
    REQUIRE(decoded.settings == makeDefaultSettings({Language::korean}));
    REQUIRE(decoded.requiresCanonicalRewrite);
    REQUIRE(!decoded.migratedLegacy);

    const SettingsEncodeResult encoded = encodeSettingsJson(decoded.settings);
    REQUIRE(encoded.succeeded());
    const SettingsDecodeResult canonical = decodeSettingsJson(
        encoded.json,
        {Language::korean}
    );
    REQUIRE(canonical.succeeded());
    REQUIRE(!canonical.requiresCanonicalRewrite);
}

void testClampAndLegacyMigration() {
    constexpr std::string_view json = R"({
        "theme":"neon",
        "darkMode":false,
        "language":"userLanguage",
        "windowMode":"borderless",
        "width":1,
        "height":-4,
        "renderScale":74,
        "uiScale":151,
        "tooltipDelaySeconds":2.06,
        "bgmVolume":-1,
        "sfxVolume":101,
        "physicsAccuracy":{"unused":[true,null]}
    })";
    const SettingsDecodeResult decoded = decodeSettingsJson(
        json,
        {Language::korean}
    );
    REQUIRE(decoded.succeeded());
    REQUIRE(decoded.requiresCanonicalRewrite);
    REQUIRE(decoded.migratedLegacy);
    REQUIRE(decoded.settings.theme == Theme::dark);
    REQUIRE(decoded.settings.language == Language::userLanguage);
    REQUIRE(decoded.settings.windowMode == WindowMode::fullscreen);
    REQUIRE(decoded.settings.width == minimum_window_width);
    REQUIRE(decoded.settings.height == minimum_window_height);
    REQUIRE(decoded.settings.renderScalePercent == minimum_render_scale_percent);
    REQUIRE(decoded.settings.uiScalePercent == maximum_ui_scale_percent);
    REQUIRE(decoded.settings.tooltipDelayTenths == maximum_tooltip_delay_tenths);
    REQUIRE(decoded.settings.bgmVolumePercent == 0U);
    REQUIRE(decoded.settings.sfxVolumePercent == maximum_volume_percent);

    const SettingsDecodeResult darkModeOnly = decodeSettingsJson(
        R"({"darkMode":false})"
    );
    REQUIRE(darkModeOnly.succeeded());
    REQUIRE(darkModeOnly.settings.theme == Theme::light);
    REQUIRE(darkModeOnly.migratedLegacy);

    const SettingsDecodeResult invalidWindow = decodeSettingsJson(
        R"({"windowMode":"maximized"})"
    );
    REQUIRE(invalidWindow.succeeded());
    REQUIRE(invalidWindow.settings.windowMode == WindowMode::windowed);
    REQUIRE(invalidWindow.migratedLegacy);

    const SettingsDecodeResult invalidLanguage = decodeSettingsJson(
        R"({"language":"bogus"})",
        {Language::korean}
    );
    REQUIRE(invalidLanguage.succeeded());
    REQUIRE(invalidLanguage.settings.language == Language::english);
    REQUIRE(invalidLanguage.requiresCanonicalRewrite);

    const SettingsDecodeResult integralNumber = decodeSettingsJson(
        R"({"width":1.28e3})"
    );
    REQUIRE(integralNumber.succeeded());
    REQUIRE(integralNumber.settings.width == minimum_window_width);
    REQUIRE(integralNumber.requiresCanonicalRewrite);
    expectDecodeError(R"({"width":1280.5})", SettingsDecodeError::invalidValue);
}

void testInputBindingNormalization() {
    constexpr std::string_view json = R"({
        "inputBindings": {
            "moveUp": ["KeyW", "KeyW", "bad-code", "ArrowUp", "KeyZ", "KeyX", "KeyQ"],
            "pause": [],
            "unknownAction": ["KeyU"]
        }
    })";
    const SettingsDecodeResult decoded = decodeSettingsJson(json);
    REQUIRE(decoded.succeeded());
    REQUIRE(decoded.requiresCanonicalRewrite);
    const InputBindingOverride& moveUp =
        bindingFor(decoded.settings.inputBindings, InputAction::moveUp);
    REQUIRE(moveUp.present);
    REQUIRE(moveUp.count == 4U);
    REQUIRE(moveUp.codes[0].view() == "KeyW");
    REQUIRE(moveUp.codes[1].view() == "ArrowUp");
    REQUIRE(moveUp.codes[2].view() == "KeyZ");
    REQUIRE(moveUp.codes[3].view() == "KeyX");
    const InputBindingOverride& pause =
        bindingFor(decoded.settings.inputBindings, InputAction::pause);
    REQUIRE(pause.present);
    REQUIRE(pause.count == 0U);

    const SettingsEncodeResult encoded = encodeSettingsJson(decoded.settings);
    REQUIRE(encoded.succeeded());
    const SettingsDecodeResult roundTrip = decodeSettingsJson(encoded.json);
    REQUIRE(roundTrip.succeeded());
    REQUIRE(roundTrip.settings == decoded.settings);
    REQUIRE(!roundTrip.requiresCanonicalRewrite);

    expectDecodeError(
        R"({"inputBindings":{"moveUp":true}})",
        SettingsDecodeError::typeMismatch
    );
    expectDecodeError(
        R"({"inputBindings":{"moveUp":["KeyW",2]}})",
        SettingsDecodeError::typeMismatch
    );
}

void testStrictJsonErrors() {
    struct Case final {
        std::string_view json;
        SettingsDecodeError error;
    };
    constexpr std::array cases{
        Case{"", SettingsDecodeError::emptyDocument},
        Case{"[]", SettingsDecodeError::expectedTopLevelObject},
        Case{"{}x", SettingsDecodeError::trailingContent},
        Case{R"({"theme":"dark",})", SettingsDecodeError::malformedJson},
        Case{R"({"theme":"dark","theme":"light"})", SettingsDecodeError::duplicateKey},
        Case{R"({"theme":"dark","the\u006de":"light"})", SettingsDecodeError::duplicateKey},
        Case{R"({"width":01})", SettingsDecodeError::malformedJson},
        Case{R"({"width":1.})", SettingsDecodeError::malformedJson},
        Case{R"({"width":+1})", SettingsDecodeError::typeMismatch},
        Case{R"({"theme":null})", SettingsDecodeError::typeMismatch},
        Case{R"({"x":"\q"})", SettingsDecodeError::malformedJson},
        Case{R"({"x":"\uD800"})", SettingsDecodeError::malformedJson},
        Case{R"({"x":{"a":1,"\u0061":2}})", SettingsDecodeError::duplicateKey},
        Case{R"({"inputBindings":{"moveUp":[],"move\u0055p":[]}})", SettingsDecodeError::duplicateKey}
    };
    for (const Case& testCase : cases) {
        expectDecodeError(testCase.json, testCase.error);
    }
}

std::string jsonWithBytes(
    const std::initializer_list<unsigned int> bytes
) {
    std::string json = "{\"x\":\"";
    for (const unsigned int byte : bytes) {
        json.push_back(static_cast<char>(byte));
    }
    json += "\"}";
    return json;
}

void testUtf8AndSizeLimits() {
    for (const std::string& json : std::array{
             jsonWithBytes({0xC0U, 0x80U}),
             jsonWithBytes({0x80U}),
             jsonWithBytes({0xEDU, 0xA0U, 0x80U}),
             jsonWithBytes({0xF4U, 0x90U, 0x80U, 0x80U})
         }) {
        expectDecodeError(json, SettingsDecodeError::invalidUtf8);
    }

    const std::string validUtf8 = jsonWithBytes({
        0xEDU, 0x95U, 0x9CU,
        0xEAU, 0xB8U, 0x80U
    });
    REQUIRE(decodeSettingsJson(validUtf8).succeeded());

    std::string boundary(maximum_settings_json_bytes, ' ');
    boundary[0] = '{';
    boundary[1] = '}';
    const SettingsDecodeResult accepted = decodeSettingsJson(boundary);
    REQUIRE(accepted.succeeded());
    REQUIRE(accepted.requiresCanonicalRewrite);

    boundary.push_back(' ');
    expectDecodeError(boundary, SettingsDecodeError::inputTooLarge);
}

void testNestingAndMemberLimits() {
    auto nestedArray = [](const std::size_t count) {
        std::string json = "{\"x\":";
        json.append(count, '[');
        json += '0';
        json.append(count, ']');
        json += '}';
        return json;
    };
    REQUIRE(decodeSettingsJson(nestedArray(7U)).succeeded());
    expectDecodeError(nestedArray(8U), SettingsDecodeError::nestingLimitExceeded);

    std::string object = "{\"x\":{";
    for (std::size_t index = 0U; index < 257U; ++index) {
        if (index > 0U) {
            object += ',';
        }
        object += "\"k" + std::to_string(index) + "\":0";
    }
    object += "}}";
    expectDecodeError(object, SettingsDecodeError::memberLimitExceeded);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    constexpr std::array tests{
        TestCase{"model defaults and names", testModelDefaultsAndNames},
        TestCase{"runtime validation is atomic", testRuntimeValidationIsAtomic},
        TestCase{"canonical encoding and roundtrip", testCanonicalEncodingAndRoundTrip},
        TestCase{"defaults request canonical rewrite", testDefaultsAndCanonicalRewrite},
        TestCase{"clamp and legacy migration", testClampAndLegacyMigration},
        TestCase{"input binding normalization", testInputBindingNormalization},
        TestCase{"strict JSON errors", testStrictJsonErrors},
        TestCase{"UTF-8 and size limits", testUtf8AndSizeLimits},
        TestCase{"nesting and member limits", testNestingAndMemberLimits}
    };

    std::size_t passed = 0U;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }
    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
