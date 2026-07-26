#include "ui/title_overlay_state_machine.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <string_view>

namespace allocation_probe {

thread_local bool enabled = false;
thread_local std::size_t count = 0U;

} // namespace allocation_probe

void* operator new(const std::size_t size) {
    if (allocation_probe::enabled) {
        ++allocation_probe::count;
    }
    if (void* const memory = std::malloc(size == 0U ? 1U : size)) {
        return memory;
    }
    throw std::bad_alloc();
}

void* operator new[](const std::size_t size) {
    return ::operator new(size);
}

void operator delete(void* const memory) noexcept {
    std::free(memory);
}

void operator delete[](void* const memory) noexcept {
    ::operator delete(memory);
}

void operator delete(void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

void operator delete[](void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

namespace {

using cirvivor::ui::OverlayKind;
using cirvivor::ui::OverlayPhase;
using cirvivor::ui::TitleOverlayStateMachine;
using cirvivor::ui::TitlePhase;
using cirvivor::ui::UiAction;
using cirvivor::ui::UiActionStatus;
using cirvivor::ui::UiEffect;
using cirvivor::ui::UiFrameContext;
using cirvivor::ui::UiStateSnapshot;
using cirvivor::ui::maximum_external_url_bytes;
using cirvivor::ui::maximum_overlay_count;

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

void requireNear(
    const double actual,
    const double expected,
    const double tolerance,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!std::isfinite(actual) || std::abs(actual - expected) > tolerance) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)
#define REQUIRE_NEAR(actual, expected, tolerance) \
    requireNear((actual), (expected), (tolerance), #actual " ~= " #expected, __FILE__, __LINE__)

void advanceInSteps(
    TitleOverlayStateMachine& state,
    const double totalSeconds,
    const double stepSeconds = 0.05
) noexcept {
    double remainingSeconds = totalSeconds;
    while (remainingSeconds > 1.0e-12) {
        const double consumedSeconds = std::min(remainingSeconds, stepSeconds);
        state.advance(consumedSeconds);
        remainingSeconds -= consumedSeconds;
    }
}

void advanceAtRate(
    TitleOverlayStateMachine& state,
    const double totalSeconds,
    const std::uint32_t framesPerSecond
) noexcept {
    const auto frameCount = static_cast<std::uint32_t>(std::llround(
        totalSeconds * static_cast<double>(framesPerSecond)
    ));
    const double frameSeconds = 1.0 / static_cast<double>(framesPerSecond);
    for (std::uint32_t frame = 0U; frame < frameCount; ++frame) {
        state.advance(frameSeconds);
    }
}

void advanceToInteractiveTitle(TitleOverlayStateMachine& state) noexcept {
    constexpr double totalIntroSeconds =
        TitleOverlayStateMachine::intro_delay_seconds
        + TitleOverlayStateMachine::logo_playback_seconds
        + TitleOverlayStateMachine::scene_transition_seconds;
    advanceAtRate(state, totalIntroSeconds, 60U);
}

void testTitleTimelineUsesCleanSecondDurations() {
    TitleOverlayStateMachine state;
    advanceInSteps(state, 1.0);
    auto snapshot = state.snapshot();
    REQUIRE(snapshot.title.phase == TitlePhase::loadingDelay);
    REQUIRE_NEAR(snapshot.title.elapsedSeconds, 1.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.title.phaseElapsedSeconds, 1.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.title.phaseProgress, 2.0 / 3.0, 1.0e-12);

    advanceInSteps(state, 0.5);
    snapshot = state.snapshot();
    REQUIRE(snapshot.title.phase == TitlePhase::logoPlayback);
    REQUIRE_NEAR(snapshot.title.phaseElapsedSeconds, 0.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.title.logoPlaybackProgress, 0.0, 1.0e-12);

    advanceInSteps(state, 1.5);
    snapshot = state.snapshot();
    REQUIRE(snapshot.title.phase == TitlePhase::logoPlayback);
    REQUIRE_NEAR(snapshot.title.phaseElapsedSeconds, 1.5, 1.0e-12);
    REQUIRE_NEAR(snapshot.title.logoPlaybackProgress, 0.5, 1.0e-12);

    advanceInSteps(state, 1.5);
    snapshot = state.snapshot();
    REQUIRE(snapshot.title.phase == TitlePhase::sceneTransition);
    REQUIRE_NEAR(snapshot.title.phaseElapsedSeconds, 0.0, 1.0e-12);

    advanceInSteps(state, 0.3);
    snapshot = state.snapshot();
    REQUIRE(snapshot.title.phase == TitlePhase::sceneTransition);
    REQUIRE(snapshot.title.enemySpawnReady);
    REQUIRE_NEAR(
        snapshot.title.menuRevealProgress,
        0.3 / TitleOverlayStateMachine::menu_reveal_seconds,
        1.0e-12
    );
    REQUIRE(!snapshot.title.menuInteractionReady);

    advanceInSteps(state, 1.7);
    snapshot = state.snapshot();
    REQUIRE(snapshot.title.phase == TitlePhase::interactive);
    REQUIRE_NEAR(snapshot.title.elapsedSeconds, 6.5, 1.0e-11);
    REQUIRE(snapshot.title.menuInteractionReady);
    REQUIRE(snapshot.titleInputEnabled);
}

void testVariableFrameRatesProduceSameWallClockPresentation() {
    constexpr std::array<std::uint32_t, 4U> frameRates{30U, 60U, 120U, 144U};
    constexpr double titleSampleSeconds = 31.0 / 6.0;
    constexpr double overlaySampleSeconds = 1.0 / 3.0;

    double expectedSceneProgress = -1.0;
    double expectedMenuProgress = -1.0;
    double expectedOverlayAlpha = -1.0;
    for (const std::uint32_t frameRate : frameRates) {
        TitleOverlayStateMachine titleState;
        advanceAtRate(titleState, titleSampleSeconds, frameRate);
        const auto titleSnapshot = titleState.snapshot();
        REQUIRE(titleSnapshot.title.phase == TitlePhase::sceneTransition);
        REQUIRE_NEAR(
            titleSnapshot.title.phaseElapsedSeconds,
            2.0 / 3.0,
            1.0e-10
        );

        TitleOverlayStateMachine overlayState;
        REQUIRE(overlayState.apply(UiAction::openExit()).accepted());
        advanceAtRate(overlayState, overlaySampleSeconds, frameRate);
        const auto overlaySnapshot = overlayState.snapshot();
        REQUIRE(overlaySnapshot.overlays[0].phase == OverlayPhase::opening);
        REQUIRE_NEAR(
            overlaySnapshot.overlays[0].phaseProgress,
            2.0 / 3.0,
            1.0e-10
        );

        if (expectedSceneProgress < 0.0) {
            expectedSceneProgress = titleSnapshot.title.sceneTransitionProgress;
            expectedMenuProgress = titleSnapshot.title.menuRevealProgress;
            expectedOverlayAlpha = overlaySnapshot.overlays[0].alpha;
        } else {
            REQUIRE_NEAR(
                titleSnapshot.title.sceneTransitionProgress,
                expectedSceneProgress,
                1.0e-10
            );
            REQUIRE_NEAR(
                titleSnapshot.title.menuRevealProgress,
                expectedMenuProgress,
                1.0e-10
            );
            REQUIRE_NEAR(
                overlaySnapshot.overlays[0].alpha,
                expectedOverlayAlpha,
                1.0e-10
            );
        }

        TitleOverlayStateMachine completedState;
        advanceAtRate(completedState, 6.5, frameRate);
        REQUIRE(completedState.snapshot().title.phase == TitlePhase::interactive);
    }
}

void testAdvanceInputPolicyAndTickAdapter() {
    TitleOverlayStateMachine state;
    const UiStateSnapshot initial = state.snapshot();
    state.advance(0.0);
    state.advance(-1.0);
    state.advance(std::numeric_limits<double>::quiet_NaN());
    state.advance(std::numeric_limits<double>::infinity());
    REQUIRE(state.snapshot() == initial);

    state.advance(0.25);
    auto snapshot = state.snapshot();
    REQUIRE_NEAR(
        snapshot.title.elapsedSeconds,
        TitleOverlayStateMachine::maximum_frame_delta_seconds,
        1.0e-12
    );
    REQUIRE_NEAR(snapshot.title.phaseProgress, 1.0 / 15.0, 1.0e-12);

    TitleOverlayStateMachine tickState;
    TitleOverlayStateMachine advanceState;
    tickState.tick();
    advanceState.advance(TitleOverlayStateMachine::fixed_step_seconds);
    REQUIRE(tickState.snapshot() == advanceState.snapshot());
}

void testAllEightTitleFactoryKindsUseOneManagerKey() {
    constexpr std::array titleKinds{
        OverlayKind::mapSelect,
        OverlayKind::deck,
        OverlayKind::setting,
        OverlayKind::credits,
        OverlayKind::quickStart,
        OverlayKind::records,
        OverlayKind::research,
        OverlayKind::achievements
    };

    for (const OverlayKind kind : titleKinds) {
        TitleOverlayStateMachine state;
        advanceToInteractiveTitle(state);
        const auto opened = state.apply(UiAction::openTitle(kind));
        REQUIRE(opened.status == UiActionStatus::applied);
        const auto duplicate = state.apply(UiAction::openTitle(OverlayKind::mapSelect));
        REQUIRE(duplicate.status == UiActionStatus::alreadyActive);
        REQUIRE(duplicate.overlaySequence == opened.overlaySequence);

        const auto snapshot = state.snapshot();
        REQUIRE(snapshot.overlayCount == 1U);
        REQUIRE(snapshot.overlays[0].kind == kind);
        REQUIRE(!snapshot.titleInputEnabled);
        REQUIRE(snapshot.overlays[0].acceptsInput);
    }
}

void testOverlayOpeningClosingRetargetAndKeyRetention() {
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    const auto opened = state.apply(
        UiAction::openTitle(OverlayKind::mapSelect)
    );
    REQUIRE(opened.status == UiActionStatus::applied);

    advanceInSteps(state, 0.25);
    auto snapshot = state.snapshot();
    REQUIRE(snapshot.overlays[0].phase == OverlayPhase::opening);
    REQUIRE_NEAR(snapshot.overlays[0].phaseProgress, 0.5, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays[0].alpha, 0.96875, 1.0e-12);
    const double midpointAlpha = snapshot.overlays[0].alpha;

    REQUIRE(state.apply(UiAction::closeTitle()).accepted());
    snapshot = state.snapshot();
    REQUIRE(snapshot.overlays[0].phase == OverlayPhase::closing);
    REQUIRE(snapshot.overlays[0].interactionsLocked);
    REQUIRE_NEAR(snapshot.overlays[0].alpha, midpointAlpha, 1.0e-12);

    const UiStateSnapshot beforeDuplicateOpen = snapshot;
    const auto duplicateOpen = state.apply(
        UiAction::openTitle(OverlayKind::deck)
    );
    REQUIRE(duplicateOpen.status == UiActionStatus::alreadyActive);
    REQUIRE(duplicateOpen.overlaySequence == opened.overlaySequence);
    REQUIRE(state.snapshot() == beforeDuplicateOpen);

    advanceInSteps(state, 0.25);
    snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 1U);
    REQUIRE_NEAR(snapshot.overlays[0].alpha, midpointAlpha * 0.96875, 1.0e-12);

    advanceInSteps(state, 0.25);
    snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 0U);
    REQUIRE(snapshot.titleInputEnabled);
}

void testDebugOverlayUsesPauseAndFocusClosePolicy() {
    TitleOverlayStateMachine normalState;
    REQUIRE(normalState.apply(UiAction::openDebug()).accepted());
    REQUIRE(normalState.snapshot().overlays[0].phase == OverlayPhase::opening);
    advanceInSteps(normalState, 0.5);
    REQUIRE(normalState.snapshot().overlays[0].phase == OverlayPhase::open);
    REQUIRE(normalState.apply(UiAction::closeDebug()).accepted());
    REQUIRE(normalState.snapshot().overlays[0].phase == OverlayPhase::closing);
    advanceInSteps(normalState, 0.5);
    REQUIRE(normalState.snapshot().overlayCount == 0U);

    constexpr UiFrameContext paused{.animationPaused = true};
    TitleOverlayStateMachine pausedState;
    REQUIRE(pausedState.apply(UiAction::openDebug(), paused).accepted());
    auto snapshot = pausedState.snapshot();
    REQUIRE(snapshot.overlays[0].phase == OverlayPhase::open);
    REQUIRE_NEAR(snapshot.overlays[0].alpha, 1.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays[0].dimAlpha, 1.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays[0].contentScale, 1.0, 1.0e-12);
    REQUIRE_NEAR(snapshot.overlays[0].contentBlur, 0.0, 1.0e-12);
    REQUIRE(pausedState.apply(UiAction::closeDebug(), paused).accepted());
    REQUIRE(pausedState.snapshot().overlayCount == 0U);

    TitleOverlayStateMachine nestedState;
    const auto debug = nestedState.apply(UiAction::openDebug());
    const auto external = nestedState.apply(
        UiAction::openExternalLink("https://jukchang.com")
    );
    REQUIRE(debug.status == UiActionStatus::applied);
    REQUIRE(external.status == UiActionStatus::applied);
    snapshot = nestedState.snapshot();
    REQUIRE(snapshot.overlayCount == 2U);
    REQUIRE(snapshot.overlays[0].kind == OverlayKind::externalLinkWarning);
    REQUIRE(snapshot.overlays[0].acceptsInput);
    REQUIRE(snapshot.overlays[1].kind == OverlayKind::debug);
    REQUIRE(!snapshot.overlays[1].acceptsInput);

    REQUIRE(nestedState.apply(UiAction::closeDebug()).accepted());
    snapshot = nestedState.snapshot();
    REQUIRE(snapshot.overlayCount == 1U);
    REQUIRE(snapshot.overlays[0].sequence == external.overlaySequence);
    REQUIRE(snapshot.overlays[0].acceptsInput);
}

void testNestedOverlayFocusAndInteractionLock() {
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    REQUIRE(state.apply(UiAction::openTitle(OverlayKind::credits)).accepted());
    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
    REQUIRE(state.apply(UiAction::openExternalLink("  https://jukchang.com  ")).accepted());

    auto snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 2U);
    REQUIRE(!snapshot.overlays[0].acceptsInput);
    REQUIRE(snapshot.overlays[1].acceptsInput);
    REQUIRE(snapshot.overlays[1].externalUrl.view() == "https://jukchang.com");

    const auto locked = state.apply(UiAction::lockTop());
    REQUIRE(locked.status == UiActionStatus::applied);
    snapshot = state.snapshot();
    REQUIRE(snapshot.overlays[1].interactionsLocked);
    REQUIRE(!snapshot.overlays[1].acceptsInput);
    REQUIRE(!snapshot.overlays[0].acceptsInput);

    const UiStateSnapshot beforeRejectedConfirm = snapshot;
    const auto rejectedConfirm = state.apply(UiAction::confirmTop());
    REQUIRE(rejectedConfirm.status == UiActionStatus::rejectedInteractionLocked);
    REQUIRE(state.snapshot() == beforeRejectedConfirm);

    const auto rejectedCancel = state.apply(UiAction::cancelTop());
    REQUIRE(rejectedCancel.status == UiActionStatus::rejectedInteractionLocked);
    REQUIRE(state.snapshot() == beforeRejectedConfirm);
}

