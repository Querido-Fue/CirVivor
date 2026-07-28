#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <type_traits>

namespace cirvivor::debug {

inline constexpr std::size_t required_middle_release_count = 3U;
inline constexpr std::uint64_t debug_toggle_window_milliseconds = 2'000U;
inline constexpr std::uint32_t unlimited_gameplay_fixed_steps =
    std::numeric_limits<std::uint32_t>::max();

enum class DebugOverlayIntent : std::uint8_t {
    none,
    open,
    close
};

enum class DebugDisplayOption : std::uint8_t {
    frameTime,
    poolInfo,
    hitboxes,
    animationDebug,
    count
};

enum class DebugPointerPhase : std::uint8_t {
    middlePressed,
    middleReleased,
    cancelled
};

enum class DebugPointerStatus : std::uint8_t {
    captured,
    released,
    gestureReset,
    debugModeToggled,
    ignoredDuplicatePress,
    ignoredAdditionalPointer,
    ignoredUnmatchedRelease,
    rejectedInvalidPhase,
    rejectedNonMonotonicClick
};

enum class DebugKey : std::uint8_t {
    pauseSlash,
    stepPeriod,
    count
};

enum class DebugKeyPhase : std::uint8_t {
    pressed,
    released
};

enum class DebugKeyStatus : std::uint8_t {
    pauseToggled,
    stepQueued,
    released,
    ignoredRepeat,
    ignoredDuplicatePress,
    ignoredInactive,
    ignoredNotPaused,
    ignoredStepAlreadyPending,
    ignoredReleaseWithoutPress,
    rejectedInvalidInput
};

enum class DebugFrameMode : std::uint8_t {
    running,
    paused,
    singleStep
};

/**
 * 외부 설정 저장과 전역 debug overlay 조립을 Application에 위임하는 effect입니다.
 * controller는 UI state machine이나 저장소를 직접 소유하지 않습니다.
 */
struct DebugRuntimeEffect final {
    DebugOverlayIntent overlayIntent = DebugOverlayIntent::none;
    bool debugModeChanged = false;
    bool persistDebugMode = false;
    bool debugModeEnabled = false;
    std::uint64_t stateRevision = 0U;

    constexpr bool operator==(const DebugRuntimeEffect&) const noexcept = default;
};

struct DebugPointerResult final {
    DebugPointerStatus status = DebugPointerStatus::rejectedInvalidPhase;
    DebugRuntimeEffect effect{};
    bool stateChanged = false;

    constexpr bool operator==(const DebugPointerResult&) const noexcept = default;
};

struct DebugKeyResult final {
    DebugKeyStatus status = DebugKeyStatus::rejectedInvalidInput;
    bool stateChanged = false;

    constexpr bool operator==(const DebugKeyResult&) const noexcept = default;
};

/**
 * 한 display frame에서 각 계층을 실행할지 나타내는 one-shot effect입니다.
 * pause는 gameplay update만 막고 UI update와 render는 항상 계속 허용합니다.
 */
struct DebugFrameEffect final {
    DebugFrameMode mode = DebugFrameMode::running;
    bool runGameplayUpdate = true;
    std::uint32_t maximumGameplayFixedSteps = unlimited_gameplay_fixed_steps;
    bool runUiUpdate = true;
    bool runRender = true;

    constexpr bool operator==(const DebugFrameEffect&) const noexcept = default;
};

struct DebugRuntimeSnapshot final {
    std::array<bool, static_cast<std::size_t>(DebugDisplayOption::count)>
        displayOptions{true, true, true, false};
    bool debugModeEnabled = false;
    bool animationPaused = false;
    bool singleStepPending = false;
    bool middlePressCaptured = false;
    std::uint64_t middlePointerId = 0U;
    std::uint8_t recentMiddleReleaseCount = 0U;
    std::uint64_t revision = 0U;

