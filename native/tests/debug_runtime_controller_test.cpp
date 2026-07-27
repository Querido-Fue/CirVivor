#include "debug/debug_runtime_controller.h"

#include <array>
#include <cstddef>
#include <cstdlib>
#include <iostream>
#include <string_view>

namespace {

using cirvivor::debug::DebugDisplayOption;
using cirvivor::debug::DebugFrameMode;
using cirvivor::debug::DebugKey;
using cirvivor::debug::DebugKeyPhase;
using cirvivor::debug::DebugKeyStatus;
using cirvivor::debug::DebugOverlayIntent;
using cirvivor::debug::DebugPointerPhase;
using cirvivor::debug::DebugPointerStatus;
using cirvivor::debug::DebugRuntimeController;
using cirvivor::debug::unlimited_gameplay_fixed_steps;

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

void middleClick(
    DebugRuntimeController& controller,
    const std::uint64_t pointerId,
    const std::uint64_t timestampMilliseconds
) {
    const auto pressed = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        pointerId,
        timestampMilliseconds
    );
    REQUIRE(pressed.status == DebugPointerStatus::captured);
    const auto released = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        pointerId,
        timestampMilliseconds
    );
    REQUIRE(released.status == DebugPointerStatus::released
        || released.status == DebugPointerStatus::debugModeToggled);
}

void testExactlyTwoSecondWindowToggles() {
    DebugRuntimeController controller{};

    middleClick(controller, 7U, 10'000U);
    middleClick(controller, 7U, 11'000U);
    const auto press = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        7U,
        12'000U
    );
    REQUIRE(press.status == DebugPointerStatus::captured);
    const auto toggle = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        7U,
        12'000U
    );

    REQUIRE(toggle.status == DebugPointerStatus::debugModeToggled);
    REQUIRE(toggle.effect.debugModeChanged);
    REQUIRE(toggle.effect.persistDebugMode);
    REQUIRE(toggle.effect.debugModeEnabled);
    REQUIRE(toggle.effect.overlayIntent == DebugOverlayIntent::open);
    REQUIRE(controller.snapshot().recentMiddleReleaseCount == 0U);
}

void testOutsideWindowPrunesOnlyExpiredReleases() {
    DebugRuntimeController controller{};

    middleClick(controller, 0U, 1'000U);
    middleClick(controller, 0U, 2'000U);
    middleClick(controller, 0U, 3'001U);
    REQUIRE(!controller.snapshot().debugModeEnabled);
    REQUIRE(controller.snapshot().recentMiddleReleaseCount == 2U);

    const auto pressed = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        0U,
        4'000U
    );
    REQUIRE(pressed.status == DebugPointerStatus::captured);
    const auto toggled = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        0U,
        4'000U
    );
    REQUIRE(toggled.status == DebugPointerStatus::debugModeToggled);
    REQUIRE(toggled.effect.overlayIntent == DebugOverlayIntent::open);
}

void testOnlyMatchedReleaseCounts() {
    DebugRuntimeController controller{};

    const auto bareRelease = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        2U,
        100U
    );
    REQUIRE(bareRelease.status == DebugPointerStatus::ignoredUnmatchedRelease);

    const auto press = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        2U,
        200U
    );
    REQUIRE(press.status == DebugPointerStatus::captured);
    const auto duplicatePress = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        2U,
        201U
    );
    REQUIRE(duplicatePress.status == DebugPointerStatus::ignoredDuplicatePress);
    const auto otherRelease = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        3U,
        202U
    );
    REQUIRE(otherRelease.status == DebugPointerStatus::ignoredUnmatchedRelease);
    REQUIRE(controller.snapshot().middlePressCaptured);

    const auto matchedRelease = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        2U,
        203U
    );
    REQUIRE(matchedRelease.status == DebugPointerStatus::released);
    REQUIRE(controller.snapshot().recentMiddleReleaseCount == 1U);

    const auto latePress = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        4U,
        500U
    );
    REQUIRE(latePress.status == DebugPointerStatus::captured);
    const auto backwardsRelease = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        4U,
        499U
    );
    REQUIRE(backwardsRelease.status
        == DebugPointerStatus::rejectedNonMonotonicClick);
    REQUIRE(!controller.snapshot().middlePressCaptured);
    REQUIRE(controller.snapshot().recentMiddleReleaseCount == 0U);
}