void testRenderOrderAndInputTopUseIndependentAxes() {
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    const auto exit = state.apply(UiAction::openExit());
    const auto external = state.apply(UiAction::openExternalLink("https://jukchang.com"));
    REQUIRE(exit.status == UiActionStatus::applied);
    REQUIRE(external.status == UiActionStatus::applied);

    auto snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 2U);
    REQUIRE(snapshot.overlays[0].kind == OverlayKind::externalLinkWarning);
    REQUIRE(snapshot.overlays[0].layer == 15);
    REQUIRE(snapshot.overlays[0].sequence == external.overlaySequence);
    REQUIRE(snapshot.overlays[0].acceptsInput);
    REQUIRE(snapshot.overlays[1].kind == OverlayKind::exitConfirm);
    REQUIRE(snapshot.overlays[1].layer == 100);
    REQUIRE(snapshot.overlays[1].sequence == exit.overlaySequence);
    REQUIRE(!snapshot.overlays[1].acceptsInput);

    REQUIRE(state.apply(UiAction::cancelTop()).accepted());
    snapshot = state.snapshot();
    REQUIRE(snapshot.overlays[0].phase == OverlayPhase::closing);
    REQUIRE(snapshot.overlays[1].phase == OverlayPhase::opening);
    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
    snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 1U);
    REQUIRE(snapshot.overlays[0].kind == OverlayKind::exitConfirm);
    REQUIRE(snapshot.overlays[0].acceptsInput);
}