    constexpr bool operator==(const DebugRuntimeSnapshot&) const noexcept = default;
};

/**
 * JS/NW 런타임과 무관한 native debug 입력·표시·frame 정책 상태기입니다.
 * 모든 저장소는 고정 용량이며 public 연산은 예외를 던지지 않습니다.
 */
class DebugRuntimeController final {
public:
    explicit DebugRuntimeController(bool debugModeEnabled = false) noexcept;

    [[nodiscard]] DebugPointerResult handleMiddlePointer(
        DebugPointerPhase phase,
        std::uint64_t pointerId,
        std::uint64_t timestampMilliseconds
    ) noexcept;

    /** focus loss는 gesture와 눌린 debug key edge를 함께 지웁니다. */
    [[nodiscard]] bool handleFocusLost() noexcept;

    /** binding 교체 시 gesture·pause 상태를 보존하고 held key만 지웁니다. */
    [[nodiscard]] bool clearKeyState() noexcept;

    /** 외부 설정 변경을 적용하되 다시 저장하라는 effect는 만들지 않습니다. */
    [[nodiscard]] DebugRuntimeEffect applyDebugMode(bool enabled) noexcept;

    [[nodiscard]] bool setDisplayOption(
        DebugDisplayOption option,
        bool enabled
    ) noexcept;
    [[nodiscard]] bool toggleDisplayOption(DebugDisplayOption option) noexcept;
    [[nodiscard]] bool displayOptionEnabled(
        DebugDisplayOption option
    ) const noexcept;
    [[nodiscard]] bool displayOptionActive(
        DebugDisplayOption option
    ) const noexcept;

    [[nodiscard]] DebugKeyResult handleKey(
        DebugKey key,
        DebugKeyPhase phase,
        bool repeated
    ) noexcept;

    /** pending single-step을 최대 한 번 소비합니다. */
    [[nodiscard]] DebugFrameEffect prepareFrame() noexcept;

    [[nodiscard]] DebugRuntimeSnapshot snapshot() const noexcept;

private:
    [[nodiscard]] DebugPointerResult handleMiddleRelease(
        std::uint64_t pointerId,
        std::uint64_t timestampMilliseconds
    ) noexcept;
    [[nodiscard]] DebugRuntimeEffect setDebugMode(
        bool enabled,
        bool persist
    ) noexcept;
    [[nodiscard]] bool resetGesture() noexcept;
    void clearAnimationControl() noexcept;
    void incrementRevision() noexcept;

    std::array<std::uint64_t, required_middle_release_count>
        middleReleaseTimestamps_{};
    std::array<bool, static_cast<std::size_t>(DebugDisplayOption::count)>
        displayOptions_{true, true, true, false};
    std::array<bool, static_cast<std::size_t>(DebugKey::count)> keyDown_{};
    std::size_t middleReleaseCount_ = 0U;
    std::uint64_t middlePointerId_ = 0U;
    std::uint64_t middlePressTimestampMilliseconds_ = 0U;
    std::uint64_t revision_ = 0U;
    bool debugModeEnabled_ = false;
    bool middlePressCaptured_ = false;
    bool animationPaused_ = false;
    bool singleStepPending_ = false;
};

static_assert(std::is_trivially_copyable_v<DebugRuntimeEffect>);
static_assert(std::is_trivially_copyable_v<DebugPointerResult>);
static_assert(std::is_trivially_copyable_v<DebugKeyResult>);
static_assert(std::is_trivially_copyable_v<DebugFrameEffect>);
static_assert(std::is_trivially_copyable_v<DebugRuntimeSnapshot>);
static_assert(std::is_standard_layout_v<DebugRuntimeEffect>);
static_assert(std::is_standard_layout_v<DebugPointerResult>);
static_assert(std::is_standard_layout_v<DebugKeyResult>);
static_assert(std::is_standard_layout_v<DebugFrameEffect>);
static_assert(std::is_standard_layout_v<DebugRuntimeSnapshot>);

} // namespace cirvivor::debug
