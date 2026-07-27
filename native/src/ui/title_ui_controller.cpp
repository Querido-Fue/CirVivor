#include "ui/title_ui_controller.h"
#include "ui/title_link_data.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace cirvivor::ui {
namespace {

constexpr std::array canonical_targets{
    TitleUiTarget::cardStart,
    TitleUiTarget::cardQuickStart,
    TitleUiTarget::cardRecords,
    TitleUiTarget::cardDeck,
    TitleUiTarget::cardResearch,
    TitleUiTarget::utilitySetting,
    TitleUiTarget::utilityCredits,
    TitleUiTarget::utilityAchievements,
    TitleUiTarget::utilityExit,
    TitleUiTarget::versionHistoryLink,
    TitleUiTarget::overlayCancel,
    TitleUiTarget::overlayConfirm
};

struct HitTarget final {
    TitleUiTarget target = TitleUiTarget::none;
    TitleOverlayControlId overlayControlId = TitleOverlayControlId::none;
    TitleOverlayControlAction overlayAction = TitleOverlayControlAction::none;

    [[nodiscard]] constexpr bool hasTarget() const noexcept {
        return target != TitleUiTarget::none
            || overlayControlId != TitleOverlayControlId::none;
    }

    constexpr bool operator==(const HitTarget&) const noexcept = default;
};

[[nodiscard]] bool finiteUnit(const double value) noexcept {
    return std::isfinite(value) && value >= 0.0 && value <= 1.0;
}

[[nodiscard]] bool finiteNonNegative(const double value) noexcept {
    return std::isfinite(value) && value >= 0.0;
}

[[nodiscard]] bool finitePositive(const double value) noexcept {
    return std::isfinite(value) && value > 0.0;
}

[[nodiscard]] bool finitePoint(const layout::PointD& point) noexcept {
    return std::isfinite(point.x) && std::isfinite(point.y);
}

[[nodiscard]] bool finiteRect(const layout::RoundedRectD& rect) noexcept {
    return std::isfinite(rect.x)
        && std::isfinite(rect.y)
        && finitePositive(rect.width)
        && finitePositive(rect.height)
        && finiteNonNegative(rect.radius)
        && std::isfinite(rect.x + rect.width)
        && std::isfinite(rect.y + rect.height);
}

[[nodiscard]] bool finiteTypography(
    const layout::TypographyMetrics& typography
) noexcept {
    return finitePositive(typography.size)
        && finitePositive(typography.lineHeight)
        && typography.weight > 0U;
}

[[nodiscard]] bool validPointerDevice(const UiPointerDevice device) noexcept {
    switch (device) {
    case UiPointerDevice::mouse:
    case UiPointerDevice::touch:
        return true;
    }
    return false;
}

[[nodiscard]] bool validPointerEventType(
    const UiPointerEventType type
) noexcept {
    switch (type) {
    case UiPointerEventType::move:
    case UiPointerEventType::down:
    case UiPointerEventType::up:
    case UiPointerEventType::cancel:
        return true;
    }
    return false;
}

[[nodiscard]] bool validPointerButton(const UiPointerButton button) noexcept {
    switch (button) {
    case UiPointerButton::none:
    case UiPointerButton::left:
    case UiPointerButton::right:
    case UiPointerButton::middle:
        return true;
    }
    return false;
}

[[nodiscard]] bool validPointerEvent(const UiPointerEvent& event) noexcept {
    if (!validPointerDevice(event.device)
        || !validPointerEventType(event.type)
        || !validPointerButton(event.button)
        || (event.device == UiPointerDevice::mouse && event.pointerId != 0)) {
        return false;
    }

    if (event.type != UiPointerEventType::cancel
        && !finitePoint(event.position)) {
        return false;
    }

    if (event.device == UiPointerDevice::touch) {
        return event.button == UiPointerButton::none;
    }
    if (event.type == UiPointerEventType::move
        || event.type == UiPointerEventType::cancel) {
        return event.button == UiPointerButton::none;
    }
    return event.button != UiPointerButton::none;
}

[[nodiscard]] bool validTitlePhase(const TitlePhase phase) noexcept {
    switch (phase) {
    case TitlePhase::loadingDelay:
    case TitlePhase::logoPlayback:
    case TitlePhase::sceneTransition:
    case TitlePhase::interactive:
        return true;
    }
    return false;
}

[[nodiscard]] bool validOverlayKind(const OverlayKind kind) noexcept {
    return kind >= OverlayKind::mapSelect
        && kind <= OverlayKind::externalLinkWarning;
}

[[nodiscard]] bool validOverlayKey(const OverlayKey key) noexcept {
    return key >= OverlayKey::titleMenu
        && key <= OverlayKey::externalLinkWarning;
}

[[nodiscard]] bool validOverlayPhase(const OverlayPhase phase) noexcept {
    switch (phase) {
    case OverlayPhase::opening:
    case OverlayPhase::open:
    case OverlayPhase::closing:
        return true;
    }
    return false;
}

[[nodiscard]] bool validUiState(const UiStateSnapshot& state) noexcept {
    if (!validTitlePhase(state.title.phase)
        || !finiteNonNegative(state.title.elapsedSeconds)
        || !finiteNonNegative(state.title.phaseElapsedSeconds)
        || !finiteUnit(state.title.phaseProgress)
        || !finiteUnit(state.title.logoPlaybackProgress)
        || !finiteUnit(state.title.sceneTransitionProgress)
        || !finiteUnit(state.title.menuRevealProgress)
        || state.overlayCount > maximum_overlay_count
        || (state.overlayCount > 0U && state.titleInputEnabled)) {
        return false;
    }

    for (std::size_t index = 0U; index < state.overlayCount; ++index) {
        const OverlaySnapshot& overlay = state.overlays[index];
        if (!validOverlayKind(overlay.kind)
            || !validOverlayKey(overlay.key)
            || !validOverlayPhase(overlay.phase)
            || overlay.sequence == 0U
            || !finiteNonNegative(overlay.phaseElapsedSeconds)
            || !finiteUnit(overlay.phaseProgress)
            || !finiteUnit(overlay.alpha)
            || !finiteUnit(overlay.dimAlpha)
            || !finitePositive(overlay.contentScale)
            || !finiteNonNegative(overlay.contentBlur)
            || overlay.externalUrl.length > maximum_external_url_bytes
            || overlay.externalUrl.bytes[overlay.externalUrl.length] != '\0') {
            return false;
        }
        for (std::size_t previous = 0U; previous < index; ++previous) {
            if (state.overlays[previous].sequence == overlay.sequence) {
                return false;
            }
        }
    }
    return true;
}

[[nodiscard]] bool validCardSlot(const layout::TitleCardSlot slot) noexcept {
    return slot >= layout::TitleCardSlot::start
        && slot <= layout::TitleCardSlot::research;
}

[[nodiscard]] bool validUtilitySlot(
    const layout::UtilityTileSlot slot
) noexcept {
    return slot >= layout::UtilityTileSlot::setting
        && slot <= layout::UtilityTileSlot::exit;
}

[[nodiscard]] bool validGeometry(
    const layout::UiLayoutSnapshot& layoutSnapshot,
    const layout::TitleEntranceRenderState& entranceState
) noexcept {
    const layout::ViewportMetrics& viewport = layoutSnapshot.viewport;
    if (layoutSnapshot.revision == 0U
        || !finitePositive(viewport.ww)
        || !finitePositive(viewport.wh)
        || !finitePositive(viewport.uiww)
        || !finitePositive(viewport.uiScale)
        || !finiteRect(viewport.safeAreaRect)
        || !finiteRect(viewport.logicalUiRect)
        || !finiteNonNegative(entranceState.elapsedSeconds)
        || !finiteUnit(entranceState.transitionProgress)
        || !finiteUnit(entranceState.transitionEase)
        || !finiteNonNegative(entranceState.revealClockElapsedSeconds)
        || !finitePositive(entranceState.worldScale)
        || !finiteRect(entranceState.cardPane.panelRect)
        || !finiteUnit(entranceState.cardPane.alpha)
        || !finiteRect(entranceState.utilityPane.panelRect)
        || !finiteUnit(entranceState.utilityPane.alpha)) {
        return false;
    }

    std::array<bool, layout::title_card_count> seenCards{};
    for (std::size_t index = 0U; index < layout::title_card_count; ++index) {
        const layout::TitleCardMetrics& source = layoutSnapshot.title.cards[index];
        const layout::TitleCardRenderMetrics& rendered = entranceState.cards[index];
        if (!validCardSlot(source.slot)
            || rendered.slot != source.slot
            || !finiteRect(source.settledRect)
            || !finiteRect(rendered.panelRect)
            || !finiteUnit(rendered.revealProgress)
            || !finiteUnit(rendered.revealEase)
            || !finiteUnit(rendered.alpha)
            || !finitePositive(rendered.entryScale)
            || !std::isfinite(rendered.startOffsetX)
            || !std::isfinite(rendered.offscreenStartX)
            || !finiteTypography(rendered.titleTypography)
            || !finiteTypography(rendered.descriptionTypography)
            || rendered.hasDescription != source.hasDescription) {
            return false;
        }
        const std::size_t slotIndex = static_cast<std::size_t>(source.slot);
        if (slotIndex >= seenCards.size() || seenCards[slotIndex]) {
            return false;
        }
        seenCards[slotIndex] = true;
    }

    std::array<bool, layout::utility_tile_count> seenTiles{};
    for (std::size_t index = 0U; index < layout::utility_tile_count; ++index) {
        const layout::UtilityTileMetrics& source =
            layoutSnapshot.title.utilityTiles[index];
        const layout::UtilityTileRenderMetrics& rendered =
            entranceState.utilityTiles[index];
        if (!validUtilitySlot(source.slot)
            || rendered.slot != source.slot
            || !finiteRect(source.rect)
            || !finiteRect(rendered.panelRect)
            || !finiteUnit(rendered.revealProgress)
            || !finiteUnit(rendered.revealEase)
            || !finiteUnit(rendered.alpha)
            || !std::isfinite(rendered.translateX)
            || !std::isfinite(rendered.translateY)
            || !finitePositive(rendered.placeholderSize)) {
            return false;
        }
        const std::size_t slotIndex = static_cast<std::size_t>(source.slot);
        if (slotIndex >= seenTiles.size() || seenTiles[slotIndex]) {
            return false;
        }
        seenTiles[slotIndex] = true;
    }
    const layout::TitleVersionHistoryLinkMetrics& sourceLink =
        layoutSnapshot.title.versionHistoryLink;
    const layout::TitleVersionHistoryLinkRenderMetrics& renderedLink =
        entranceState.versionHistoryLink;
    if (sourceLink.available != renderedLink.available) {
        return false;
    }
    if (sourceLink.available
        && (!finitePoint(sourceLink.textAnchor)
            || !finiteRect(sourceLink.iconRect)
            || !finiteRect(sourceLink.hitRect)
            || !finiteUnit(renderedLink.alpha)
            || !finitePoint(renderedLink.textAnchor)
            || !finiteRect(renderedLink.iconRect)
            || !finiteRect(renderedLink.hitRect))) {
        return false;
    }
    return true;
}

[[nodiscard]] TitleUiTarget targetForCardSlot(
    const layout::TitleCardSlot slot
) noexcept {
    switch (slot) {
    case layout::TitleCardSlot::start:
        return TitleUiTarget::cardStart;
    case layout::TitleCardSlot::quickStart:
        return TitleUiTarget::cardQuickStart;
    case layout::TitleCardSlot::records:
        return TitleUiTarget::cardRecords;
    case layout::TitleCardSlot::deck:
        return TitleUiTarget::cardDeck;
    case layout::TitleCardSlot::research:
        return TitleUiTarget::cardResearch;
    }
    return TitleUiTarget::none;
}

[[nodiscard]] TitleUiTarget targetForUtilitySlot(
    const layout::UtilityTileSlot slot
) noexcept {
    switch (slot) {
    case layout::UtilityTileSlot::setting:
        return TitleUiTarget::utilitySetting;
    case layout::UtilityTileSlot::credits:
        return TitleUiTarget::utilityCredits;
    case layout::UtilityTileSlot::achievements:
        return TitleUiTarget::utilityAchievements;
    case layout::UtilityTileSlot::exit:
        return TitleUiTarget::utilityExit;
    }
    return TitleUiTarget::none;
}

[[nodiscard]] bool pointInsideRoundedRect(
    const layout::PointD& point,
    const layout::RoundedRectD& rect
) noexcept {
    if (point.x < rect.x
        || point.x > rect.x + rect.width
        || point.y < rect.y
        || point.y > rect.y + rect.height) {
        return false;
    }

    const double radius = std::clamp(
        rect.radius,
        0.0,
        std::min(rect.width, rect.height) * 0.5
    );
    if (radius <= 0.0) {
        return true;
    }
    const double localX = point.x - rect.x;
    const double localY = point.y - rect.y;
    const double nearestX = std::clamp(localX, radius, rect.width - radius);
    const double nearestY = std::clamp(localY, radius, rect.height - radius);
    return std::hypot(localX - nearestX, localY - nearestY) <= radius;
}

[[nodiscard]] TitleUiTarget hitTarget(
    const layout::UiLayoutSnapshot& layoutSnapshot,
    const layout::TitleEntranceRenderState& entranceState,
    const layout::PointD& position
) noexcept {
    // JS oracle와 같이 나중에 그려진 card를 먼저 판정하고,
    // card가 포인터를 점유하면 utility tile은 판정하지 않는다.
    for (std::size_t reverse = layout::title_card_count; reverse > 0U; --reverse) {
        const std::size_t index = reverse - 1U;
        const layout::TitleCardRenderMetrics& rendered = entranceState.cards[index];
        if (rendered.alpha > 0.75
            && pointInsideRoundedRect(position, rendered.panelRect)) {
            return targetForCardSlot(layoutSnapshot.title.cards[index].slot);
        }
    }
    for (std::size_t reverse = layout::utility_tile_count; reverse > 0U; --reverse) {
        const std::size_t index = reverse - 1U;
        const layout::UtilityTileRenderMetrics& rendered =
            entranceState.utilityTiles[index];
        if (rendered.alpha > 0.75
            && pointInsideRoundedRect(position, rendered.panelRect)) {
            return targetForUtilitySlot(
                layoutSnapshot.title.utilityTiles[index].slot
            );
        }
    }
    if (entranceState.versionHistoryLink.available
        && entranceState.versionHistoryLink.alpha > 0.75
        && pointInsideRoundedRect(
            position,
            entranceState.versionHistoryLink.hitRect
        )) {
        return TitleUiTarget::versionHistoryLink;
    }
    return TitleUiTarget::none;
}

[[nodiscard]] HitTarget hitOverlayTarget(
    const TitleOverlayPresentation& presentation,
    const layout::PointD& position
) noexcept {
    const TitleOverlayControl* const control = hitTestTitleOverlayControl(
        presentation,
        position
    );
    if (control == nullptr) {
        return {};
    }
    if (control->action == TitleOverlayControlAction::confirmTop) {
        return {
            TitleUiTarget::overlayConfirm,
            control->id,
            control->action
        };
    }
    if (control->action == TitleOverlayControlAction::cancelTop) {
        return {
            TitleUiTarget::overlayCancel,
            control->id,
            control->action
        };
    }
    if (control->action == TitleOverlayControlAction::openExternalLink) {
        return {
            TitleUiTarget::none,
            control->id,
            control->action
        };
    }
    return {};
}

void setHovered(
    TitleUiControllerSnapshot& snapshot,
    const TitleUiTarget target,
    const TitleOverlayControlId overlayControlId = TitleOverlayControlId::none
) noexcept {
    for (TitleUiTargetInteraction& state : snapshot.targets) {
        state.hovered = state.target == target;
    }
    snapshot.hoveredOverlayControlId = overlayControlId;
}

void setPressed(
    TitleUiControllerSnapshot& snapshot,
    const TitleUiTarget target,
    const bool pressed,
    const TitleOverlayControlId overlayControlId = TitleOverlayControlId::none
) noexcept {
    for (TitleUiTargetInteraction& state : snapshot.targets) {
        state.pressed = pressed && state.target == target;
    }
    snapshot.pressedOverlayControlId = pressed
        ? overlayControlId
        : TitleOverlayControlId::none;
}

void clearInteraction(TitleUiControllerSnapshot& snapshot) noexcept {
    setHovered(snapshot, TitleUiTarget::none);
    setPressed(snapshot, TitleUiTarget::none, false);
    snapshot.capture = {};
    snapshot.overlaySequence = 0U;
}

[[nodiscard]] bool pointerMatches(
    const UiPointerCaptureSnapshot& capture,
    const UiPointerEvent& event
) noexcept {
    return capture.active
        && capture.device == event.device
        && capture.pointerId == event.pointerId;
}

[[nodiscard]] bool actionForTarget(
    const TitleUiTarget target,
    UiAction& action
) noexcept {
    switch (target) {
    case TitleUiTarget::cardStart:
        action = UiAction::openTitle(OverlayKind::mapSelect);
        return true;
    case TitleUiTarget::cardQuickStart:
        action = UiAction::openTitle(OverlayKind::quickStart);
        return true;
    case TitleUiTarget::cardRecords:
        action = UiAction::openTitle(OverlayKind::records);
        return true;
    case TitleUiTarget::cardDeck:
        action = UiAction::openTitle(OverlayKind::deck);
        return true;
    case TitleUiTarget::cardResearch:
        action = UiAction::openTitle(OverlayKind::research);
        return true;
    case TitleUiTarget::utilitySetting:
        action = UiAction::openTitle(OverlayKind::setting);
        return true;
    case TitleUiTarget::utilityCredits:
        action = UiAction::openTitle(OverlayKind::credits);
        return true;
    case TitleUiTarget::utilityAchievements:
        action = UiAction::openTitle(OverlayKind::achievements);
        return true;
    case TitleUiTarget::utilityExit:
        action = UiAction::openExit();
        return true;
    case TitleUiTarget::versionHistoryLink:
        action = UiAction::openExternalLink(
            cirvivor::ui::data::title_version_history_url
        );
        return true;
    case TitleUiTarget::overlayCancel:
        action = UiAction::cancelTop();
        return true;
    case TitleUiTarget::overlayConfirm:
        action = UiAction::confirmTop();
        return true;
    case TitleUiTarget::none:
        return false;
    }
    return false;
}

[[nodiscard]] const OverlaySnapshot* latestOverlay(
    const UiStateSnapshot& state
) noexcept {
    const OverlaySnapshot* result = nullptr;
    for (std::size_t index = 0U; index < state.overlayCount; ++index) {
        if (result == nullptr
            || state.overlays[index].sequence > result->sequence) {
            result = &state.overlays[index];
        }
    }
    return result;
}

} // namespace