void testExternalEffectRequiresSequenceAcknowledgement() {
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    REQUIRE(state.apply(UiAction::openTitle(OverlayKind::credits)).accepted());
    const auto opened = state.apply(
        UiAction::openExternalLink("https://jukchang.com/path")
    );
    REQUIRE(opened.status == UiActionStatus::applied);

    const auto confirmed = state.apply(UiAction::confirmTop());
    REQUIRE(confirmed.status == UiActionStatus::applied);
    REQUIRE(confirmed.effect == UiEffect::openExternalUrl);
    REQUIRE(confirmed.effectText.view() == "https://jukchang.com/path");

    auto snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 2U);
    REQUIRE(snapshot.overlays[1].phase != OverlayPhase::closing);
    REQUIRE(snapshot.overlays[1].interactionsLocked);

    const UiStateSnapshot beforeStaleAck = snapshot;
    const auto rejectedCancel = state.apply(UiAction::cancelTop());
    REQUIRE(rejectedCancel.status == UiActionStatus::rejectedInteractionLocked);
    REQUIRE(rejectedCancel.overlaySequence == confirmed.overlaySequence);
    REQUIRE(state.snapshot() == beforeStaleAck);

    const auto stale = state.acknowledgeExternalUrl(
        confirmed.overlaySequence + 1U,
        true
    );
    REQUIRE(stale.status == UiActionStatus::rejectedStaleSequence);
    REQUIRE(state.snapshot() == beforeStaleAck);

    const auto acknowledged = state.acknowledgeExternalUrl(
        confirmed.overlaySequence,
        true
    );
    REQUIRE(acknowledged.status == UiActionStatus::applied);
    snapshot = state.snapshot();
    REQUIRE(snapshot.overlays[1].phase == OverlayPhase::closing);

    const auto repeatedAck = state.acknowledgeExternalUrl(
        confirmed.overlaySequence,
        true
    );
    REQUIRE(repeatedAck.status == UiActionStatus::rejectedEffectNotPending);

    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
    snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 1U);
    REQUIRE(snapshot.overlays[0].kind == OverlayKind::credits);
    REQUIRE(snapshot.overlays[0].acceptsInput);
}