void testCancelAndFocusResetGesture() {
    DebugRuntimeController controller{};

    middleClick(controller, 1U, 100U);
    const auto press = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        1U,
        200U
    );
    REQUIRE(press.status == DebugPointerStatus::captured);
    const auto cancelled = controller.handleMiddlePointer(
        DebugPointerPhase::cancelled,
        99U,
        999U
    );
    REQUIRE(cancelled.status == DebugPointerStatus::gestureReset);
    REQUIRE(cancelled.stateChanged);
    REQUIRE(controller.snapshot().recentMiddleReleaseCount == 0U);
    REQUIRE(!controller.snapshot().middlePressCaptured);

    middleClick(controller, 1U, 300U);
    REQUIRE(controller.handleFocusLost());
    REQUIRE(controller.snapshot().recentMiddleReleaseCount == 0U);
    middleClick(controller, 1U, 400U);
    middleClick(controller, 1U, 500U);
    REQUIRE(!controller.snapshot().debugModeEnabled);
}

void testEnabledModeReopensAndThirdClickCloses() {
    DebugRuntimeController controller{true};

    const auto firstPress = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        0U,
        100U
    );
    REQUIRE(firstPress.status == DebugPointerStatus::captured);
    const auto firstRelease = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        0U,
        100U
    );
    REQUIRE(firstRelease.status == DebugPointerStatus::released);
    REQUIRE(firstRelease.effect.overlayIntent == DebugOverlayIntent::open);
    REQUIRE(!firstRelease.effect.debugModeChanged);

    middleClick(controller, 0U, 200U);
    const auto thirdPress = controller.handleMiddlePointer(
        DebugPointerPhase::middlePressed,
        0U,
        300U
    );
    REQUIRE(thirdPress.status == DebugPointerStatus::captured);
    const auto thirdRelease = controller.handleMiddlePointer(
        DebugPointerPhase::middleReleased,
        0U,
        300U
    );
    REQUIRE(thirdRelease.status == DebugPointerStatus::debugModeToggled);
    REQUIRE(thirdRelease.effect.debugModeChanged);
    REQUIRE(!thirdRelease.effect.debugModeEnabled);
    REQUIRE(thirdRelease.effect.overlayIntent == DebugOverlayIntent::close);
}

void testDisplayOptionsHaveOracleDefaultsAndActiveGate() {
    DebugRuntimeController controller{};
    const auto initial = controller.snapshot();
    REQUIRE(initial.displayOptions[0]);
    REQUIRE(initial.displayOptions[1]);
    REQUIRE(initial.displayOptions[2]);
    REQUIRE(!initial.displayOptions[3]);
    REQUIRE(!controller.displayOptionActive(DebugDisplayOption::frameTime));

    const auto enabled = controller.applyDebugMode(true);
    REQUIRE(enabled.debugModeChanged);
    REQUIRE(!enabled.persistDebugMode);
    REQUIRE(controller.displayOptionActive(DebugDisplayOption::frameTime));
    REQUIRE(controller.toggleDisplayOption(DebugDisplayOption::poolInfo));
    REQUIRE(!controller.displayOptionEnabled(DebugDisplayOption::poolInfo));
    REQUIRE(controller.setDisplayOption(DebugDisplayOption::animationDebug, true));
    REQUIRE(controller.displayOptionActive(DebugDisplayOption::animationDebug));
    REQUIRE(!controller.setDisplayOption(DebugDisplayOption::animationDebug, true));
    REQUIRE(!controller.toggleDisplayOption(DebugDisplayOption::count));
}