TitleUiController::TitleUiController() noexcept {
    for (std::size_t index = 0U; index < canonical_targets.size(); ++index) {
        snapshot_.targets[index].target = canonical_targets[index];
    }
}

UiInputResult TitleUiController::handlePointer(
    const UiPointerEvent& event,
    const layout::UiLayoutSnapshot& layoutSnapshot,
    const layout::TitleEntranceRenderState& entranceState,
    const UiStateSnapshot& uiState,
    TitleOverlayStateMachine& stateMachine
) noexcept {
    TitleOverlayPresentationSet presentations{};
    if (!tryBuildTitleOverlayPresentationSet(
            uiState,
            layoutSnapshot,
            presentations)) {
        return {.status = UiInputStatus::rejectedInvalidInput};
    }
    return handlePointer(
        event,
        layoutSnapshot,
        entranceState,
        uiState,
        presentations,
        stateMachine
    );
}

UiInputResult TitleUiController::handlePointer(
    const UiPointerEvent& event,
    const layout::UiLayoutSnapshot& layoutSnapshot,
    const layout::TitleEntranceRenderState& entranceState,
    const UiStateSnapshot& uiState,
    const TitleOverlayPresentationSet& overlayPresentations,
    TitleOverlayStateMachine& stateMachine
) noexcept {
    if (!validPointerEvent(event) || !validUiState(uiState)) {
        return {.status = UiInputStatus::rejectedInvalidInput};
    }
    if (stateMachine.snapshot() != uiState) {
        return {.status = UiInputStatus::rejectedStaleState};
    }
    if (overlayPresentations.stateRevision != uiState.revision
        || overlayPresentations.layoutRevision != layoutSnapshot.revision
        || overlayPresentations.overlayCount != uiState.overlayCount) {
        return {.status = UiInputStatus::rejectedStaleState};
    }

    TitleUiControllerSnapshot candidate = snapshot_;
    const OverlaySnapshot* activeOverlay = nullptr;
    const TitleOverlayPresentation* activePresentation = nullptr;
    std::uint32_t activeOverlaySequence = 0U;
    if (uiState.overlayCount > 0U) {
        activePresentation = findLatestTitleOverlayPresentation(
            overlayPresentations
        );
        if (activePresentation == nullptr) {
            const OverlaySnapshot* const latest = latestOverlay(uiState);
            clearInteraction(candidate);
            const bool changed = commit(candidate);
            return {
                .status = UiInputStatus::overlayInputLocked,
                .overlaySequence = latest == nullptr ? 0U : latest->sequence,
                .controllerStateChanged = changed
            };
        }
        for (std::size_t index = 0U; index < uiState.overlayCount; ++index) {
            if (uiState.overlays[index].sequence == activePresentation->sequence) {
                activeOverlay = &uiState.overlays[index];
                break;
            }
        }
        if (activeOverlay == nullptr
            || activeOverlay->kind != activePresentation->kind
            || activeOverlay->sequence == 0U) {
            return {.status = UiInputStatus::rejectedInvalidInput};
        }
        activeOverlaySequence = activeOverlay->sequence;
        if (!activeOverlay->acceptsInput || activeOverlay->interactionsLocked) {
            clearInteraction(candidate);
            const bool changed = commit(candidate);
            return {
                .status = UiInputStatus::overlayInputLocked,
                .overlaySequence = activeOverlaySequence,
                .controllerStateChanged = changed
            };
        }
        if (layoutSnapshot.revision == 0U
            || !finiteRect(activePresentation->panelRect)) {
            return {.status = UiInputStatus::rejectedInvalidInput};
        }
        if (candidate.capture.active
            && candidate.capture.overlaySequence != activeOverlaySequence) {
            clearInteraction(candidate);
        }
        candidate.overlaySequence = activeOverlaySequence;
    } else if (!uiState.titleInputEnabled) {
        clearInteraction(candidate);
        const bool changed = commit(candidate);
        return {
            .status = UiInputStatus::titleInputDisabled,
            .controllerStateChanged = changed
        };
    } else {
        if (candidate.capture.active && candidate.capture.overlaySequence != 0U) {
            clearInteraction(candidate);
        }
        candidate.overlaySequence = 0U;
    }
    if (event.device == UiPointerDevice::mouse
        && (event.button == UiPointerButton::right
            || event.button == UiPointerButton::middle)) {
        return {
            .status = UiInputStatus::ignoredUnsupportedButton,
            .overlaySequence = activeOverlaySequence
        };
    }

    if (event.type == UiPointerEventType::cancel) {
        if (!candidate.capture.active) {
            setHovered(candidate, TitleUiTarget::none);
            setPressed(candidate, TitleUiTarget::none, false);
            const bool changed = commit(candidate);
            return {
                .status = UiInputStatus::ignoredNoCapture,
                .overlaySequence = activeOverlaySequence,
                .controllerStateChanged = changed
            };
        }
        if (!pointerMatches(candidate.capture, event)) {
            return {
                .status = UiInputStatus::rejectedAdditionalPointer,
                .overlaySequence = activeOverlaySequence
            };
        }
        const TitleUiTarget capturedTarget = candidate.capture.target;
        const TitleOverlayControlId capturedControlId =
            candidate.capture.overlayControlId;
        clearInteraction(candidate);
        const bool changed = commit(candidate);
        return {
            .status = UiInputStatus::cancelled,
            .target = capturedTarget,
            .overlayControlId = capturedControlId,
            .overlaySequence = activeOverlaySequence,
            .controllerStateChanged = changed
        };
    }
    if (activeOverlay == nullptr
        && !validGeometry(layoutSnapshot, entranceState)) {
        return {.status = UiInputStatus::rejectedInvalidInput};
    }

    HitTarget hit = activeOverlay != nullptr
        ? hitOverlayTarget(*activePresentation, event.position)
        : HitTarget{
            hitTarget(layoutSnapshot, entranceState, event.position),
            TitleOverlayControlId::none,
            TitleOverlayControlAction::none
        };
    if (event.device == UiPointerDevice::touch
        && hit.target == TitleUiTarget::versionHistoryLink) {
        hit = {};
    }

    if (event.type == UiPointerEventType::move) {
        if (candidate.capture.active) {
            if (!pointerMatches(candidate.capture, event)) {
                return {
                    .status = UiInputStatus::rejectedAdditionalPointer,
                    .overlaySequence = activeOverlaySequence
                };
            }
            candidate.capture.lastPosition = event.position;
            setHovered(candidate, hit.target, hit.overlayControlId);
            const bool captureStillHit =
                hit.target == candidate.capture.target
                && hit.overlayControlId == candidate.capture.overlayControlId;
            setPressed(
                candidate,
                candidate.capture.target,
                captureStillHit,
                candidate.capture.overlayControlId
            );
        } else {
            if (event.device == UiPointerDevice::touch) {
                setHovered(candidate, TitleUiTarget::none);
                setPressed(candidate, TitleUiTarget::none, false);
                const bool changed = commit(candidate);
                return {
                    .status = UiInputStatus::ignoredNoCapture,
                    .overlaySequence = activeOverlaySequence,
                    .controllerStateChanged = changed
                };
            }
            setHovered(candidate, hit.target, hit.overlayControlId);
            setPressed(candidate, TitleUiTarget::none, false);
        }
        const bool changed = commit(candidate);
        return {
            .status = UiInputStatus::moved,
            .target = hit.target,
            .overlayControlId = hit.overlayControlId,
            .overlaySequence = activeOverlaySequence,
            .controllerStateChanged = changed
        };
    }

    if (event.type == UiPointerEventType::down) {
        if (candidate.capture.active) {
            return {
                .status = pointerMatches(candidate.capture, event)
                    ? UiInputStatus::rejectedPointerAlreadyCaptured
                    : UiInputStatus::rejectedAdditionalPointer,
                .target = candidate.capture.target,
                .overlayControlId = candidate.capture.overlayControlId,
                .overlaySequence = activeOverlaySequence
            };
        }
        if (hit.target == TitleUiTarget::versionHistoryLink) {
            setHovered(candidate, hit.target, hit.overlayControlId);
            setPressed(candidate, TitleUiTarget::none, false);
            const bool changed = commit(candidate);
            return {
                .status = UiInputStatus::ignoredNoCapture,
                .target = hit.target,
                .controllerStateChanged = changed
            };
        }
        setHovered(candidate, hit.target, hit.overlayControlId);
        if (!hit.hasTarget()) {
            setPressed(candidate, TitleUiTarget::none, false);
            const bool changed = commit(candidate);
            return {
                .status = UiInputStatus::ignoredNoTarget,
                .overlaySequence = activeOverlaySequence,
                .controllerStateChanged = changed
            };
        }
        candidate.capture = {
            .active = true,
            .device = event.device,
            .pointerId = event.pointerId,
            .target = hit.target,
            .overlayControlId = hit.overlayControlId,
            .overlaySequence = activeOverlaySequence,
            .lastPosition = event.position
        };
        setPressed(candidate, hit.target, true, hit.overlayControlId);
        const bool changed = commit(candidate);
        return {
            .status = UiInputStatus::captured,
            .target = hit.target,
            .overlayControlId = hit.overlayControlId,
            .overlaySequence = activeOverlaySequence,
            .controllerStateChanged = changed
        };
    }

    if (!candidate.capture.active
        && hit.target == TitleUiTarget::versionHistoryLink) {
        setHovered(candidate, hit.target, hit.overlayControlId);
        setPressed(candidate, TitleUiTarget::none, false);
        const UiActionOutcome actionOutcome = stateMachine.apply(
            UiAction::openExternalLink(
                cirvivor::ui::data::title_version_history_url
            )
        );
        const bool changed = commit(candidate);
        return {
            .status = actionOutcome.accepted()
                ? UiInputStatus::actionApplied
                : UiInputStatus::actionRejected,
            .target = hit.target,
            .actionOutcome = actionOutcome,
            .controllerStateChanged = changed
        };
    }

    if (!candidate.capture.active) {
        if (event.device == UiPointerDevice::mouse) {
            setHovered(candidate, hit.target, hit.overlayControlId);
        } else {
            setHovered(candidate, TitleUiTarget::none);
        }
        setPressed(candidate, TitleUiTarget::none, false);
        const bool changed = commit(candidate);
        return {
            .status = UiInputStatus::ignoredNoCapture,
            .target = hit.target,
            .overlayControlId = hit.overlayControlId,
            .overlaySequence = activeOverlaySequence,
            .controllerStateChanged = changed
        };
    }
    if (!pointerMatches(candidate.capture, event)) {
        return {
            .status = UiInputStatus::rejectedAdditionalPointer,
            .target = candidate.capture.target,
            .overlayControlId = candidate.capture.overlayControlId,
            .overlaySequence = activeOverlaySequence
        };
    }

    const TitleUiTarget capturedTarget = candidate.capture.target;
    const TitleOverlayControlId capturedControlId =
        candidate.capture.overlayControlId;
    candidate.capture = {};
    setPressed(candidate, TitleUiTarget::none, false);
    setHovered(
        candidate,
        event.device == UiPointerDevice::mouse
            ? hit.target
            : TitleUiTarget::none,
        event.device == UiPointerDevice::mouse
            ? hit.overlayControlId
            : TitleOverlayControlId::none
    );
    if (hit.target != capturedTarget
        || hit.overlayControlId != capturedControlId) {
        const bool changed = commit(candidate);
        return {
            .status = UiInputStatus::released,
            .target = capturedTarget,
            .overlayControlId = capturedControlId,
            .overlaySequence = activeOverlaySequence,
            .controllerStateChanged = changed
        };
    }

    UiAction action{};
    if (hit.overlayAction == TitleOverlayControlAction::openExternalLink) {
        const std::string_view url = data::titleCreditsExternalUrl(
            capturedControlId
        );
        if (url.empty()) {
            const bool changed = commit(candidate);
            return {
                .status = UiInputStatus::released,
                .target = capturedTarget,
                .overlayControlId = capturedControlId,
                .overlaySequence = activeOverlaySequence,
                .controllerStateChanged = changed
            };
        }
        action = UiAction::openExternalLink(url);
    } else if (!actionForTarget(capturedTarget, action)) {
        return {.status = UiInputStatus::rejectedInvalidInput};
    }
    const UiActionOutcome actionOutcome = stateMachine.apply(action);
    if (actionOutcome.accepted()) {
        clearInteraction(candidate);
    }
    const bool changed = commit(candidate);
    return {
        .status = actionOutcome.accepted()
            ? UiInputStatus::actionApplied
            : UiInputStatus::actionRejected,
        .target = capturedTarget,
        .overlayControlId = capturedControlId,
        .overlaySequence = activeOverlaySequence,
        .actionOutcome = actionOutcome,
        .controllerStateChanged = changed
    };
}