void testExternalEffectFailureUnlocksAndKeepsOverlay() {
    TitleOverlayStateMachine state;
    const auto opened = state.apply(
        UiAction::openExternalLink("https://jukchang.com/path")
    );
    REQUIRE(opened.status == UiActionStatus::applied);
    const auto confirmed = state.apply(UiAction::confirmTop());
    REQUIRE(confirmed.effect == UiEffect::openExternalUrl);

    const auto failed = state.acknowledgeExternalUrl(
        confirmed.overlaySequence,
        false
    );
    REQUIRE(failed.status == UiActionStatus::applied);
    auto snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 1U);
    REQUIRE(snapshot.overlays[0].phase != OverlayPhase::closing);
    REQUIRE(!snapshot.overlays[0].interactionsLocked);
    REQUIRE(snapshot.overlays[0].acceptsInput);

    const auto retried = state.apply(UiAction::confirmTop());
    REQUIRE(retried.status == UiActionStatus::applied);
    REQUIRE(retried.effect == UiEffect::openExternalUrl);
}

void testExternalUrlNormalizationValidationAndBoundedCopy() {
    constexpr std::string_view paddedUrl =
        "\xEF\xBB\xBF"
        "\xC2\xA0"
        "\xE3\x80\x80"
        "HTTPS://jukchang.com/path?value=1#fragment"
        "\xE2\x80\xAF"
        "\xEF\xBB\xBF";
    constexpr std::string_view normalizedUrl =
        "HTTPS://jukchang.com/path?value=1#fragment";

    TitleOverlayStateMachine state;
    const auto opened = state.apply(UiAction::openExternalLink(paddedUrl));
    REQUIRE(opened.status == UiActionStatus::applied);
    const auto snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 1U);
    REQUIRE(snapshot.overlays[0].externalUrl.view() == normalizedUrl);
    REQUIRE(snapshot.overlays[0].externalUrl.bytes[normalizedUrl.size()] == '\0');

    TitleOverlayStateMachine internalWhitespaceState;
    constexpr std::string_view internalWhitespace =
        "https://jukchang.com/a b\xC2\xA0" "c";
    REQUIRE(internalWhitespaceState.apply(
        UiAction::openExternalLink(internalWhitespace)
    ).accepted());
    REQUIRE(
        internalWhitespaceState.snapshot().overlays[0].externalUrl.view()
        == internalWhitespace
    );

    constexpr std::array<std::string_view, 4U> validAuthorityUrls{
        "https://user:pass@example.com:443/path",
        "http://localhost:8080/path",
        "https://127.0.0.1/path",
        "https://[::1]:8443/path"
    };
    for (const std::string_view validUrl : validAuthorityUrls) {
        TitleOverlayStateMachine validAuthorityState;
        REQUIRE(validAuthorityState.apply(
            UiAction::openExternalLink(validUrl)
        ).status == UiActionStatus::applied);
        REQUIRE(
            validAuthorityState.snapshot().overlays[0].externalUrl.view()
            == validUrl
        );
    }

    constexpr std::string_view unicodeWhitespaceOnly =
        "\xC2\x85\xC2\xA0\xE3\x80\x80\xEF\xBB\xBF";
    TitleOverlayStateMachine rejectedState;
    REQUIRE(rejectedState.apply(
        UiAction::openExternalLink(unicodeWhitespaceOnly)
    ).status == UiActionStatus::rejectedPayload);
    REQUIRE(rejectedState.apply(
        UiAction::openExternalLink("file:///tmp/cirvivor")
    ).status == UiActionStatus::rejectedPayload);
    REQUIRE(rejectedState.apply(
        UiAction::openExternalLink("javascript:alert(1)")
    ).status == UiActionStatus::rejectedPayload);
    REQUIRE(rejectedState.apply(
        UiAction::openExternalLink("https://")
    ).status == UiActionStatus::rejectedPayload);
    REQUIRE(rejectedState.apply(
        UiAction::openExternalLink("https:///missing-host")
    ).status == UiActionStatus::rejectedPayload);
    REQUIRE(rejectedState.apply(
        UiAction::openExternalLink("https://jukchang.com/\xC0\xAF")
    ).status == UiActionStatus::rejectedPayload);

    constexpr std::array<std::string_view, 10U> invalidAuthorityUrls{
        "https:// example.com/path",
        "https://\texample.com/path",
        "https://\nexample.com/path",
        "https://exa\x7F" "mple.com/path",
        "https://user@/path",
        "https://:443/path",
        "https://[]/path",
        "https://user@@example.com/path",
        "https://example.com:https/path",
        "https://[::1]:https/path"
    };
    for (const std::string_view invalidUrl : invalidAuthorityUrls) {
        REQUIRE(rejectedState.apply(
            UiAction::openExternalLink(invalidUrl)
        ).status == UiActionStatus::rejectedPayload);
    }

    constexpr std::array<char, 11U> urlWithNul{
        'h', 't', 't', 'p', 's', ':', '/', '/', 'x', '\0', 'y'
    };
    REQUIRE(rejectedState.apply(UiAction::openExternalLink({
        urlWithNul.data(),
        urlWithNul.size()
    })).status == UiActionStatus::rejectedPayload);

    std::array<char, maximum_external_url_bytes> maximumUrl{};
    maximumUrl.fill('a');
    constexpr std::string_view httpsPrefix = "https://";
    for (std::size_t index = 0U; index < httpsPrefix.size(); ++index) {
        maximumUrl[index] = httpsPrefix[index];
    }
    TitleOverlayStateMachine maximumState;
    REQUIRE(maximumState.apply(UiAction::openExternalLink({
        maximumUrl.data(),
        maximumUrl.size()
    })).status == UiActionStatus::applied);
    const auto maximumSnapshot = maximumState.snapshot();
    REQUIRE(maximumSnapshot.overlays[0].externalUrl.length == maximumUrl.size());
    REQUIRE(maximumSnapshot.overlays[0].externalUrl.bytes[maximumUrl.size()] == '\0');
}