void testPauseAndSingleStepAreEdgeTriggered() {
    DebugRuntimeController controller{true};
    REQUIRE(controller.setDisplayOption(DebugDisplayOption::animationDebug, true));

    const auto pause = controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::pressed,
        false
    );
    REQUIRE(pause.status == DebugKeyStatus::pauseToggled);
    REQUIRE(controller.snapshot().animationPaused);
    const auto repeatPause = controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::pressed,
        true
    );
    REQUIRE(repeatPause.status == DebugKeyStatus::ignoredRepeat);
    const auto duplicatePause = controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::pressed,
        false
    );
    REQUIRE(duplicatePause.status == DebugKeyStatus::ignoredDuplicatePress);
    REQUIRE(controller.snapshot().animationPaused);
    REQUIRE(controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::released,
        false
    ).status == DebugKeyStatus::released);

    const auto step = controller.handleKey(
        DebugKey::stepPeriod,
        DebugKeyPhase::pressed,
        false
    );
    REQUIRE(step.status == DebugKeyStatus::stepQueued);
    REQUIRE(controller.snapshot().singleStepPending);
    const auto repeatedStep = controller.handleKey(
        DebugKey::stepPeriod,
        DebugKeyPhase::pressed,
        true
    );
    REQUIRE(repeatedStep.status == DebugKeyStatus::ignoredRepeat);

    const auto oneStep = controller.prepareFrame();
    REQUIRE(oneStep.mode == DebugFrameMode::singleStep);
    REQUIRE(oneStep.runGameplayUpdate);
    REQUIRE(oneStep.maximumGameplayFixedSteps == 1U);
    REQUIRE(oneStep.runUiUpdate);
    REQUIRE(oneStep.runRender);
    REQUIRE(!controller.snapshot().singleStepPending);

    const auto heldPause = controller.prepareFrame();
    REQUIRE(heldPause.mode == DebugFrameMode::paused);
    REQUIRE(!heldPause.runGameplayUpdate);
    REQUIRE(heldPause.maximumGameplayFixedSteps == 0U);
    REQUIRE(heldPause.runUiUpdate);
    REQUIRE(heldPause.runRender);
    REQUIRE(controller.handleKey(
        DebugKey::stepPeriod,
        DebugKeyPhase::released,
        false
    ).status == DebugKeyStatus::released);

    REQUIRE(controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::pressed,
        false
    ).status == DebugKeyStatus::pauseToggled);
    REQUIRE(!controller.snapshot().animationPaused);
    const auto running = controller.prepareFrame();
    REQUIRE(running.mode == DebugFrameMode::running);
    REQUIRE(running.runGameplayUpdate);
    REQUIRE(running.maximumGameplayFixedSteps
        == unlimited_gameplay_fixed_steps);
    REQUIRE(running.runUiUpdate);
    REQUIRE(running.runRender);
}

void testInactiveAndUnpausedStepDoNotQueue() {
    DebugRuntimeController controller{};
    const auto inactive = controller.handleKey(
        DebugKey::stepPeriod,
        DebugKeyPhase::pressed,
        false
    );
    REQUIRE(inactive.status == DebugKeyStatus::ignoredInactive);
    REQUIRE(!controller.snapshot().singleStepPending);
    REQUIRE(controller.handleKey(
        DebugKey::stepPeriod,
        DebugKeyPhase::released,
        false
    ).status == DebugKeyStatus::released);

    static_cast<void>(controller.applyDebugMode(true));
    REQUIRE(controller.setDisplayOption(DebugDisplayOption::animationDebug, true));
    const auto unpaused = controller.handleKey(
        DebugKey::stepPeriod,
        DebugKeyPhase::pressed,
        false
    );
    REQUIRE(unpaused.status == DebugKeyStatus::ignoredNotPaused);
    REQUIRE(!controller.snapshot().singleStepPending);
}