UiInputResult TitleUiController::handleWindowClose(
    TitleOverlayStateMachine& stateMachine,
    const UiFrameContext context
) noexcept {
    TitleUiControllerSnapshot candidate = snapshot_;
    clearInteraction(candidate);
    const UiActionOutcome actionOutcome = stateMachine.apply(
        UiAction::windowClose(),
        context
    );
    const bool changed = commit(candidate);
    return {
        .status = actionOutcome.accepted()
            ? UiInputStatus::actionApplied
            : UiInputStatus::actionRejected,
        .actionOutcome = actionOutcome,
        .controllerStateChanged = changed
    };
}

UiInputResult TitleUiController::handleFocusLost() noexcept {
    TitleUiControllerSnapshot candidate = snapshot_;
    const TitleUiTarget capturedTarget = candidate.capture.target;
    clearInteraction(candidate);
    const bool changed = commit(candidate);
    return {
        .status = UiInputStatus::focusCancelled,
        .target = capturedTarget,
        .controllerStateChanged = changed
    };
}

TitleUiControllerSnapshot TitleUiController::snapshot() const noexcept {
    return snapshot_;
}

bool TitleUiController::commit(TitleUiControllerSnapshot candidate) noexcept {
    candidate.revision = snapshot_.revision;
    if (candidate == snapshot_) {
        return false;
    }
    if (candidate.revision < std::numeric_limits<std::uint64_t>::max()) {
        ++candidate.revision;
    }
    snapshot_ = candidate;
    return true;
}

} // namespace cirvivor::ui