void testExistingExternalKeyPrecedesNewPayloadCapacityCheck() {
    TitleOverlayStateMachine state;
    const auto opened = state.apply(
        UiAction::openExternalLink("https://jukchang.com")
    );
    REQUIRE(opened.status == UiActionStatus::applied);

    std::array<char, maximum_external_url_bytes + 1U> oversizedUrl{};
    oversizedUrl.fill('x');
    constexpr std::string_view prefix = "https://";
    for (std::size_t index = 0U; index < prefix.size(); ++index) {
        oversizedUrl[index] = prefix[index];
    }
    const UiStateSnapshot beforeDuplicate = state.snapshot();
    const auto duplicate = state.apply(UiAction::openExternalLink({
        oversizedUrl.data(),
        oversizedUrl.size()
    }));
    REQUIRE(duplicate.status == UiActionStatus::alreadyActive);
    REQUIRE(duplicate.overlaySequence == opened.overlaySequence);
    REQUIRE(state.snapshot() == beforeDuplicate);

    const auto invalidDuplicate = state.apply(
        UiAction::openExternalLink("file:///tmp/not-allowed")
    );
    REQUIRE(invalidDuplicate.status == UiActionStatus::rejectedPayload);
    REQUIRE(state.snapshot() == beforeDuplicate);

    TitleOverlayStateMachine emptyState;
    const auto oversizedNew = emptyState.apply(UiAction::openExternalLink({
        oversizedUrl.data(),
        oversizedUrl.size()
    }));
    REQUIRE(oversizedNew.status == UiActionStatus::rejectedPayload);
}