void testDisablingDebugClearsAnimationControl() {
    DebugRuntimeController controller{true};
    REQUIRE(controller.setDisplayOption(DebugDisplayOption::animationDebug, true));
    REQUIRE(controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::pressed,
        false
    ).status == DebugKeyStatus::pauseToggled);
    REQUIRE(controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::released,
        false
    ).status == DebugKeyStatus::released);
    REQUIRE(controller.handleKey(
        DebugKey::stepPeriod,
        DebugKeyPhase::pressed,
        false
    ).status == DebugKeyStatus::stepQueued);

    const auto disabled = controller.applyDebugMode(false);
    REQUIRE(disabled.debugModeChanged);
    REQUIRE(disabled.overlayIntent == DebugOverlayIntent::close);
    const auto snapshot = controller.snapshot();
    REQUIRE(!snapshot.debugModeEnabled);
    REQUIRE(!snapshot.displayOptions[3]);
    REQUIRE(!snapshot.animationPaused);
    REQUIRE(!snapshot.singleStepPending);
    REQUIRE(controller.prepareFrame().mode == DebugFrameMode::running);
}

void testFocusLossClearsHeldKeyEdge() {
    DebugRuntimeController controller{true};
    REQUIRE(controller.setDisplayOption(DebugDisplayOption::animationDebug, true));
    REQUIRE(controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::pressed,
        false
    ).status == DebugKeyStatus::pauseToggled);
    REQUIRE(controller.handleFocusLost());
    const auto nextPress = controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::pressed,
        false
    );
    REQUIRE(nextPress.status == DebugKeyStatus::pauseToggled);
    REQUIRE(!controller.snapshot().animationPaused);
}

void testFocusLossCancelsPendingSingleStep() {
    DebugRuntimeController controller{true};
    REQUIRE(controller.setDisplayOption(DebugDisplayOption::animationDebug, true));
    REQUIRE(controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::pressed,
        false
    ).status == DebugKeyStatus::pauseToggled);
    REQUIRE(controller.handleKey(
        DebugKey::pauseSlash,
        DebugKeyPhase::released,
        false
    ).status == DebugKeyStatus::released);
    REQUIRE(controller.handleKey(
        DebugKey::stepPeriod,
        DebugKeyPhase::pressed,
        false
    ).status == DebugKeyStatus::stepQueued);
    REQUIRE(controller.snapshot().singleStepPending);

    REQUIRE(controller.handleFocusLost());
    REQUIRE(!controller.snapshot().singleStepPending);
    const auto nextFrame = controller.prepareFrame();
    REQUIRE(nextFrame.mode == DebugFrameMode::paused);
    REQUIRE(!nextFrame.runGameplayUpdate);
    REQUIRE(nextFrame.maximumGameplayFixedSteps == 0U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    constexpr std::array tests{
        TestCase{"exactly two second window", testExactlyTwoSecondWindowToggles},
        TestCase{"outside window pruning", testOutsideWindowPrunesOnlyExpiredReleases},
        TestCase{"matched release only", testOnlyMatchedReleaseCounts},
        TestCase{"cancel and focus reset", testCancelAndFocusResetGesture},
        TestCase{"enabled reopen and close", testEnabledModeReopensAndThirdClickCloses},
        TestCase{"display option state", testDisplayOptionsHaveOracleDefaultsAndActiveGate},
        TestCase{"pause and single step edges", testPauseAndSingleStepAreEdgeTriggered},
        TestCase{"inactive step", testInactiveAndUnpausedStepDoNotQueue},
        TestCase{"disable clears animation", testDisablingDebugClearsAnimationControl},
        TestCase{"focus clears held key", testFocusLossClearsHeldKeyEdge},
        TestCase{"focus cancels pending step", testFocusLossCancelsPendingSingleStep}
    };

    for (const TestCase& test : tests) {
        test.run();
        std::cout << "[PASS] " << test.name << '\n';
    }
    std::cout << tests.size() << " debug runtime tests passed\n";
    return EXIT_SUCCESS;
}
