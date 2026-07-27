#include "debug/debug_runtime_controller.h"

#include <algorithm>
#include <limits>

namespace cirvivor::debug {
namespace {

[[nodiscard]] constexpr bool validDisplayOption(
    const DebugDisplayOption option
) noexcept {
    return option >= DebugDisplayOption::frameTime
        && option < DebugDisplayOption::count;
}

[[nodiscard]] constexpr bool validKey(const DebugKey key) noexcept {
    return key >= DebugKey::pauseSlash && key < DebugKey::count;
}

[[nodiscard]] constexpr bool validKeyPhase(
    const DebugKeyPhase phase
) noexcept {
    switch (phase) {
    case DebugKeyPhase::pressed:
    case DebugKeyPhase::released:
        return true;
    }
    return false;
}

} // namespace

DebugRuntimeController::DebugRuntimeController(
    const bool debugModeEnabled
) noexcept
    : debugModeEnabled_(debugModeEnabled) {}

DebugPointerResult DebugRuntimeController::handleMiddlePointer(
    const DebugPointerPhase phase,
    const std::uint64_t pointerId,
    const std::uint64_t timestampMilliseconds
) noexcept {
    switch (phase) {
    case DebugPointerPhase::middlePressed:
        if (middlePressCaptured_) {
            return {
                .status = middlePointerId_ == pointerId
                    ? DebugPointerStatus::ignoredDuplicatePress
                    : DebugPointerStatus::ignoredAdditionalPointer,
                .effect = {
                    .debugModeEnabled = debugModeEnabled_,
                    .stateRevision = revision_
                }
            };
        }
        middlePressCaptured_ = true;
        middlePointerId_ = pointerId;
        middlePressTimestampMilliseconds_ = timestampMilliseconds;
        incrementRevision();
        return {
            .status = DebugPointerStatus::captured,
            .effect = {
                .debugModeEnabled = debugModeEnabled_,
                .stateRevision = revision_
            },
            .stateChanged = true
        };
    case DebugPointerPhase::middleReleased:
        return handleMiddleRelease(pointerId, timestampMilliseconds);
    case DebugPointerPhase::cancelled: {
        const bool changed = resetGesture();
        if (changed) {
            incrementRevision();
        }
        return {
            .status = DebugPointerStatus::gestureReset,
            .effect = {
                .debugModeEnabled = debugModeEnabled_,
                .stateRevision = revision_
            },
            .stateChanged = changed
        };
    }
    }
    return {
        .status = DebugPointerStatus::rejectedInvalidPhase,
        .effect = {
            .debugModeEnabled = debugModeEnabled_,
            .stateRevision = revision_
        }
    };
}

bool DebugRuntimeController::handleFocusLost() noexcept {
    const bool gestureChanged = resetGesture();
    const bool keyChanged = std::any_of(
        keyDown_.begin(),
        keyDown_.end(),
        [](const bool down) noexcept { return down; }
    );
    const bool pendingStepChanged = singleStepPending_;
    keyDown_.fill(false);
    singleStepPending_ = false;
    if (gestureChanged || keyChanged || pendingStepChanged) {
        incrementRevision();
        return true;
    }
    return false;
}

DebugRuntimeEffect DebugRuntimeController::applyDebugMode(
    const bool enabled
) noexcept {
    return setDebugMode(enabled, false);
}

bool DebugRuntimeController::setDisplayOption(
    const DebugDisplayOption option,
    const bool enabled
) noexcept {
    if (!validDisplayOption(option)) {
        return false;
    }
    const std::size_t index = static_cast<std::size_t>(option);
    if (displayOptions_[index] == enabled) {
        return false;
    }

    displayOptions_[index] = enabled;
    if (option == DebugDisplayOption::animationDebug && !enabled) {
        clearAnimationControl();
    }
    incrementRevision();
    return true;
}

bool DebugRuntimeController::toggleDisplayOption(
    const DebugDisplayOption option
) noexcept {
    if (!validDisplayOption(option)) {
        return false;
    }
    const std::size_t index = static_cast<std::size_t>(option);
    return setDisplayOption(option, !displayOptions_[index]);
}

bool DebugRuntimeController::displayOptionEnabled(
    const DebugDisplayOption option
) const noexcept {
    return validDisplayOption(option)
        && displayOptions_[static_cast<std::size_t>(option)];
}

bool DebugRuntimeController::displayOptionActive(
    const DebugDisplayOption option
) const noexcept {
    return debugModeEnabled_ && displayOptionEnabled(option);
}

DebugKeyResult DebugRuntimeController::handleKey(
    const DebugKey key,
    const DebugKeyPhase phase,
    const bool repeated
) noexcept {
    if (!validKey(key) || !validKeyPhase(phase)) {
        return {.status = DebugKeyStatus::rejectedInvalidInput};
    }

    const std::size_t index = static_cast<std::size_t>(key);
    if (phase == DebugKeyPhase::released) {
        if (!keyDown_[index]) {
            return {.status = DebugKeyStatus::ignoredReleaseWithoutPress};
        }
        keyDown_[index] = false;
        incrementRevision();
        return {
            .status = DebugKeyStatus::released,
            .stateChanged = true
        };
    }

    if (repeated) {
        return {.status = DebugKeyStatus::ignoredRepeat};
    }
    if (keyDown_[index]) {
        return {.status = DebugKeyStatus::ignoredDuplicatePress};
    }
    keyDown_[index] = true;

    if (!displayOptionActive(DebugDisplayOption::animationDebug)) {
        incrementRevision();
        return {
            .status = DebugKeyStatus::ignoredInactive,
            .stateChanged = true
        };
    }

    if (key == DebugKey::pauseSlash) {
        animationPaused_ = !animationPaused_;
        if (!animationPaused_) {
            singleStepPending_ = false;
        }
        incrementRevision();
        return {
            .status = DebugKeyStatus::pauseToggled,
            .stateChanged = true
        };
    }

    if (!animationPaused_) {
        incrementRevision();
        return {
            .status = DebugKeyStatus::ignoredNotPaused,
            .stateChanged = true
        };
    }
    if (singleStepPending_) {
        incrementRevision();
        return {
            .status = DebugKeyStatus::ignoredStepAlreadyPending,
            .stateChanged = true
        };
    }

    singleStepPending_ = true;
    incrementRevision();
    return {
        .status = DebugKeyStatus::stepQueued,
        .stateChanged = true
    };
}

DebugFrameEffect DebugRuntimeController::prepareFrame() noexcept {
    if (!displayOptionActive(DebugDisplayOption::animationDebug)) {
        if (animationPaused_ || singleStepPending_) {
            clearAnimationControl();
            incrementRevision();
        }
        return {};
    }
    if (!animationPaused_) {
        return {};
    }
    if (!singleStepPending_) {
        return {
            .mode = DebugFrameMode::paused,
            .runGameplayUpdate = false,
            .maximumGameplayFixedSteps = 0U,
            .runUiUpdate = true,
            .runRender = true
        };
    }

    singleStepPending_ = false;
    incrementRevision();
    return {
        .mode = DebugFrameMode::singleStep,
        .runGameplayUpdate = true,
        .maximumGameplayFixedSteps = 1U,
        .runUiUpdate = true,
        .runRender = true
    };
}

DebugRuntimeSnapshot DebugRuntimeController::snapshot() const noexcept {
    return {
        .displayOptions = displayOptions_,
        .debugModeEnabled = debugModeEnabled_,
        .animationPaused = animationPaused_
            && displayOptionActive(DebugDisplayOption::animationDebug),
        .singleStepPending = singleStepPending_,
        .middlePressCaptured = middlePressCaptured_,
        .middlePointerId = middlePointerId_,
        .recentMiddleReleaseCount = static_cast<std::uint8_t>(
            middleReleaseCount_
        ),
        .revision = revision_
    };
}

DebugPointerResult DebugRuntimeController::handleMiddleRelease(
    const std::uint64_t pointerId,
    const std::uint64_t timestampMilliseconds
) noexcept {
    if (!middlePressCaptured_) {
        return {
            .status = DebugPointerStatus::ignoredUnmatchedRelease,
            .effect = {
                .debugModeEnabled = debugModeEnabled_,
                .stateRevision = revision_
            }
        };
    }
    if (middlePointerId_ != pointerId) {
        return {
            .status = DebugPointerStatus::ignoredUnmatchedRelease,
            .effect = {
                .debugModeEnabled = debugModeEnabled_,
                .stateRevision = revision_
            }
        };
    }
    if (timestampMilliseconds < middlePressTimestampMilliseconds_) {
        static_cast<void>(resetGesture());
        incrementRevision();
        return {
            .status = DebugPointerStatus::rejectedNonMonotonicClick,
            .effect = {
                .debugModeEnabled = debugModeEnabled_,
                .stateRevision = revision_
            },
            .stateChanged = true
        };
    }

    middlePressCaptured_ = false;
    middlePointerId_ = 0U;
    middlePressTimestampMilliseconds_ = 0U;

    if (middleReleaseCount_ > 0U
        && timestampMilliseconds
            < middleReleaseTimestamps_[middleReleaseCount_ - 1U]) {
        middleReleaseCount_ = 0U;
        middleReleaseTimestamps_.fill(0U);
    }
    while (middleReleaseCount_ > 0U
        && timestampMilliseconds - middleReleaseTimestamps_[0]
            > debug_toggle_window_milliseconds) {
        for (std::size_t index = 1U; index < middleReleaseCount_; ++index) {
            middleReleaseTimestamps_[index - 1U] =
                middleReleaseTimestamps_[index];
        }
        --middleReleaseCount_;
        middleReleaseTimestamps_[middleReleaseCount_] = 0U;
    }

    middleReleaseTimestamps_[middleReleaseCount_] = timestampMilliseconds;
    ++middleReleaseCount_;
    if (middleReleaseCount_ < required_middle_release_count) {
        incrementRevision();
        return {
            .status = DebugPointerStatus::released,
            .effect = {
                .overlayIntent = debugModeEnabled_
                    ? DebugOverlayIntent::open
                    : DebugOverlayIntent::none,
                .debugModeEnabled = debugModeEnabled_,
                .stateRevision = revision_
            },
            .stateChanged = true
        };
    }

    middleReleaseCount_ = 0U;
    middleReleaseTimestamps_.fill(0U);
    DebugRuntimeEffect effect = setDebugMode(!debugModeEnabled_, true);
    return {
        .status = DebugPointerStatus::debugModeToggled,
        .effect = effect,
        .stateChanged = true
    };
}

DebugRuntimeEffect DebugRuntimeController::setDebugMode(
    const bool enabled,
    const bool persist
) noexcept {
    if (debugModeEnabled_ == enabled) {
        return {
            .overlayIntent = enabled
                ? DebugOverlayIntent::open
                : DebugOverlayIntent::close,
            .debugModeEnabled = enabled,
            .stateRevision = revision_
        };
    }

    debugModeEnabled_ = enabled;
    if (!enabled) {
        displayOptions_[static_cast<std::size_t>(
            DebugDisplayOption::animationDebug
        )] = false;
        clearAnimationControl();
    }
    incrementRevision();
    return {
        .overlayIntent = enabled
            ? DebugOverlayIntent::open
            : DebugOverlayIntent::close,
        .debugModeChanged = true,
        .persistDebugMode = persist,
        .debugModeEnabled = enabled,
        .stateRevision = revision_
    };
}

bool DebugRuntimeController::resetGesture() noexcept {
    const bool changed = middlePressCaptured_ || middleReleaseCount_ > 0U;
    middleReleaseTimestamps_.fill(0U);
    middleReleaseCount_ = 0U;
    middlePointerId_ = 0U;
    middlePressTimestampMilliseconds_ = 0U;
    middlePressCaptured_ = false;
    return changed;
}

void DebugRuntimeController::clearAnimationControl() noexcept {
    animationPaused_ = false;
    singleStepPending_ = false;
}

void DebugRuntimeController::incrementRevision() noexcept {
    if (revision_ < std::numeric_limits<std::uint64_t>::max()) {
        ++revision_;
    }
}

} // namespace cirvivor::debug