void testWindowCloseUsesExactlyOnceExitLatch() {
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    REQUIRE(state.apply(UiAction::openTitle(OverlayKind::setting)).accepted());

    const auto firstClose = state.apply(UiAction::windowClose());
    REQUIRE(firstClose.status == UiActionStatus::applied);
    const auto repeatedClose = state.apply(UiAction::windowClose());
    REQUIRE(repeatedClose.status == UiActionStatus::alreadyActive);
    REQUIRE(repeatedClose.overlaySequence == firstClose.overlaySequence);

    auto snapshot = state.snapshot();
    REQUIRE(snapshot.overlayCount == 2U);
    REQUIRE(snapshot.overlays[1].kind == OverlayKind::exitConfirm);
    REQUIRE(snapshot.overlays[1].layer == 100);

    const auto confirmed = state.apply(UiAction::confirmTop());
    REQUIRE(confirmed.status == UiActionStatus::applied);
    REQUIRE(confirmed.effect == UiEffect::none);
    REQUIRE(state.snapshot().applicationExitRequested);

    const UiStateSnapshot beforeRejectedCancel = state.snapshot();
    const auto rejectedCancel = state.apply(UiAction::cancelTop());
    REQUIRE(rejectedCancel.status == UiActionStatus::rejectedInteractionLocked);
    REQUIRE(state.snapshot() == beforeRejectedCancel);

    REQUIRE(state.tryConsumeApplicationExitRequest());
    REQUIRE(!state.tryConsumeApplicationExitRequest());

    const auto repeatedConfirm = state.apply(UiAction::confirmTop());
    REQUIRE(repeatedConfirm.status == UiActionStatus::rejectedInteractionLocked);
    REQUIRE(!state.tryConsumeApplicationExitRequest());

    TitleOverlayStateMachine closingState;
    const auto closingExit = closingState.apply(UiAction::windowClose());
    REQUIRE(closingExit.status == UiActionStatus::applied);
    REQUIRE(closingState.apply(
        UiAction::cancelTop()
    ).status == UiActionStatus::applied);
    const UiStateSnapshot beforeRepeatedWindowClose = closingState.snapshot();
    const auto repeatedWindowClose = closingState.apply(UiAction::windowClose());
    REQUIRE(repeatedWindowClose.status == UiActionStatus::alreadyActive);
    REQUIRE(repeatedWindowClose.overlaySequence == closingExit.overlaySequence);
    REQUIRE(closingState.snapshot() == beforeRepeatedWindowClose);
}

