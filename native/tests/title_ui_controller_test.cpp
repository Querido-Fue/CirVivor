#include "ui/title_ui_controller.h"
#include "ui/title_link_data.h"

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
using cirvivor::ui::OverlaySnapshot;
using cirvivor::ui::TitleOverlayStateMachine;
using cirvivor::ui::TitleUiController;
using cirvivor::ui::TitleUiControllerSnapshot;
using cirvivor::ui::TitleUiTarget;
using cirvivor::ui::UiAction;
using cirvivor::ui::UiActionOutcome;
using cirvivor::ui::UiActionStatus;
using cirvivor::ui::UiEffect;
using cirvivor::ui::UiInputResult;
using cirvivor::ui::UiInputStatus;
using cirvivor::ui::UiPointerButton;
using cirvivor::ui::UiPointerDevice;
using cirvivor::ui::UiPointerEvent;
using cirvivor::ui::UiPointerEventType;
using cirvivor::ui::UiStateSnapshot;
using cirvivor::ui::layout::PointD;
using cirvivor::ui::layout::OverlayDialogMetrics;
using cirvivor::ui::layout::OverlayDialogRenderMetrics;
using cirvivor::ui::layout::RoundedRectD;
using cirvivor::ui::layout::TitleCardSlot;
using cirvivor::ui::layout::TitleEntranceRenderState;
using cirvivor::ui::layout::UiLayoutMetrics;
using cirvivor::ui::layout::UiLayoutSnapshot;
using cirvivor::ui::layout::UtilityTileSlot;
using cirvivor::ui::layout::trySampleTitleEntrance;
using cirvivor::ui::layout::tryResolveOverlayDialogRenderMetrics;

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

struct Presentation final {
    UiLayoutSnapshot layout{};
    TitleEntranceRenderState entrance{};
};

[[nodiscard]] Presentation makePresentation(
    const double width = 1'280.0,
    const double height = 720.0,
    const double uiScale = 1.0
) {
    UiLayoutMetrics metrics;
    REQUIRE(metrics.tryUpdate({width, height, uiScale, true}));
    Presentation result{};
    result.layout = metrics.snapshot();
    REQUIRE(trySampleTitleEntrance(result.layout, 2.0, result.entrance));
    return result;
}

void advanceToInteractiveTitle(TitleOverlayStateMachine& state) noexcept {
    constexpr std::size_t frameCount = 390U;
    for (std::size_t frame = 0U; frame < frameCount; ++frame) {
        state.tick();
    }
}

[[nodiscard]] UiPointerEvent mouseEvent(
    const UiPointerEventType type,
    const PointD position,
    const UiPointerButton button = UiPointerButton::none
) noexcept {
    return {type, UiPointerDevice::mouse, button, 0U, position};
}

[[nodiscard]] UiPointerEvent touchEvent(
    const UiPointerEventType type,
    const std::uint64_t pointerId,
    const PointD position = {}
) noexcept {
    return {type, UiPointerDevice::touch, UiPointerButton::none, pointerId, position};
}

[[nodiscard]] TitleUiTarget targetForSlot(const TitleCardSlot slot) noexcept {
    switch (slot) {
    case TitleCardSlot::start:
        return TitleUiTarget::cardStart;
    case TitleCardSlot::quickStart:
        return TitleUiTarget::cardQuickStart;
    case TitleCardSlot::records:
        return TitleUiTarget::cardRecords;
    case TitleCardSlot::deck:
        return TitleUiTarget::cardDeck;
    case TitleCardSlot::research:
        return TitleUiTarget::cardResearch;
    }
    return TitleUiTarget::none;
}

[[nodiscard]] TitleUiTarget targetForSlot(const UtilityTileSlot slot) noexcept {
    switch (slot) {
    case UtilityTileSlot::setting:
        return TitleUiTarget::utilitySetting;
    case UtilityTileSlot::credits:
        return TitleUiTarget::utilityCredits;
    case UtilityTileSlot::achievements:
        return TitleUiTarget::utilityAchievements;
    case UtilityTileSlot::exit:
        return TitleUiTarget::utilityExit;
    }
    return TitleUiTarget::none;
}

[[nodiscard]] RoundedRectD rectForTarget(
    const Presentation& presentation,
    const TitleUiTarget target
) noexcept {
    for (std::size_t index = 0U;
         index < presentation.entrance.cards.size();
         ++index) {
        if (targetForSlot(presentation.layout.title.cards[index].slot) == target) {
            return presentation.entrance.cards[index].panelRect;
        }
    }
    for (std::size_t index = 0U;
         index < presentation.entrance.utilityTiles.size();
         ++index) {
        if (targetForSlot(presentation.layout.title.utilityTiles[index].slot) == target) {
            return presentation.entrance.utilityTiles[index].panelRect;
        }
    }
    if (target == TitleUiTarget::versionHistoryLink
        && presentation.entrance.versionHistoryLink.available) {
        return presentation.entrance.versionHistoryLink.hitRect;
    }
    return {};
}

