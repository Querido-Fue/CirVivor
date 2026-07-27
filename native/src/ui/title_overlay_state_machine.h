#pragma once

#include "data/game_map_catalog.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace cirvivor::ui {

inline constexpr std::size_t maximum_overlay_count = 4U;
inline constexpr std::size_t maximum_external_url_bytes = 2'048U;

enum class TitlePhase : std::uint8_t {
    loadingDelay,
    logoPlayback,
    sceneTransition,
    interactive
};

enum class OverlayKind : std::uint8_t {
    none,
    mapSelect,
    deck,
    setting,
    credits,
    quickStart,
    records,
    research,
    achievements,
    debug,
    exitConfirm,
    externalLinkWarning
};

enum class OverlayKey : std::uint8_t {
    none,
    titleMenu,
    debugPanel,
    exitConfirm,
    externalLinkWarning
};

enum class OverlayPhase : std::uint8_t {
    opening,
    open,
    closing
};

enum class UiActionType : std::uint8_t {
    openTitleOverlay,
    closeTitleOverlay,
    openDebugOverlay,
    closeDebugOverlay,
    openExitOverlay,
    openExternalLinkWarningOverlay,
    openExternalUrlDirect,
    cancelTopOverlay,
    confirmTopOverlay,
    lockTopOverlayInteractions,
    windowCloseRequested
};

enum class UiActionStatus : std::uint8_t {
    applied,
    alreadyActive,
    rejectedInvalidAction,
    rejectedSceneNotInteractive,
    rejectedMissingOverlay,
    rejectedCapacity,
    rejectedPayload,
    rejectedInteractionLocked,
    rejectedAlreadyClosing,
    rejectedSequenceExhausted,
    rejectedStaleSequence,
    rejectedEffectNotPending
};

enum class UiEffect : std::uint8_t {
    none,
    openExternalUrl,
    startPlayableSession
};

struct FixedUiText final {
    std::array<char, maximum_external_url_bytes + 1U> bytes{};
    std::uint16_t length = 0U;

    [[nodiscard]] std::string_view view() const noexcept {
        return {bytes.data(), length};
    }

    [[nodiscard]] bool empty() const noexcept {
        return length == 0U;
    }

    friend bool operator==(const FixedUiText&, const FixedUiText&) = default;
};

struct FixedGameMapId final {
    std::array<char, ::cirvivor::data::maximum_game_map_id_bytes + 1U> bytes{};
    std::uint8_t length = 0U;

    [[nodiscard]] std::string_view view() const noexcept {
        return {bytes.data(), length};
    }

    [[nodiscard]] bool empty() const noexcept {
        return length == 0U;
    }

    friend bool operator==(const FixedGameMapId&, const FixedGameMapId&) = default;
};

struct StartPlayableSession final {
    FixedGameMapId mapId{};

    friend bool operator==(
        const StartPlayableSession&,
        const StartPlayableSession&
    ) = default;
};

struct UiFrameContext final {
    bool animationPaused = false;
};

struct UiAction final {
    UiActionType type = UiActionType::cancelTopOverlay;
    OverlayKind overlay = OverlayKind::none;
    std::string_view text{};

    [[nodiscard]] static constexpr UiAction openTitle(
        const OverlayKind overlayKind,
        const std::string_view payload = {}
    ) noexcept {
        return {UiActionType::openTitleOverlay, overlayKind, payload};
    }

    [[nodiscard]] static constexpr UiAction closeTitle() noexcept {
        return {UiActionType::closeTitleOverlay, OverlayKind::none, {}};
    }

    [[nodiscard]] static constexpr UiAction openDebug() noexcept {
        return {UiActionType::openDebugOverlay, OverlayKind::debug, {}};
    }

    [[nodiscard]] static constexpr UiAction closeDebug() noexcept {
        return {UiActionType::closeDebugOverlay, OverlayKind::none, {}};
    }

    [[nodiscard]] static constexpr UiAction openExit() noexcept {
        return {UiActionType::openExitOverlay, OverlayKind::exitConfirm, {}};
    }

    [[nodiscard]] static constexpr UiAction openExternalLink(
        const std::string_view url
    ) noexcept {
        return {
            UiActionType::openExternalLinkWarningOverlay,
            OverlayKind::externalLinkWarning,
            url
        };
    }

    [[nodiscard]] static constexpr UiAction openExternalDirect(
        const std::string_view url
    ) noexcept {
        return {
            UiActionType::openExternalUrlDirect,
            OverlayKind::none,
            url
        };
    }

    [[nodiscard]] static constexpr UiAction cancelTop() noexcept {
        return {UiActionType::cancelTopOverlay, OverlayKind::none, {}};
    }

    [[nodiscard]] static constexpr UiAction confirmTop() noexcept {
        return {UiActionType::confirmTopOverlay, OverlayKind::none, {}};
    }

    [[nodiscard]] static constexpr UiAction lockTop() noexcept {
        return {
            UiActionType::lockTopOverlayInteractions,
            OverlayKind::none,
            {}
        };
    }

    [[nodiscard]] static constexpr UiAction windowClose() noexcept {
        return {
            UiActionType::windowCloseRequested,
            OverlayKind::exitConfirm,
            {}
        };
    }
};

struct UiActionOutcome final {
    UiActionStatus status = UiActionStatus::rejectedInvalidAction;
    UiEffect effect = UiEffect::none;
    std::uint32_t overlaySequence = 0U;
    FixedUiText effectText{};
    StartPlayableSession playableSession{};

    [[nodiscard]] bool accepted() const noexcept {
        return status == UiActionStatus::applied
            || status == UiActionStatus::alreadyActive;
    }
};