void testInvalidTransitionsPreserveWholeSnapshot() {
    TitleOverlayStateMachine state;

    const std::array invalidBeforeReady{
        UiAction::openTitle(OverlayKind::mapSelect),
        UiAction::openTitle(OverlayKind::debug),
        UiAction::closeTitle(),
        UiAction::closeDebug(),
        UiAction::openExternalLink("   "),
        UiAction::openExternalLink("file:///tmp/not-allowed"),
        UiAction::cancelTop(),
        UiAction::confirmTop(),
        UiAction::lockTop()
    };

    for (const UiAction& action : invalidBeforeReady) {
        const UiStateSnapshot before = state.snapshot();
        const auto outcome = state.apply(action);
        REQUIRE(!outcome.accepted());
        REQUIRE(state.snapshot() == before);
    }

    advanceToInteractiveTitle(state);
    REQUIRE(state.apply(UiAction::openTitle(OverlayKind::deck)).accepted());
    REQUIRE(state.apply(UiAction::closeTitle()).accepted());
    const UiStateSnapshot closingSnapshot = state.snapshot();
    const auto repeatedClose = state.apply(UiAction::closeTitle());
    REQUIRE(repeatedClose.status == UiActionStatus::rejectedAlreadyClosing);
    REQUIRE(state.snapshot() == closingSnapshot);
}

