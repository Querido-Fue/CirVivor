#include "settings/settings_overlay_session.h"

#include <array>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <string_view>

namespace {

using namespace cirvivor::settings;

[[noreturn]] void fail(
    const char* expression,
    const char* file,
    const int line
) {
    std::cerr << file << ':' << line << ": requirement failed: "
              << expression << '\n';
    std::exit(EXIT_FAILURE);
}

#define REQUIRE(expression) \
    do { \
        if (!(expression)) { \
            fail(#expression, __FILE__, __LINE__); \
        } \
    } while (false)

void testBeginRejectsInvalidInputTransactionally() {
    SettingsOverlaySession session;
    GameSettings invalid = makeDefaultSettings();
    invalid.width = minimum_window_width - 1;

    REQUIRE(!session.begin(0U, makeDefaultSettings()));
    REQUIRE(!session.begin(3U, invalid));
    REQUIRE(!session.snapshot().active);
    REQUIRE(session.snapshot().revision == 0U);
}

void testAllPersistedControlsUpdateDraft() {
    SettingsOverlaySession session;
    REQUIRE(session.begin(7U, makeDefaultSettings()));
    REQUIRE(!session.begin(8U, makeDefaultSettings()));

    REQUIRE(session.activate(7U, SettingsOverlayField::windowMode, 0.25).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::widescreenSupport, 0.5).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::renderScale, 0.0).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::uiScale, 1.0).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::disableTransparency, 0.5).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::language, 0.25).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::theme, 0.25).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::tooltipDelay, 0.5).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::bgmVolume, 0.77).changed);
    REQUIRE(session.activate(7U, SettingsOverlayField::sfxVolume, 0.99).changed);

    const GameSettings& draft = session.draft();
    REQUIRE(draft.windowMode == WindowMode::windowed);
    REQUIRE(!draft.widescreenSupport);
    REQUIRE(draft.renderScalePercent == 75U);
    REQUIRE(draft.uiScalePercent == 150U);
    REQUIRE(draft.disableTransparency);
    REQUIRE(draft.language == Language::korean);
    REQUIRE(draft.theme == Theme::light);
    REQUIRE(draft.tooltipDelayTenths == 10U);
    REQUIRE(draft.bgmVolumePercent == 77U);
    REQUIRE(draft.sfxVolumePercent == 99U);
    REQUIRE(session.snapshot().dirty);
    REQUIRE(session.snapshot().changedFields
        == static_cast<SettingsOverlayFieldMask>(
            (SettingsOverlayFieldMask{1U}
                << static_cast<std::uint8_t>(SettingsOverlayField::count))
            - 1U
        ));
    REQUIRE(validateSettings(draft).succeeded());
}

void testStaleAndInvalidUpdatesAreSideEffectFree() {
    SettingsOverlaySession session;
    REQUIRE(session.begin(9U, makeDefaultSettings()));
    const auto before = session.snapshot();

    const auto stale = session.activate(
        8U,
        SettingsOverlayField::theme,
        0.0
    );
    REQUIRE(stale.error == SettingsOverlayUpdateError::staleSequence);
    REQUIRE(session.snapshot() == before);
    const auto invalidField = session.activate(
        9U,
        SettingsOverlayField::count,
        0.0
    );
    REQUIRE(invalidField.error == SettingsOverlayUpdateError::invalidField);
    REQUIRE(session.snapshot() == before);
    const auto invalidValue = session.activate(
        9U,
        SettingsOverlayField::uiScale,
        std::numeric_limits<double>::quiet_NaN()
    );
    REQUIRE(invalidValue.error == SettingsOverlayUpdateError::invalidValue);
    REQUIRE(session.snapshot() == before);
}

void testReturningToBaselineClearsDirty() {
    SettingsOverlaySession session;
    REQUIRE(session.begin(4U, makeDefaultSettings()));
    REQUIRE(session.activate(
        4U,
        SettingsOverlayField::widescreenSupport,
        0.5
    ).dirty);
    const auto restored = session.activate(
        4U,
        SettingsOverlayField::widescreenSupport,
        0.5
    );
    REQUIRE(restored.changed);
    REQUIRE(!restored.dirty);
    REQUIRE(!session.snapshot().dirty);
}

void testDiscardReturnsBaselineAndEndsSession() {
    SettingsOverlaySession session;
    GameSettings baseline = makeDefaultSettings({Language::korean});
    baseline.bgmVolumePercent = 31U;
    REQUIRE(session.begin(12U, baseline));
    REQUIRE(session.activate(12U, SettingsOverlayField::bgmVolume, 1.0).changed);

    GameSettings reverted = makeDefaultSettings();
    SettingsOverlayFieldMask changedFields = 0U;
    REQUIRE(!session.discard(11U, reverted, changedFields));
    REQUIRE(session.snapshot().active);
    REQUIRE(session.discard(12U, reverted, changedFields));
    REQUIRE(reverted == baseline);
    REQUIRE(changedFields == settingsOverlayFieldBit(
        SettingsOverlayField::bgmVolume
    ));
    REQUIRE(!session.snapshot().active);
    REQUIRE(session.snapshot().overlaySequence == 0U);
}

void testSaveAndBenchmarkEndOnlyMatchingSession() {
    SettingsOverlaySession saved;
    REQUIRE(saved.begin(20U, makeDefaultSettings()));
    REQUIRE(saved.activate(20U, SettingsOverlayField::theme, 0.0).changed);
    GameSettings authority = makeDefaultSettings();
    authority.debugMode = true;
    GameSettings candidate = makeDefaultSettings();
    REQUIRE(!saved.tryBuildSaveCandidate(21U, authority, candidate));
    REQUIRE(candidate == makeDefaultSettings());
    REQUIRE(saved.tryBuildSaveCandidate(20U, authority, candidate));
    REQUIRE(candidate.theme == Theme::light);
    REQUIRE(candidate.debugMode);
    GameSettings mismatched = candidate;
    mismatched.theme = Theme::dark;
    REQUIRE(!saved.acceptSaved(20U, mismatched));
    REQUIRE(!saved.acceptSaved(21U, candidate));
    REQUIRE(saved.snapshot().active);
    REQUIRE(saved.acceptSaved(20U, candidate));
    REQUIRE(!saved.snapshot().active);
    REQUIRE(saved.snapshot().baseline == saved.snapshot().draft);
    REQUIRE(saved.snapshot().draft.debugMode);

    SettingsOverlaySession benchmark;
    REQUIRE(benchmark.begin(30U, makeDefaultSettings()));
    REQUIRE(benchmark.activate(30U, SettingsOverlayField::uiScale, 1.0).changed);
    const GameSettings preview = benchmark.draft();
    REQUIRE(benchmark.abandon(30U));
    REQUIRE(!benchmark.snapshot().active);
    REQUIRE(benchmark.draft() == preview);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    constexpr std::array tests{
        TestCase{"invalid begin", testBeginRejectsInvalidInputTransactionally},
        TestCase{"all controls", testAllPersistedControlsUpdateDraft},
        TestCase{"stale update", testStaleAndInvalidUpdatesAreSideEffectFree},
        TestCase{"dirty restoration", testReturningToBaselineClearsDirty},
        TestCase{"discard", testDiscardReturnsBaselineAndEndsSession},
        TestCase{"save and benchmark", testSaveAndBenchmarkEndOnlyMatchingSession}
    };
    for (const TestCase& test : tests) {
        test.run();
        std::cout << "[PASS] " << test.name << '\n';
    }
    std::cout << tests.size() << " settings overlay session tests passed\n";
    return EXIT_SUCCESS;
}