struct TitleTimelineSnapshot final {
    TitlePhase phase = TitlePhase::loadingDelay;
    double elapsedSeconds = 0.0;
    double phaseElapsedSeconds = 0.0;
    double phaseProgress = 0.0;
    double logoPlaybackProgress = 0.0;
    double sceneTransitionProgress = 0.0;
    double menuRevealProgress = 0.0;
    bool enemySpawnReady = false;
    bool menuRevealComplete = false;
    bool menuInteractionReady = false;

    friend bool operator==(
        const TitleTimelineSnapshot&,
        const TitleTimelineSnapshot&
    ) = default;
};

struct OverlaySnapshot final {
    OverlayKind kind = OverlayKind::none;
    OverlayKey key = OverlayKey::none;
    OverlayPhase phase = OverlayPhase::opening;
    std::uint32_t sequence = 0U;
    std::int16_t layer = 0;
    double phaseElapsedSeconds = 0.0;
    double phaseProgress = 0.0;
    double alpha = 0.0;
    double dimAlpha = 0.0;
    double contentScale = 0.9;
    double contentBlur = 10.0;
    bool interactionsLocked = false;
    bool acceptsInput = false;
    bool playableStartPending = false;
    FixedUiText externalUrl{};
    FixedGameMapId selectedMapId{};

    friend bool operator==(const OverlaySnapshot&, const OverlaySnapshot&) = default;
};

struct UiStateSnapshot final {
    TitleTimelineSnapshot title{};
    std::array<OverlaySnapshot, maximum_overlay_count> overlays{};
    std::uint8_t overlayCount = 0U;
    bool titleInputEnabled = false;
    bool applicationExitRequested = false;
    std::uint64_t revision = 0U;

    friend bool operator==(const UiStateSnapshot&, const UiStateSnapshot&) = default;
};

class TitleOverlayStateMachine final {
public:
    static constexpr double fixed_step_seconds = 1.0 / 60.0;
    static constexpr double maximum_frame_delta_seconds = 0.1;
    static constexpr double intro_delay_seconds = 1.5;
    static constexpr double logo_playback_seconds = 3.0;
    static constexpr double scene_transition_seconds = 2.0;
    static constexpr double menu_reveal_seconds = 1.39;
    static constexpr double overlay_transition_seconds = 0.5;

    [[nodiscard]] UiActionOutcome apply(
        const UiAction& action,
        UiFrameContext context = {}
    ) noexcept;
    void advance(double deltaSeconds) noexcept;
    void tick() noexcept;

    [[nodiscard]] UiStateSnapshot snapshot() const noexcept;
    [[nodiscard]] bool tryConsumeApplicationExitRequest() noexcept;
    [[nodiscard]] UiActionOutcome acknowledgeExternalUrl(
        std::uint32_t overlaySequence,
        bool success
    ) noexcept;
    [[nodiscard]] UiActionOutcome acknowledgePlayableSession(
        std::uint32_t overlaySequence,
        bool success
    ) noexcept;

private:
    struct OverlayEntry final {
        OverlayKind kind = OverlayKind::none;
        OverlayKey key = OverlayKey::none;
        OverlayPhase phase = OverlayPhase::opening;
        std::uint32_t sequence = 0U;
        std::int16_t layer = 0;
        double phaseElapsedSeconds = 0.0;
        double alpha = 0.0;
        double dimAlpha = 0.0;
        double contentScale = 0.9;
        double contentBlur = 10.0;
        double closeStartAlpha = 0.0;
        double closeStartDimAlpha = 0.0;
        double closeStartScale = 0.9;
        double closeStartBlur = 10.0;
        bool interactionsLocked = false;
        bool externalOpenPending = false;
        bool playableStartPending = false;
        FixedUiText externalUrl{};
        FixedGameMapId selectedMapId{};
    };

    [[nodiscard]] UiActionOutcome openOverlay(
        OverlayKind kind,
        std::string_view payload,
        bool requireTitleInteraction,
        UiFrameContext context
    ) noexcept;
    [[nodiscard]] UiActionOutcome beginCloseByKey(
        OverlayKey key,
        UiFrameContext context
    ) noexcept;
    [[nodiscard]] UiActionOutcome beginCloseAt(
        std::size_t index,
        UiFrameContext context
    ) noexcept;
    [[nodiscard]] UiActionOutcome confirmTopOverlay() noexcept;
    [[nodiscard]] UiActionOutcome lockTopOverlay() noexcept;
    [[nodiscard]] std::size_t findOverlay(OverlayKey key) const noexcept;
    [[nodiscard]] bool titleInputEnabled() const noexcept;
    void advanceTitleTimeline(double deltaSeconds) noexcept;
    [[nodiscard]] bool advanceOverlay(
        std::size_t index,
        double deltaSeconds
    ) noexcept;
    void eraseOverlay(std::size_t index) noexcept;
    void incrementRevision() noexcept;

    std::array<OverlayEntry, maximum_overlay_count> overlays_{};
    std::size_t overlayCount_ = 0U;
    TitlePhase titlePhase_ = TitlePhase::loadingDelay;
    double elapsedSeconds_ = 0.0;
    double titlePhaseElapsedSeconds_ = 0.0;
    double menuRevealElapsedSeconds_ = 0.0;
    double sceneTransitionProgress_ = 0.0;
    std::uint32_t nextSequence_ = 1U;
    bool applicationExitRequested_ = false;
    std::uint64_t revision_ = 0U;
};

[[nodiscard]] constexpr bool isTitleOverlayKind(
    const OverlayKind kind
) noexcept {
    return kind >= OverlayKind::mapSelect
        && kind <= OverlayKind::achievements;
}

} // namespace cirvivor::ui