void testFourProductionKeysFitFixedStorageAndRemainUnique() {
    static_assert(maximum_overlay_count == 4U);
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    const auto title = state.apply(UiAction::openTitle(OverlayKind::records));
    const auto external = state.apply(
        UiAction::openExternalLink("https://jukchang.com")
    );
    const auto debug = state.apply(UiAction::openDebug());
    const auto exit = state.apply(UiAction::openExit());
    REQUIRE(title.status == UiActionStatus::applied);
    REQUIRE(external.status == UiActionStatus::applied);
    REQUIRE(debug.status == UiActionStatus::applied);
    REQUIRE(exit.status == UiActionStatus::applied);
    REQUIRE(state.snapshot().overlayCount == maximum_overlay_count);

    REQUIRE(state.apply(
        UiAction::openTitle(OverlayKind::research)
    ).status == UiActionStatus::alreadyActive);
    REQUIRE(state.apply(
        UiAction::openExternalLink("https://example.com")
    ).status == UiActionStatus::alreadyActive);
    REQUIRE(state.apply(UiAction::openDebug()).status == UiActionStatus::alreadyActive);
    REQUIRE(state.apply(UiAction::openExit()).status == UiActionStatus::alreadyActive);

    REQUIRE(state.apply(UiAction::cancelTop()).status == UiActionStatus::applied);
    const UiStateSnapshot closingSnapshot = state.snapshot();
    REQUIRE(state.apply(UiAction::openExit()).status == UiActionStatus::alreadyActive);
    REQUIRE(state.snapshot() == closingSnapshot);
}

void testAdvanceSnapshotAndUrlNormalizationPerformNoHeapAllocation() {
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    REQUIRE(state.apply(UiAction::openTitle(OverlayKind::mapSelect)).accepted());
    REQUIRE(state.apply(UiAction::openExternalLink("https://jukchang.com")).accepted());
    REQUIRE(state.apply(UiAction::openDebug()).accepted());
    REQUIRE(state.apply(UiAction::openExit()).accepted());

    TitleOverlayStateMachine urlState;
    constexpr std::string_view paddedUrl =
        "\xEF\xBB\xBF\xC2\xA0https://jukchang.com\xE3\x80\x80";

    allocation_probe::count = 0U;
    allocation_probe::enabled = true;
    const auto normalized = urlState.apply(UiAction::openExternalLink(paddedUrl));
    const auto normalizedSnapshot = urlState.snapshot();
    for (std::uint32_t index = 0U; index < 2'000U; ++index) {
        state.advance(1.0 / 144.0);
        const UiStateSnapshot snapshot = state.snapshot();
        if (snapshot.overlayCount > maximum_overlay_count) {
            std::abort();
        }
    }
    allocation_probe::enabled = false;

    REQUIRE(normalized.status == UiActionStatus::applied);
    REQUIRE(
        normalizedSnapshot.overlays[0].externalUrl.view()
        == "https://jukchang.com"
    );
    REQUIRE(allocation_probe::count == 0U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"clean second title timeline", testTitleTimelineUsesCleanSecondDurations},
        TestCase{"variable frame rate invariance", testVariableFrameRatesProduceSameWallClockPresentation},
        TestCase{"advance input policy", testAdvanceInputPolicyAndTickAdapter},
        TestCase{"eight title factory kinds", testAllEightTitleFactoryKindsUseOneManagerKey},
        TestCase{"overlay retarget and closing key retention", testOverlayOpeningClosingRetargetAndKeyRetention},
        TestCase{"debug pause and focus lifecycle", testDebugOverlayUsesPauseAndFocusClosePolicy},
        TestCase{"nested focus and interaction lock", testNestedOverlayFocusAndInteractionLock},
        TestCase{"render order and input top", testRenderOrderAndInputTopUseIndependentAxes},
        TestCase{"external effect acknowledgement", testExternalEffectRequiresSequenceAcknowledgement},
        TestCase{"external effect failure", testExternalEffectFailureUnlocksAndKeepsOverlay},
        TestCase{"external URL normalization", testExternalUrlNormalizationValidationAndBoundedCopy},
        TestCase{"external key before capacity", testExistingExternalKeyPrecedesNewPayloadCapacityCheck},
        TestCase{"exactly-once exit latch", testWindowCloseUsesExactlyOnceExitLatch},
        TestCase{"invalid transition transaction", testInvalidTransitionsPreserveWholeSnapshot},
        TestCase{"four production overlay keys", testFourProductionKeysFitFixedStorageAndRemainUnique},
        TestCase{"zero-allocation state paths", testAdvanceSnapshotAndUrlNormalizationPerformNoHeapAllocation}
    };

    std::size_t passed = 0U;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            allocation_probe::enabled = false;
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }

    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