[[nodiscard]] OverlayDialogRenderMetrics dialogFor(
    const Presentation& presentation,
    const OverlaySnapshot& overlay
) {
    const OverlayDialogMetrics& source = overlay.kind == OverlayKind::exitConfirm
        ? presentation.layout.overlays.exit
        : presentation.layout.overlays.externalLinkWarning;
    OverlayDialogRenderMetrics result{};
    REQUIRE(tryResolveOverlayDialogRenderMetrics(
        source,
        presentation.layout.overlayPage,
        overlay.contentScale,
        result
    ));
    return result;
}

[[nodiscard]] PointD center(const RoundedRectD& rect) noexcept {
    return {rect.x + (rect.width * 0.5), rect.y + (rect.height * 0.5)};
}

[[nodiscard]] const cirvivor::ui::TitleUiTargetInteraction& interaction(
    const TitleUiControllerSnapshot& snapshot,
    const TitleUiTarget target
) {
    for (const auto& state : snapshot.targets) {
        if (state.target == target) {
            return state;
        }
    }
    throw TestFailure("missing target interaction");
}

[[nodiscard]] bool hasOverlayKind(
    const UiStateSnapshot& snapshot,
    const OverlayKind kind
) noexcept {
    for (std::size_t index = 0U; index < snapshot.overlayCount; ++index) {
        if (snapshot.overlays[index].kind == kind) {
            return true;
        }
    }
    return false;
}

[[nodiscard]] const OverlaySnapshot& overlayOfKind(
    const UiStateSnapshot& snapshot,
    const OverlayKind kind
) {
    for (std::size_t index = 0U; index < snapshot.overlayCount; ++index) {
        if (snapshot.overlays[index].kind == kind) {
            return snapshot.overlays[index];
        }
    }
    throw TestFailure("missing overlay kind");
}

void testAllTitleTargetsDispatchExactActions() {
    struct TargetAction final {
        TitleUiTarget target;
        OverlayKind overlay;
    };
    constexpr std::array expectedActions{
        TargetAction{TitleUiTarget::cardStart, OverlayKind::mapSelect},
        TargetAction{TitleUiTarget::cardQuickStart, OverlayKind::quickStart},
        TargetAction{TitleUiTarget::cardRecords, OverlayKind::records},
        TargetAction{TitleUiTarget::cardDeck, OverlayKind::deck},
        TargetAction{TitleUiTarget::cardResearch, OverlayKind::research},
        TargetAction{TitleUiTarget::utilitySetting, OverlayKind::setting},
        TargetAction{TitleUiTarget::utilityCredits, OverlayKind::credits},
        TargetAction{TitleUiTarget::utilityAchievements, OverlayKind::achievements},
        TargetAction{TitleUiTarget::utilityExit, OverlayKind::exitConfirm}
    };
    const Presentation presentation = makePresentation();

    for (const TargetAction expected : expectedActions) {
        TitleOverlayStateMachine state;
        advanceToInteractiveTitle(state);
        TitleUiController controller;
        const PointD point = center(rectForTarget(presentation, expected.target));

        const UiInputResult moved = controller.handlePointer(
            mouseEvent(UiPointerEventType::move, point),
            presentation.layout,
            presentation.entrance,
            state.snapshot(),
            state
        );
        REQUIRE(moved.status == UiInputStatus::moved);
        REQUIRE(moved.target == expected.target);
        REQUIRE(interaction(controller.snapshot(), expected.target).hovered);

        const UiInputResult down = controller.handlePointer(
            mouseEvent(UiPointerEventType::down, point, UiPointerButton::left),
            presentation.layout,
            presentation.entrance,
            state.snapshot(),
            state
        );
        REQUIRE(down.status == UiInputStatus::captured);
        REQUIRE(down.target == expected.target);
        REQUIRE(controller.snapshot().capture.active);
        REQUIRE(controller.snapshot().capture.target == expected.target);
        REQUIRE(interaction(controller.snapshot(), expected.target).pressed);

        const UiInputResult up = controller.handlePointer(
            mouseEvent(UiPointerEventType::up, point, UiPointerButton::left),
            presentation.layout,
            presentation.entrance,
            state.snapshot(),
            state
        );
        REQUIRE(up.status == UiInputStatus::actionApplied);
        REQUIRE(up.actionAccepted());
        REQUIRE(up.actionOutcome.status == UiActionStatus::applied);
        REQUIRE(hasOverlayKind(state.snapshot(), expected.overlay));
        REQUIRE(!controller.snapshot().capture.active);
        for (const auto& targetState : controller.snapshot().targets) {
            REQUIRE(!targetState.hovered);
            REQUIRE(!targetState.pressed);
        }
    }
}

