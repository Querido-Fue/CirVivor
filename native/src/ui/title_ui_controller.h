#pragma once

#include "ui/layout/ui_layout_metrics.h"
#include "ui/title_overlay_content.h"
#include "ui/title_overlay_state_machine.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace cirvivor::ui {

inline constexpr std::size_t title_ui_target_count = 12U;

enum class UiPointerDevice : std::uint8_t {
    mouse,
    touch
};

enum class UiPointerEventType : std::uint8_t {
    move,
    down,
    up,
    cancel
};

enum class UiPointerButton : std::uint8_t {
    none,
    left,
    right,
    middle
};

enum class TitleUiTarget : std::uint8_t {
    none,
    cardStart,
    cardQuickStart,
    cardRecords,
    cardDeck,
    cardResearch,
    utilitySetting,
    utilityCredits,
    utilityAchievements,
    utilityExit,
    versionHistoryLink,
    overlayCancel,
    overlayConfirm
};

enum class UiInputStatus : std::uint8_t {
    moved,
    captured,
    released,
    cancelled,
    focusCancelled,
    actionApplied,
    actionRejected,
    ignoredNoTarget,
    ignoredNoCapture,
    ignoredUnsupportedButton,
    titleInputDisabled,
    overlayInputLocked,
    unsupportedOverlayInput,
    rejectedInvalidInput,
    rejectedStaleState,
    rejectedAdditionalPointer,
    rejectedPointerAlreadyCaptured
};

/** SDL event type에 의존하지 않는 logical UI 좌표 pointer event입니다. */
struct UiPointerEvent final {
    UiPointerEventType type = UiPointerEventType::move;
    UiPointerDevice device = UiPointerDevice::mouse;
    UiPointerButton button = UiPointerButton::none;
    std::uint64_t pointerId = 0U;
    layout::PointD position{};

    constexpr bool operator==(const UiPointerEvent&) const noexcept = default;
};

struct TitleUiTargetInteraction final {
    TitleUiTarget target = TitleUiTarget::none;
    bool hovered = false;
    bool pressed = false;

    constexpr bool operator==(const TitleUiTargetInteraction&) const noexcept = default;
};

struct UiPointerCaptureSnapshot final {
    bool active = false;
    UiPointerDevice device = UiPointerDevice::mouse;
    std::uint64_t pointerId = 0U;
    TitleUiTarget target = TitleUiTarget::none;
    TitleOverlayControlId overlayControlId = TitleOverlayControlId::none;
    std::uint32_t overlaySequence = 0U;
    layout::PointD lastPosition{};

    constexpr bool operator==(const UiPointerCaptureSnapshot&) const noexcept = default;
};

struct TitleUiControllerSnapshot final {
    std::array<TitleUiTargetInteraction, title_ui_target_count> targets{};
    UiPointerCaptureSnapshot capture{};
    /** overlay target hover/press가 어느 attachment에 속하는지 식별합니다. */
    std::uint32_t overlaySequence = 0U;
    TitleOverlayControlId hoveredOverlayControlId = TitleOverlayControlId::none;
    TitleOverlayControlId pressedOverlayControlId = TitleOverlayControlId::none;
    std::uint64_t revision = 0U;

    constexpr bool operator==(const TitleUiControllerSnapshot&) const noexcept = default;
};

struct UiInputResult final {
    UiInputStatus status = UiInputStatus::rejectedInvalidInput;
    TitleUiTarget target = TitleUiTarget::none;
    TitleOverlayControlId overlayControlId = TitleOverlayControlId::none;
    OverlayKind unsupportedOverlay = OverlayKind::none;
    std::uint32_t overlaySequence = 0U;
    UiActionOutcome actionOutcome{};
    bool controllerStateChanged = false;

    [[nodiscard]] bool actionAccepted() const noexcept {
        return status == UiInputStatus::actionApplied
            && actionOutcome.accepted();
    }
};

/**
 * Title layout/render snapshot을 hit-test하고 state machine에 action만 적용하는
 * SDL 비의존 controller입니다. 공통 confirm dialog footer와 title target만
 * hit-test하며 overlay 본문 상호작용은 소유하지 않습니다.
 */
class TitleUiController final {
public:
    TitleUiController() noexcept;

    [[nodiscard]] UiInputResult handlePointer(
        const UiPointerEvent& event,
        const layout::UiLayoutSnapshot& layoutSnapshot,
        const layout::TitleEntranceRenderState& entranceState,
        const UiStateSnapshot& uiState,
        TitleOverlayStateMachine& stateMachine
    ) noexcept;

    /** renderer와 동일한 최종 contentScale 적용 rect snapshot을 소비합니다. */
    [[nodiscard]] UiInputResult handlePointer(
        const UiPointerEvent& event,
        const layout::UiLayoutSnapshot& layoutSnapshot,
        const layout::TitleEntranceRenderState& entranceState,
        const UiStateSnapshot& uiState,
        const TitleOverlayPresentationSet& overlayPresentations,
        TitleOverlayStateMachine& stateMachine
    ) noexcept;

    /** OS window-close를 exit overlay action seam으로 전달합니다. */
    [[nodiscard]] UiInputResult handleWindowClose(
        TitleOverlayStateMachine& stateMachine,
        UiFrameContext context = {}
    ) noexcept;

    /** focus loss시 device/id와 관계없이 hover·capture·pressed를 해제합니다. */
    [[nodiscard]] UiInputResult handleFocusLost() noexcept;

    [[nodiscard]] TitleUiControllerSnapshot snapshot() const noexcept;

private:
    [[nodiscard]] bool commit(TitleUiControllerSnapshot candidate) noexcept;

    TitleUiControllerSnapshot snapshot_{};
};

static_assert(std::is_trivially_copyable_v<UiPointerEvent>);
static_assert(std::is_trivially_copyable_v<TitleUiTargetInteraction>);
static_assert(std::is_trivially_copyable_v<UiPointerCaptureSnapshot>);
static_assert(std::is_trivially_copyable_v<TitleUiControllerSnapshot>);
static_assert(std::is_trivially_copyable_v<UiInputResult>);
static_assert(std::is_standard_layout_v<UiPointerEvent>);
static_assert(std::is_standard_layout_v<TitleUiTargetInteraction>);
static_assert(std::is_standard_layout_v<UiPointerCaptureSnapshot>);
static_assert(std::is_standard_layout_v<TitleUiControllerSnapshot>);
static_assert(std::is_standard_layout_v<UiInputResult>);

} // namespace cirvivor::ui