void testVersionHistoryLinkUsesMouseReleaseDirectEffectWithoutCapture() {
    const Presentation presentation = makePresentation();
    const PointD linkCenter = center(rectForTarget(
        presentation,
        TitleUiTarget::versionHistoryLink
    ));
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;

    const TitleUiControllerSnapshot initial = controller.snapshot();
    REQUIRE(initial.targets.size() == 12U);
    for (std::size_t index = 0U; index < initial.targets.size(); ++index) {
        REQUIRE(initial.targets[index].target != TitleUiTarget::none);
        for (std::size_t previous = 0U; previous < index; ++previous) {
            REQUIRE(initial.targets[previous].target != initial.targets[index].target);
        }
    }

    const UiInputResult moved = controller.handlePointer(
        mouseEvent(UiPointerEventType::move, linkCenter),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(moved.status == UiInputStatus::moved);
    REQUIRE(moved.target == TitleUiTarget::versionHistoryLink);
    REQUIRE(interaction(
        controller.snapshot(),
        TitleUiTarget::versionHistoryLink
    ).hovered);

    const UiInputResult down = controller.handlePointer(
        mouseEvent(UiPointerEventType::down, linkCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(down.status == UiInputStatus::ignoredNoCapture);
    REQUIRE(down.target == TitleUiTarget::versionHistoryLink);
    REQUIRE(!controller.snapshot().capture.active);
    REQUIRE(!interaction(
        controller.snapshot(),
        TitleUiTarget::versionHistoryLink
    ).pressed);

    const UiStateSnapshot beforeDirect = state.snapshot();
    const UiInputResult direct = controller.handlePointer(
        mouseEvent(UiPointerEventType::up, linkCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        beforeDirect,
        state
    );
    REQUIRE(direct.status == UiInputStatus::actionApplied);
    REQUIRE(direct.actionOutcome.effect == UiEffect::openExternalUrl);
    REQUIRE(direct.actionOutcome.overlaySequence == 0U);
    REQUIRE(direct.actionOutcome.effectText.view()
        == cirvivor::ui::data::title_version_history_url);
    REQUIRE(state.snapshot() == beforeDirect);
    REQUIRE(state.snapshot().overlayCount == 0U);
    REQUIRE(!controller.snapshot().capture.active);
    REQUIRE(interaction(
        controller.snapshot(),
        TitleUiTarget::versionHistoryLink
    ).hovered);

    const UiStateSnapshot beforeInvalidAck = state.snapshot();
    REQUIRE(!state.acknowledgeExternalUrl(0U, false).accepted());
    REQUIRE(state.snapshot() == beforeInvalidAck);

    TitleOverlayStateMachine edgeState;
    advanceToInteractiveTitle(edgeState);
    TitleUiController edgeController;
    REQUIRE(edgeController.handlePointer(
        mouseEvent(UiPointerEventType::down, {1.0, 1.0}, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        edgeState.snapshot(),
        edgeState
    ).status == UiInputStatus::ignoredNoTarget);
    const UiInputResult releaseEdge = edgeController.handlePointer(
        mouseEvent(UiPointerEventType::up, linkCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        edgeState.snapshot(),
        edgeState
    );
    REQUIRE(releaseEdge.actionAccepted());
    REQUIRE(releaseEdge.actionOutcome.effect == UiEffect::openExternalUrl);

    TitleOverlayStateMachine touchState;
    advanceToInteractiveTitle(touchState);
    TitleUiController touchController;
    REQUIRE(touchController.handlePointer(
        touchEvent(UiPointerEventType::down, 91U, linkCenter),
        presentation.layout,
        presentation.entrance,
        touchState.snapshot(),
        touchState
    ).status == UiInputStatus::ignoredNoTarget);
    REQUIRE(touchController.handlePointer(
        touchEvent(UiPointerEventType::up, 91U, linkCenter),
        presentation.layout,
        presentation.entrance,
        touchState.snapshot(),
        touchState
    ).status == UiInputStatus::ignoredNoCapture);
    REQUIRE(touchState.snapshot().overlayCount == 0U);
}

void testMouseHoverPressedRoundedHitAndReleaseRule() {
    const Presentation presentation = makePresentation();
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;
    const RoundedRectD startRect = rectForTarget(
        presentation,
        TitleUiTarget::cardStart
    );
    const PointD startCenter = center(startRect);
    const PointD quickCenter = center(rectForTarget(
        presentation,
        TitleUiTarget::cardQuickStart
    ));

    const UiInputResult corner = controller.handlePointer(
        mouseEvent(UiPointerEventType::move, {startRect.x, startRect.y}),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(corner.status == UiInputStatus::moved);
    REQUIRE(corner.target == TitleUiTarget::none);

    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::down, startCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::captured);

    const UiInputResult movedAway = controller.handlePointer(
        mouseEvent(UiPointerEventType::move, quickCenter),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(movedAway.target == TitleUiTarget::cardQuickStart);
    REQUIRE(controller.snapshot().capture.target == TitleUiTarget::cardStart);
    REQUIRE(!interaction(controller.snapshot(), TitleUiTarget::cardStart).pressed);
    REQUIRE(interaction(controller.snapshot(), TitleUiTarget::cardQuickStart).hovered);

    const UiInputResult released = controller.handlePointer(
        mouseEvent(UiPointerEventType::up, quickCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(released.status == UiInputStatus::released);
    REQUIRE(released.target == TitleUiTarget::cardStart);
    REQUIRE(state.snapshot().overlayCount == 0U);
    REQUIRE(!controller.snapshot().capture.active);
    REQUIRE(interaction(controller.snapshot(), TitleUiTarget::cardQuickStart).hovered);

    TitleEntranceRenderState threshold = presentation.entrance;
    threshold.cards[0].alpha = 0.75;
    const UiInputResult inactive = controller.handlePointer(
        mouseEvent(UiPointerEventType::move, startCenter),
        presentation.layout,
        threshold,
        state.snapshot(),
        state
    );
    REQUIRE(inactive.status == UiInputStatus::moved);
    REQUIRE(inactive.target == TitleUiTarget::none);
}

void testTitleGateAndExplicitUnsupportedOverlayResult() {
    const Presentation presentation = makePresentation();
    const PointD startCenter = center(rectForTarget(
        presentation,
        TitleUiTarget::cardStart
    ));

    TitleOverlayStateMachine loadingState;
    TitleUiController loadingController;
    REQUIRE(loadingController.handlePointer(
        mouseEvent(UiPointerEventType::move, startCenter),
        presentation.layout,
        presentation.entrance,
        loadingState.snapshot(),
        loadingState
    ).status == UiInputStatus::titleInputDisabled);

    TitleOverlayStateMachine nestedState;
    advanceToInteractiveTitle(nestedState);
    const auto exit = nestedState.apply(UiAction::openExit());
    const auto debug = nestedState.apply(UiAction::openDebug());
    REQUIRE(exit.accepted());
    REQUIRE(debug.accepted());
    const UiStateSnapshot nestedSnapshot = nestedState.snapshot();
    REQUIRE(hasOverlayKind(nestedSnapshot, OverlayKind::debug));
    REQUIRE(hasOverlayKind(nestedSnapshot, OverlayKind::exitConfirm));

    TitleUiController nestedController;
    const UiInputResult unsupported = nestedController.handlePointer(
        mouseEvent(UiPointerEventType::down, startCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        nestedSnapshot,
        nestedState
    );
    REQUIRE(unsupported.status == UiInputStatus::unsupportedOverlayInput);
    REQUIRE(unsupported.unsupportedOverlay == OverlayKind::debug);
    REQUIRE(unsupported.overlaySequence == debug.overlaySequence);
    REQUIRE(!nestedController.snapshot().capture.active);

    TitleOverlayStateMachine closingState;
    advanceToInteractiveTitle(closingState);
    REQUIRE(closingState.apply(UiAction::openDebug()).accepted());
    REQUIRE(closingState.apply(UiAction::closeDebug()).accepted());
    REQUIRE(closingState.snapshot().overlays[0].phase == OverlayPhase::closing);
    TitleUiController closingController;
    REQUIRE(closingController.handlePointer(
        mouseEvent(UiPointerEventType::move, startCenter),
        presentation.layout,
        presentation.entrance,
        closingState.snapshot(),
        closingState
    ).status == UiInputStatus::unsupportedOverlayInput);
}

void testExitOverlayCancelConfirmAndSequenceBoundCapture() {
    const Presentation presentation = makePresentation();

    TitleOverlayStateMachine cancelState;
    advanceToInteractiveTitle(cancelState);
    const UiActionOutcome cancelOpened = cancelState.apply(UiAction::openExit());
    REQUIRE(cancelOpened.accepted());
    cancelState.advance(0.5);
    const UiStateSnapshot cancelOpenState = cancelState.snapshot();
    const OverlaySnapshot& cancelOverlay = overlayOfKind(
        cancelOpenState,
        OverlayKind::exitConfirm
    );
    REQUIRE(cancelOverlay.acceptsInput);
    const OverlayDialogRenderMetrics cancelDialog = dialogFor(
        presentation,
        cancelOverlay
    );
    const PointD cancelCenter = center(cancelDialog.cancelButtonRect);
    TitleUiController cancelController;
    const UiInputResult cancelMove = cancelController.handlePointer(
        mouseEvent(UiPointerEventType::move, cancelCenter),
        presentation.layout,
        presentation.entrance,
        cancelOpenState,
        cancelState
    );
    REQUIRE(cancelMove.status == UiInputStatus::moved);
    REQUIRE(cancelMove.target == TitleUiTarget::overlayCancel);
    REQUIRE(cancelMove.overlaySequence == cancelOverlay.sequence);
    REQUIRE(cancelController.snapshot().overlaySequence == cancelOverlay.sequence);
    REQUIRE(interaction(
        cancelController.snapshot(),
        TitleUiTarget::overlayCancel
    ).hovered);
    REQUIRE(cancelController.handlePointer(
        mouseEvent(UiPointerEventType::down, cancelCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        cancelState.snapshot(),
        cancelState
    ).status == UiInputStatus::captured);
    REQUIRE(cancelController.snapshot().capture.overlaySequence
        == cancelOverlay.sequence);
    const UiInputResult cancelled = cancelController.handlePointer(
        mouseEvent(UiPointerEventType::up, cancelCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        cancelState.snapshot(),
        cancelState
    );
    REQUIRE(cancelled.actionAccepted());
    REQUIRE(cancelled.target == TitleUiTarget::overlayCancel);
    REQUIRE(overlayOfKind(
        cancelState.snapshot(),
        OverlayKind::exitConfirm
    ).phase == OverlayPhase::closing);

    TitleOverlayStateMachine confirmState;
    advanceToInteractiveTitle(confirmState);
    REQUIRE(confirmState.apply(UiAction::openExit()).accepted());
    confirmState.advance(0.5);
    const OverlaySnapshot confirmOverlay = overlayOfKind(
        confirmState.snapshot(),
        OverlayKind::exitConfirm
    );
    const PointD confirmCenter = center(dialogFor(
        presentation,
        confirmOverlay
    ).confirmButtonRect);
    TitleUiController confirmController;
    REQUIRE(confirmController.handlePointer(
        mouseEvent(UiPointerEventType::down, confirmCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        confirmState.snapshot(),
        confirmState
    ).status == UiInputStatus::captured);
    const UiInputResult confirmed = confirmController.handlePointer(
        mouseEvent(UiPointerEventType::up, confirmCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        confirmState.snapshot(),
        confirmState
    );
    REQUIRE(confirmed.actionAccepted());
    REQUIRE(confirmed.target == TitleUiTarget::overlayConfirm);
    REQUIRE(confirmState.snapshot().applicationExitRequested);
    REQUIRE(confirmState.tryConsumeApplicationExitRequest());
    REQUIRE(!confirmState.tryConsumeApplicationExitRequest());

    TitleOverlayStateMachine sequenceState;
    advanceToInteractiveTitle(sequenceState);
    REQUIRE(sequenceState.apply(UiAction::openExit()).accepted());
    sequenceState.advance(0.5);
    const OverlaySnapshot firstOverlay = overlayOfKind(
        sequenceState.snapshot(),
        OverlayKind::exitConfirm
    );
    const PointD firstCancel = center(dialogFor(
        presentation,
        firstOverlay
    ).cancelButtonRect);
    TitleUiController sequenceController;
    REQUIRE(sequenceController.handlePointer(
        mouseEvent(UiPointerEventType::down, firstCancel, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        sequenceState.snapshot(),
        sequenceState
    ).status == UiInputStatus::captured);
    const UiActionOutcome debug = sequenceState.apply(UiAction::openDebug());
    REQUIRE(debug.accepted());
    const UiInputResult staleRelease = sequenceController.handlePointer(
        mouseEvent(UiPointerEventType::up, firstCancel, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        sequenceState.snapshot(),
        sequenceState
    );
    REQUIRE(staleRelease.status == UiInputStatus::unsupportedOverlayInput);
    REQUIRE(staleRelease.unsupportedOverlay == OverlayKind::debug);
    REQUIRE(staleRelease.overlaySequence == debug.overlaySequence);
    REQUIRE(!sequenceController.snapshot().capture.active);
    REQUIRE(overlayOfKind(
        sequenceState.snapshot(),
        OverlayKind::exitConfirm
    ).phase != OverlayPhase::closing);
}

void testExternalWarningConfirmEffectLockAndAcknowledgement() {
    const Presentation presentation = makePresentation();
    constexpr std::string_view url = "https://jukchang.com/history";
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    const UiActionOutcome opened = state.apply(UiAction::openExternalLink(url));
    REQUIRE(opened.accepted());
    state.advance(0.5);
    const OverlaySnapshot overlay = overlayOfKind(
        state.snapshot(),
        OverlayKind::externalLinkWarning
    );
    const PointD confirmCenter = center(dialogFor(
        presentation,
        overlay
    ).confirmButtonRect);
    TitleUiController controller;
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::down, confirmCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::captured);
    const UiInputResult confirmed = controller.handlePointer(
        mouseEvent(UiPointerEventType::up, confirmCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(confirmed.actionAccepted());
    REQUIRE(confirmed.actionOutcome.effect == UiEffect::openExternalUrl);
    REQUIRE(confirmed.actionOutcome.overlaySequence == opened.overlaySequence);
    REQUIRE(confirmed.actionOutcome.effectText.view() == url);
    const OverlaySnapshot locked = overlayOfKind(
        state.snapshot(),
        OverlayKind::externalLinkWarning
    );
    REQUIRE(locked.interactionsLocked);
    REQUIRE(!locked.acceptsInput);
    const UiInputResult lockedInput = controller.handlePointer(
        mouseEvent(UiPointerEventType::move, confirmCenter),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(lockedInput.status == UiInputStatus::overlayInputLocked);
    REQUIRE(lockedInput.overlaySequence == opened.overlaySequence);

    const UiActionOutcome acknowledged = state.acknowledgeExternalUrl(
        opened.overlaySequence,
        true
    );
    REQUIRE(acknowledged.accepted());
    REQUIRE(overlayOfKind(
        state.snapshot(),
        OverlayKind::externalLinkWarning
    ).phase == OverlayPhase::closing);
}

void testOverlayAppearanceCancelsExistingBaseCapture() {
    const Presentation presentation = makePresentation();
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;
    const PointD startCenter = center(rectForTarget(
        presentation,
        TitleUiTarget::cardStart
    ));
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::down, startCenter, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::captured);
    REQUIRE(state.apply(UiAction::openDebug()).accepted());

    const UiInputResult unsupported = controller.handlePointer(
        mouseEvent(UiPointerEventType::move, startCenter),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(unsupported.status == UiInputStatus::unsupportedOverlayInput);
    REQUIRE(unsupported.controllerStateChanged);
    REQUIRE(!controller.snapshot().capture.active);
    REQUIRE(!interaction(controller.snapshot(), TitleUiTarget::cardStart).pressed);
}

void testTouchIdentityMultiPointerAndCancel() {
    constexpr std::uint64_t firstTouch = 0xFEDCBA9876543210ULL;
    constexpr std::uint64_t secondTouch = 0x0123456789ABCDEFULL;
    const Presentation presentation = makePresentation();
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;
    const PointD deckCenter = center(rectForTarget(
        presentation,
        TitleUiTarget::cardDeck
    ));
    const PointD researchCenter = center(rectForTarget(
        presentation,
        TitleUiTarget::cardResearch
    ));

    REQUIRE(controller.handlePointer(
        touchEvent(UiPointerEventType::down, firstTouch, deckCenter),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::captured);
    REQUIRE(controller.snapshot().capture.pointerId == firstTouch);
    const TitleUiControllerSnapshot captured = controller.snapshot();
    const UiStateSnapshot stateBeforeRejectedPointer = state.snapshot();

    REQUIRE(controller.handlePointer(
        touchEvent(UiPointerEventType::down, secondTouch, researchCenter),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::rejectedAdditionalPointer);
    REQUIRE(controller.snapshot() == captured);
    REQUIRE(state.snapshot() == stateBeforeRejectedPointer);
    REQUIRE(controller.handlePointer(
        touchEvent(UiPointerEventType::up, secondTouch, deckCenter),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::rejectedAdditionalPointer);
    REQUIRE(controller.snapshot() == captured);

    const UiInputResult applied = controller.handlePointer(
        touchEvent(UiPointerEventType::up, firstTouch, deckCenter),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(applied.actionAccepted());
    REQUIRE(hasOverlayKind(state.snapshot(), OverlayKind::deck));

    TitleOverlayStateMachine cancelState;
    advanceToInteractiveTitle(cancelState);
    TitleUiController cancelController;
    REQUIRE(cancelController.handlePointer(
        touchEvent(UiPointerEventType::down, firstTouch, deckCenter),
        presentation.layout,
        presentation.entrance,
        cancelState.snapshot(),
        cancelState
    ).status == UiInputStatus::captured);
    const TitleUiControllerSnapshot beforeWrongCancel = cancelController.snapshot();
    REQUIRE(cancelController.handlePointer(
        touchEvent(UiPointerEventType::cancel, secondTouch),
        presentation.layout,
        presentation.entrance,
        cancelState.snapshot(),
        cancelState
    ).status == UiInputStatus::rejectedAdditionalPointer);
    REQUIRE(cancelController.snapshot() == beforeWrongCancel);
    REQUIRE(cancelController.handlePointer(
        touchEvent(UiPointerEventType::cancel, firstTouch),
        presentation.layout,
        presentation.entrance,
        cancelState.snapshot(),
        cancelState
    ).status == UiInputStatus::cancelled);
    REQUIRE(!cancelController.snapshot().capture.active);
    REQUIRE(cancelState.snapshot().overlayCount == 0U);
}

void testFocusLossAndUnsupportedMouseButtons() {
    const Presentation presentation = makePresentation();
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;
    const PointD point = center(rectForTarget(
        presentation,
        TitleUiTarget::utilityCredits
    ));

    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::down, point, UiPointerButton::right),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::ignoredUnsupportedButton);
    REQUIRE(!controller.snapshot().capture.active);
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::down, point, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::captured);
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::down, point, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::rejectedPointerAlreadyCaptured);

    const UiInputResult lost = controller.handleFocusLost();
    REQUIRE(lost.status == UiInputStatus::focusCancelled);
    REQUIRE(lost.target == TitleUiTarget::utilityCredits);
    REQUIRE(lost.controllerStateChanged);
    REQUIRE(!controller.snapshot().capture.active);
    for (const auto& target : controller.snapshot().targets) {
        REQUIRE(!target.hovered);
        REQUIRE(!target.pressed);
    }

    UiPointerEvent invalidMouse = mouseEvent(
        UiPointerEventType::down,
        point,
        UiPointerButton::left
    );
    invalidMouse.pointerId = 1U;
    REQUIRE(controller.handlePointer(
        invalidMouse,
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::rejectedInvalidInput);
}

void testResizeAndEntranceChangesKeepCaptureIdentity() {
    const Presentation compact = makePresentation();
    const Presentation wide = makePresentation(3'440.0, 1'440.0, 1.25);
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;
    const PointD compactRecords = center(rectForTarget(
        compact,
        TitleUiTarget::cardRecords
    ));
    const PointD wideResearch = center(rectForTarget(
        wide,
        TitleUiTarget::cardResearch
    ));
    const PointD wideRecords = center(rectForTarget(
        wide,
        TitleUiTarget::cardRecords
    ));

    REQUIRE(controller.handlePointer(
        mouseEvent(
            UiPointerEventType::down,
            compactRecords,
            UiPointerButton::left
        ),
        compact.layout,
        compact.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::captured);
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::move, wideResearch),
        wide.layout,
        wide.entrance,
        state.snapshot(),
        state
    ).target == TitleUiTarget::cardResearch);
    REQUIRE(controller.snapshot().capture.target == TitleUiTarget::cardRecords);
    REQUIRE(!interaction(controller.snapshot(), TitleUiTarget::cardRecords).pressed);
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::move, wideRecords),
        wide.layout,
        wide.entrance,
        state.snapshot(),
        state
    ).target == TitleUiTarget::cardRecords);
    REQUIRE(interaction(controller.snapshot(), TitleUiTarget::cardRecords).pressed);

    const UiInputResult applied = controller.handlePointer(
        mouseEvent(UiPointerEventType::up, wideRecords, UiPointerButton::left),
        wide.layout,
        wide.entrance,
        state.snapshot(),
        state
    );
    REQUIRE(applied.actionAccepted());
    REQUIRE(hasOverlayKind(state.snapshot(), OverlayKind::records));
}

void testWindowCloseUsesExitActionSeamAndClearsCapture() {
    const Presentation presentation = makePresentation();
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;
    const PointD start = center(rectForTarget(
        presentation,
        TitleUiTarget::cardStart
    ));
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::down, start, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::captured);

    const UiInputResult close = controller.handleWindowClose(state);
    REQUIRE(close.actionAccepted());
    REQUIRE(close.actionOutcome.status == UiActionStatus::applied);
    REQUIRE(hasOverlayKind(state.snapshot(), OverlayKind::exitConfirm));
    REQUIRE(!controller.snapshot().capture.active);
    const UiInputResult repeated = controller.handleWindowClose(state);
    REQUIRE(repeated.actionAccepted());
    REQUIRE(repeated.actionOutcome.status == UiActionStatus::alreadyActive);
}

void testInvalidAndStaleInputsPreserveBothTransactions() {
    const Presentation presentation = makePresentation();
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;
    const PointD start = center(rectForTarget(
        presentation,
        TitleUiTarget::cardStart
    ));
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::down, start, UiPointerButton::left),
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        state
    ).status == UiInputStatus::captured);

    const auto requireRejectedWithoutMutation = [&](
        const UiPointerEvent& event,
        const UiLayoutSnapshot& layout,
        const TitleEntranceRenderState& entrance,
        const UiStateSnapshot& uiState,
        const UiInputStatus expectedStatus
    ) {
        const TitleUiControllerSnapshot controllerBefore = controller.snapshot();
        const UiStateSnapshot machineBefore = state.snapshot();
        REQUIRE(controller.handlePointer(
            event,
            layout,
            entrance,
            uiState,
            state
        ).status == expectedStatus);
        REQUIRE(controller.snapshot() == controllerBefore);
        REQUIRE(state.snapshot() == machineBefore);
    };

    UiPointerEvent invalidPosition = mouseEvent(UiPointerEventType::move, start);
    invalidPosition.position.x = std::numeric_limits<double>::quiet_NaN();
    requireRejectedWithoutMutation(
        invalidPosition,
        presentation.layout,
        presentation.entrance,
        state.snapshot(),
        UiInputStatus::rejectedInvalidInput
    );

    UiLayoutSnapshot invalidLayout = presentation.layout;
    invalidLayout.title.cards[0].settledRect.width = 0.0;
    requireRejectedWithoutMutation(
        mouseEvent(UiPointerEventType::move, start),
        invalidLayout,
        presentation.entrance,
        state.snapshot(),
        UiInputStatus::rejectedInvalidInput
    );

    TitleEntranceRenderState invalidEntrance = presentation.entrance;
    invalidEntrance.cards[0].slot = TitleCardSlot::research;
    requireRejectedWithoutMutation(
        mouseEvent(UiPointerEventType::move, start),
        presentation.layout,
        invalidEntrance,
        state.snapshot(),
        UiInputStatus::rejectedInvalidInput
    );

    UiStateSnapshot invalidUiState = state.snapshot();
    invalidUiState.overlayCount = 5U;
    requireRejectedWithoutMutation(
        mouseEvent(UiPointerEventType::move, start),
        presentation.layout,
        presentation.entrance,
        invalidUiState,
        UiInputStatus::rejectedInvalidInput
    );

    const UiStateSnapshot stale = state.snapshot();
    state.tick();
    const TitleUiControllerSnapshot beforeStale = controller.snapshot();
    const UiStateSnapshot machineBeforeStale = state.snapshot();
    REQUIRE(controller.handlePointer(
        mouseEvent(UiPointerEventType::move, start),
        presentation.layout,
        presentation.entrance,
        stale,
        state
    ).status == UiInputStatus::rejectedStaleState);
    REQUIRE(controller.snapshot() == beforeStale);
    REQUIRE(state.snapshot() == machineBeforeStale);
}

void testControllerPathsPerformNoHeapAllocation() {
    const Presentation presentation = makePresentation();
    TitleOverlayStateMachine state;
    advanceToInteractiveTitle(state);
    TitleUiController controller;
    TitleOverlayStateMachine actionState;
    advanceToInteractiveTitle(actionState);
    TitleUiController actionController;
    const PointD setting = center(rectForTarget(
        presentation,
        TitleUiTarget::utilitySetting
    ));
    TitleOverlayStateMachine overlayState;
    advanceToInteractiveTitle(overlayState);
    REQUIRE(overlayState.apply(UiAction::openExit()).accepted());
    overlayState.advance(0.5);
    const OverlaySnapshot overlay = overlayOfKind(
        overlayState.snapshot(),
        OverlayKind::exitConfirm
    );
    const PointD overlayCancel = center(dialogFor(
        presentation,
        overlay
    ).cancelButtonRect);
    TitleUiController overlayController;
    TitleOverlayStateMachine directState;
    advanceToInteractiveTitle(directState);
    TitleUiController directController;
    const PointD versionLink = center(rectForTarget(
        presentation,
        TitleUiTarget::versionHistoryLink
    ));
    constexpr std::uint64_t touchId = std::numeric_limits<std::uint64_t>::max();

    allocation_probe::count = 0U;
    allocation_probe::enabled = true;
    const UiInputResult actionDown = actionController.handlePointer(
        touchEvent(UiPointerEventType::down, touchId, setting),
        presentation.layout,
        presentation.entrance,
        actionState.snapshot(),
        actionState
    );
    const UiInputResult actionUp = actionController.handlePointer(
        touchEvent(UiPointerEventType::up, touchId, setting),
        presentation.layout,
        presentation.entrance,
        actionState.snapshot(),
        actionState
    );
    const UiInputResult overlayDown = overlayController.handlePointer(
        mouseEvent(
            UiPointerEventType::down,
            overlayCancel,
            UiPointerButton::left
        ),
        presentation.layout,
        presentation.entrance,
        overlayState.snapshot(),
        overlayState
    );
    const UiInputResult overlayUp = overlayController.handlePointer(
        mouseEvent(
            UiPointerEventType::up,
            overlayCancel,
            UiPointerButton::left
        ),
        presentation.layout,
        presentation.entrance,
        overlayState.snapshot(),
        overlayState
    );
    const UiInputResult direct = directController.handlePointer(
        mouseEvent(
            UiPointerEventType::up,
            versionLink,
            UiPointerButton::left
        ),
        presentation.layout,
        presentation.entrance,
        directState.snapshot(),
        directState
    );
    if (actionDown.status != UiInputStatus::captured
        || !actionUp.actionAccepted()
        || overlayDown.status != UiInputStatus::captured
        || !overlayUp.actionAccepted()
        || direct.actionOutcome.effect != UiEffect::openExternalUrl) {
        std::abort();
    }
    for (std::size_t index = 0U; index < 2'000U; ++index) {
        const UiStateSnapshot uiState = state.snapshot();
        const UiInputResult moved = controller.handlePointer(
            mouseEvent(UiPointerEventType::move, setting),
            presentation.layout,
            presentation.entrance,
            uiState,
            state
        );
        const UiInputResult down = controller.handlePointer(
            touchEvent(UiPointerEventType::down, touchId, setting),
            presentation.layout,
            presentation.entrance,
            state.snapshot(),
            state
        );
        const UiInputResult cancelled = controller.handlePointer(
            touchEvent(UiPointerEventType::cancel, touchId),
            presentation.layout,
            presentation.entrance,
            state.snapshot(),
            state
        );
        const TitleUiControllerSnapshot snapshot = controller.snapshot();
        if (moved.status != UiInputStatus::moved
            || down.status != UiInputStatus::captured
            || cancelled.status != UiInputStatus::cancelled
            || snapshot.capture.active) {
            std::abort();
        }
    }
    allocation_probe::enabled = false;
    REQUIRE(allocation_probe::count == 0U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"exact title target actions", testAllTitleTargetsDispatchExactActions},
        TestCase{"version link direct release", testVersionHistoryLinkUsesMouseReleaseDirectEffectWithoutCapture},
        TestCase{"mouse hover pressed release", testMouseHoverPressedRoundedHitAndReleaseRule},
        TestCase{"title gate and overlay unsupported", testTitleGateAndExplicitUnsupportedOverlayResult},
        TestCase{"exit dialog controls", testExitOverlayCancelConfirmAndSequenceBoundCapture},
        TestCase{"external dialog effect ack", testExternalWarningConfirmEffectLockAndAcknowledgement},
        TestCase{"overlay cancels base capture", testOverlayAppearanceCancelsExistingBaseCapture},
        TestCase{"touch identity and cancel", testTouchIdentityMultiPointerAndCancel},
        TestCase{"focus loss and mouse buttons", testFocusLossAndUnsupportedMouseButtons},
        TestCase{"resize capture identity", testResizeAndEntranceChangesKeepCaptureIdentity},
        TestCase{"window close seam", testWindowCloseUsesExitActionSeamAndClearsCapture},
        TestCase{"invalid transaction", testInvalidAndStaleInputsPreserveBothTransactions},
        TestCase{"zero allocation controller", testControllerPathsPerformNoHeapAllocation}
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
