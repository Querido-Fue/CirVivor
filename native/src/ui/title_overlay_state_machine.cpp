#include "ui/title_overlay_state_machine.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace cirvivor::ui {
namespace {

constexpr std::size_t invalid_overlay_index = maximum_overlay_count;
constexpr double completion_epsilon_seconds = 1.0e-12;
constexpr double scene_accel_duration_seconds = 0.3;
constexpr double scene_cruise_duration_seconds = 0.2;
constexpr double scene_decel_duration_seconds = 1.5;
constexpr double expo_boundary_slope = 10.0 * 0.693147180559945309417232121458176568;
constexpr double scene_velocity_weighted_duration =
    (scene_accel_duration_seconds / expo_boundary_slope)
    + scene_cruise_duration_seconds
    + (scene_decel_duration_seconds / expo_boundary_slope);
constexpr double scene_cruise_velocity = 1.0 / scene_velocity_weighted_duration;
constexpr double scene_accel_end =
    (scene_cruise_velocity * scene_accel_duration_seconds) / expo_boundary_slope;
constexpr double scene_cruise_end =
    scene_accel_end + (scene_cruise_velocity * scene_cruise_duration_seconds);

struct Utf8CodePoint final {
    std::uint32_t value = 0U;
    std::size_t width = 0U;
    bool valid = false;
};

struct NormalizedBoundaryText final {
    std::string_view value{};
    bool valid = false;
};

[[nodiscard]] double clampUnit(const double value) noexcept {
    return std::clamp(value, 0.0, 1.0);
}

[[nodiscard]] bool durationComplete(
    const double elapsedSeconds,
    const double durationSeconds
) noexcept {
    return elapsedSeconds >= durationSeconds - completion_epsilon_seconds;
}

[[nodiscard]] double easeInExpo(const double progress) noexcept {
    const double clamped = clampUnit(progress);
    if (clamped <= 0.0) {
        return 0.0;
    }
    if (clamped >= 1.0) {
        return 1.0;
    }
    return std::exp2((10.0 * clamped) - 10.0);
}

[[nodiscard]] double easeOutExpo(const double progress) noexcept {
    const double clamped = clampUnit(progress);
    if (clamped <= 0.0) {
        return 0.0;
    }
    if (clamped >= 1.0) {
        return 1.0;
    }
    return 1.0 - std::exp2(-10.0 * clamped);
}

[[nodiscard]] double interpolate(
    const double start,
    const double end,
    const double progress
) noexcept {
    return start + ((end - start) * progress);
}

[[nodiscard]] OverlayKey overlayKeyForKind(const OverlayKind kind) noexcept {
    if (isTitleOverlayKind(kind)) {
        return OverlayKey::titleMenu;
    }

    switch (kind) {
    case OverlayKind::debug:
        return OverlayKey::debugPanel;
    case OverlayKind::exitConfirm:
        return OverlayKey::exitConfirm;
    case OverlayKind::externalLinkWarning:
        return OverlayKey::externalLinkWarning;
    default:
        return OverlayKey::none;
    }
}

[[nodiscard]] std::int16_t overlayLayerForKind(const OverlayKind kind) noexcept {
    if (isTitleOverlayKind(kind)) {
        return 10;
    }

    switch (kind) {
    case OverlayKind::externalLinkWarning:
        return 15;
    case OverlayKind::debug:
        return 90;
    case OverlayKind::exitConfirm:
        return 100;
    default:
        return 0;
    }
}

[[nodiscard]] Utf8CodePoint decodeUtf8CodePoint(
    const std::string_view text,
    const std::size_t offset
) noexcept {
    if (offset >= text.size()) {
        return {};
    }

    const auto first = static_cast<unsigned char>(text[offset]);
    std::size_t width = 0U;
    std::uint32_t codePoint = 0U;
    std::uint32_t minimum = 0U;
    if (first <= 0x7FU) {
        width = 1U;
        codePoint = first;
    } else if (first >= 0xC2U && first <= 0xDFU) {
        width = 2U;
        codePoint = first & 0x1FU;
        minimum = 0x80U;
    } else if (first >= 0xE0U && first <= 0xEFU) {
        width = 3U;
        codePoint = first & 0x0FU;
        minimum = 0x800U;
    } else if (first >= 0xF0U && first <= 0xF4U) {
        width = 4U;
        codePoint = first & 0x07U;
        minimum = 0x10000U;
    } else {
        return {};
    }

    if (offset + width > text.size()) {
        return {};
    }
    for (std::size_t index = 1U; index < width; ++index) {
        const auto continuation = static_cast<unsigned char>(text[offset + index]);
        if ((continuation & 0xC0U) != 0x80U) {
            return {};
        }
        codePoint = (codePoint << 6U) | (continuation & 0x3FU);
    }

    if (codePoint < minimum
        || codePoint > 0x10FFFFU
        || (codePoint >= 0xD800U && codePoint <= 0xDFFFU)) {
        return {};
    }
    return {.value = codePoint, .width = width, .valid = true};
}

[[nodiscard]] bool isBoundaryWhitespace(const std::uint32_t codePoint) noexcept {
    return (codePoint >= 0x0009U && codePoint <= 0x000DU)
        || codePoint == 0x0020U
        || codePoint == 0x0085U
        || codePoint == 0x00A0U
        || codePoint == 0x1680U
        || (codePoint >= 0x2000U && codePoint <= 0x200AU)
        || codePoint == 0x2028U
        || codePoint == 0x2029U
        || codePoint == 0x202FU
        || codePoint == 0x205FU
        || codePoint == 0x3000U
        || codePoint == 0xFEFFU;
}

[[nodiscard]] NormalizedBoundaryText normalizeUtf8Boundary(
    const std::string_view text
) noexcept {
    std::size_t firstContentOffset = std::string_view::npos;
    std::size_t lastContentEnd = 0U;
    std::size_t offset = 0U;
    while (offset < text.size()) {
        const std::size_t codePointOffset = offset;
        const Utf8CodePoint decoded = decodeUtf8CodePoint(text, offset);
        if (!decoded.valid || decoded.value == 0U) {
            return {};
        }
        offset += decoded.width;

        if (!isBoundaryWhitespace(decoded.value)) {
            if (firstContentOffset == std::string_view::npos) {
                firstContentOffset = codePointOffset;
            }
            lastContentEnd = offset;
        }
    }

    if (firstContentOffset == std::string_view::npos) {
        return {.value = {}, .valid = true};
    }
    return {
        .value = text.substr(firstContentOffset, lastContentEnd - firstContentOffset),
        .valid = true
    };
}

[[nodiscard]] char asciiLower(const char value) noexcept {
    return value >= 'A' && value <= 'Z'
        ? static_cast<char>(value + ('a' - 'A'))
        : value;
}

[[nodiscard]] bool startsWithAsciiCaseInsensitive(
    const std::string_view value,
    const std::string_view prefix
) noexcept {
    if (value.size() < prefix.size()) {
        return false;
    }
    for (std::size_t index = 0U; index < prefix.size(); ++index) {
        if (asciiLower(value[index]) != prefix[index]) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool hasValidHttpAuthority(
    const std::string_view authority
) noexcept {
    if (authority.empty()) {
        return false;
    }

    for (const char valueByte : authority) {
        const auto byte = static_cast<unsigned char>(valueByte);
        if (byte <= 0x20U || byte == 0x7FU) {
            return false;
        }
    }

    const std::size_t firstUserInfoSeparator = authority.find('@');
    const std::size_t userInfoSeparator = authority.rfind('@');
    if (firstUserInfoSeparator != userInfoSeparator) {
        return false;
    }
    const std::string_view hostAndPort = userInfoSeparator == std::string_view::npos
        ? authority
        : authority.substr(userInfoSeparator + 1U);
    if (hostAndPort.empty()) {
        return false;
    }

    if (hostAndPort.front() == '[') {
        const std::size_t closingBracket = hostAndPort.find(']');
        if (closingBracket == std::string_view::npos || closingBracket == 1U) {
            return false;
        }

        const std::string_view suffix = hostAndPort.substr(closingBracket + 1U);
        if (suffix.empty()) {
            return true;
        }
        if (suffix.size() <= 1U || suffix.front() != ':') {
            return false;
        }
        return std::all_of(
            suffix.begin() + 1,
            suffix.end(),
            [](const char valueByte) noexcept {
                return valueByte >= '0' && valueByte <= '9';
            }
        );
    }

    if (hostAndPort.find_first_of("[]") != std::string_view::npos) {
        return false;
    }

    const std::size_t portSeparator = hostAndPort.find(':');
    if (portSeparator == std::string_view::npos) {
        return true;
    }
    if (portSeparator == 0U
        || portSeparator + 1U >= hostAndPort.size()
        || hostAndPort.find(':', portSeparator + 1U) != std::string_view::npos) {
        return false;
    }
    const std::string_view port = hostAndPort.substr(portSeparator + 1U);
    return std::all_of(
        port.begin(),
        port.end(),
        [](const char valueByte) noexcept {
            return valueByte >= '0' && valueByte <= '9';
        }
    );
}

[[nodiscard]] bool hasAllowedExternalUrl(
    const std::string_view value
) noexcept {
    constexpr std::string_view httpPrefix = "http://";
    constexpr std::string_view httpsPrefix = "https://";
    std::size_t authorityOffset = 0U;
    if (startsWithAsciiCaseInsensitive(value, httpsPrefix)) {
        authorityOffset = httpsPrefix.size();
    } else if (startsWithAsciiCaseInsensitive(value, httpPrefix)) {
        authorityOffset = httpPrefix.size();
    } else {
        return false;
    }

    const std::string_view remainder = value.substr(authorityOffset);
    const std::size_t authorityLength = remainder.find_first_of("/?#");
    return hasValidHttpAuthority(remainder.substr(0U, authorityLength));
}

[[nodiscard]] bool copyFixedText(
    const std::string_view value,
    FixedUiText& destination
) noexcept {
    if (value.size() > maximum_external_url_bytes) {
        return false;
    }

    destination = {};
    std::copy(value.begin(), value.end(), destination.bytes.begin());
    destination.bytes[value.size()] = '\0';
    destination.length = static_cast<std::uint16_t>(value.size());
    return true;
}

[[nodiscard]] double calculateSceneTransitionProgress(
    const double transitionElapsedSeconds
) noexcept {
    if (transitionElapsedSeconds <= 0.0) {
        return 0.0;
    }
    if (durationComplete(
        transitionElapsedSeconds,
        TitleOverlayStateMachine::scene_transition_seconds
    )) {
        return 1.0;
    }

    if (transitionElapsedSeconds <= scene_accel_duration_seconds) {
        const double localProgress = transitionElapsedSeconds
            / scene_accel_duration_seconds;
        return interpolate(0.0, scene_accel_end, easeInExpo(localProgress));
    }

    if (transitionElapsedSeconds
        <= scene_accel_duration_seconds + scene_cruise_duration_seconds) {
        const double localProgress = (
            transitionElapsedSeconds - scene_accel_duration_seconds
        ) / scene_cruise_duration_seconds;
        return interpolate(scene_accel_end, scene_cruise_end, localProgress);
    }

    const double decelElapsedSeconds = transitionElapsedSeconds
        - scene_accel_duration_seconds
        - scene_cruise_duration_seconds;
    const double localProgress = decelElapsedSeconds
        / scene_decel_duration_seconds;
    return interpolate(scene_cruise_end, 1.0, easeOutExpo(localProgress));
}

} // namespace

UiActionOutcome TitleOverlayStateMachine::apply(
    const UiAction& action,
    const UiFrameContext context
) noexcept {
    switch (action.type) {
    case UiActionType::openTitleOverlay:
        if (!isTitleOverlayKind(action.overlay)) {
            return {.status = UiActionStatus::rejectedInvalidAction};
        }
        return openOverlay(action.overlay, {}, true, context);
    case UiActionType::closeTitleOverlay:
        return beginCloseByKey(OverlayKey::titleMenu, context);
    case UiActionType::openDebugOverlay:
        return openOverlay(OverlayKind::debug, {}, false, context);
    case UiActionType::closeDebugOverlay:
        return beginCloseByKey(OverlayKey::debugPanel, context);
    case UiActionType::openExitOverlay:
    case UiActionType::windowCloseRequested:
        return openOverlay(OverlayKind::exitConfirm, {}, false, context);
    case UiActionType::openExternalLinkWarningOverlay:
        return openOverlay(
            OverlayKind::externalLinkWarning,
            action.text,
            false,
            context
        );
    case UiActionType::openExternalUrlDirect: {
        if (overlayCount_ != 0U || !titleInputEnabled()) {
            return {.status = UiActionStatus::rejectedSceneNotInteractive};
        }
        const NormalizedBoundaryText normalized = normalizeUtf8Boundary(
            action.text
        );
        FixedUiText effectText{};
        if (!normalized.valid
            || normalized.value.empty()
            || !hasAllowedExternalUrl(normalized.value)
            || !copyFixedText(normalized.value, effectText)) {
            return {.status = UiActionStatus::rejectedPayload};
        }
        return {
            .status = UiActionStatus::applied,
            .effect = UiEffect::openExternalUrl,
            .overlaySequence = 0U,
            .effectText = effectText
        };
    }
    case UiActionType::cancelTopOverlay:
        if (overlayCount_ == 0U) {
            return {.status = UiActionStatus::rejectedMissingOverlay};
        }
        if (overlays_[overlayCount_ - 1U].interactionsLocked
            || overlays_[overlayCount_ - 1U].externalOpenPending) {
            return {
                .status = UiActionStatus::rejectedInteractionLocked,
                .overlaySequence = overlays_[overlayCount_ - 1U].sequence
            };
        }
        return beginCloseAt(overlayCount_ - 1U, context);
    case UiActionType::confirmTopOverlay:
        return confirmTopOverlay();
    case UiActionType::lockTopOverlayInteractions:
        return lockTopOverlay();
    }

    return {.status = UiActionStatus::rejectedInvalidAction};
}

void TitleOverlayStateMachine::advance(const double deltaSeconds) noexcept {
    if (!std::isfinite(deltaSeconds) || deltaSeconds <= 0.0) {
        return;
    }

    const double safeDeltaSeconds = std::min(
        deltaSeconds,
        maximum_frame_delta_seconds
    );
    const double maximumSeconds = std::numeric_limits<double>::max();
    if (elapsedSeconds_ < maximumSeconds - safeDeltaSeconds) {
        elapsedSeconds_ += safeDeltaSeconds;
    } else {
        elapsedSeconds_ = maximumSeconds;
    }
    advanceTitleTimeline(safeDeltaSeconds);

    std::size_t index = 0U;
    while (index < overlayCount_) {
        if (advanceOverlay(index, safeDeltaSeconds)) {
            eraseOverlay(index);
            continue;
        }
        ++index;
    }

    incrementRevision();
}

void TitleOverlayStateMachine::tick() noexcept {
    advance(fixed_step_seconds);
}

UiStateSnapshot TitleOverlayStateMachine::snapshot() const noexcept {
    UiStateSnapshot result{};
    result.title.phase = titlePhase_;
    result.title.elapsedSeconds = elapsedSeconds_;
    result.title.phaseElapsedSeconds = titlePhaseElapsedSeconds_;
    result.title.logoPlaybackProgress = titlePhase_ == TitlePhase::loadingDelay
        ? 0.0
        : (titlePhase_ == TitlePhase::logoPlayback
            ? clampUnit(titlePhaseElapsedSeconds_ / logo_playback_seconds)
            : 1.0);
    result.title.sceneTransitionProgress = sceneTransitionProgress_;
    result.title.menuRevealProgress = titlePhase_ == TitlePhase::loadingDelay
            || titlePhase_ == TitlePhase::logoPlayback
        ? 0.0
        : clampUnit(menuRevealElapsedSeconds_ / menu_reveal_seconds);
    result.title.enemySpawnReady = titlePhase_ == TitlePhase::interactive
        || (titlePhase_ == TitlePhase::sceneTransition
            && durationComplete(
                titlePhaseElapsedSeconds_,
                scene_accel_duration_seconds
            ));
    result.title.menuRevealComplete = durationComplete(
        menuRevealElapsedSeconds_,
        menu_reveal_seconds
    );
    result.title.menuInteractionReady = result.title.menuRevealComplete
        && sceneTransitionProgress_ >= 0.98;

    switch (titlePhase_) {
    case TitlePhase::loadingDelay:
        result.title.phaseProgress = clampUnit(
            titlePhaseElapsedSeconds_ / intro_delay_seconds
        );
        break;
    case TitlePhase::logoPlayback:
        result.title.phaseProgress = result.title.logoPlaybackProgress;
        break;
    case TitlePhase::sceneTransition:
        result.title.phaseProgress = clampUnit(
            titlePhaseElapsedSeconds_ / scene_transition_seconds
        );
        break;
    case TitlePhase::interactive:
        result.title.phaseProgress = 1.0;
        break;
    }

    result.overlayCount = static_cast<std::uint8_t>(overlayCount_);
    const std::uint32_t focusedSequence = overlayCount_ > 0U
        ? overlays_[overlayCount_ - 1U].sequence
        : 0U;
    for (std::size_t index = 0U; index < overlayCount_; ++index) {
        const OverlayEntry& entry = overlays_[index];
        OverlaySnapshot& overlay = result.overlays[index];
        overlay.kind = entry.kind;
        overlay.key = entry.key;
        overlay.phase = entry.phase;
        overlay.sequence = entry.sequence;
        overlay.layer = entry.layer;
        overlay.phaseElapsedSeconds = entry.phaseElapsedSeconds;
        overlay.phaseProgress = entry.phase == OverlayPhase::open
            ? 1.0
            : clampUnit(
                entry.phaseElapsedSeconds / overlay_transition_seconds
            );
        overlay.alpha = entry.alpha;
        overlay.dimAlpha = entry.dimAlpha;
        overlay.contentScale = entry.contentScale;
        overlay.contentBlur = entry.contentBlur;
        overlay.interactionsLocked = entry.interactionsLocked;
        overlay.acceptsInput = entry.sequence == focusedSequence
            && entry.phase != OverlayPhase::closing
            && !entry.interactionsLocked;
        overlay.externalUrl = entry.externalUrl;
    }

    // Draw order and input ownership are deliberately independent. The original
    // manager draws by layer/sequence but gives focus to the latest attachment.
    for (std::size_t index = 1U; index < overlayCount_; ++index) {
        const OverlaySnapshot value = result.overlays[index];
        std::size_t destination = index;
        while (destination > 0U) {
            const OverlaySnapshot& previous = result.overlays[destination - 1U];
            const bool belongsBeforePrevious = value.layer < previous.layer
                || (value.layer == previous.layer
                    && value.sequence < previous.sequence);
            if (!belongsBeforePrevious) {
                break;
            }
            result.overlays[destination] = previous;
            --destination;
        }
        result.overlays[destination] = value;
    }

    result.titleInputEnabled = titleInputEnabled();
    result.applicationExitRequested = applicationExitRequested_;
    result.revision = revision_;
    return result;
}

bool TitleOverlayStateMachine::tryConsumeApplicationExitRequest() noexcept {
    if (!applicationExitRequested_) {
        return false;
    }

    applicationExitRequested_ = false;
    incrementRevision();
    return true;
}

UiActionOutcome TitleOverlayStateMachine::acknowledgeExternalUrl(
    const std::uint32_t overlaySequence,
    const bool success
) noexcept {
    const std::size_t index = findOverlay(OverlayKey::externalLinkWarning);
    if (index == invalid_overlay_index
        || overlays_[index].sequence != overlaySequence) {
        return {
            .status = UiActionStatus::rejectedStaleSequence,
            .overlaySequence = overlaySequence
        };
    }

    OverlayEntry& entry = overlays_[index];
    if (!entry.externalOpenPending) {
        return {
            .status = UiActionStatus::rejectedEffectNotPending,
            .overlaySequence = entry.sequence
        };
    }

    entry.externalOpenPending = false;
    if (success) {
        return beginCloseAt(index, {});
    }

    entry.interactionsLocked = false;
    incrementRevision();
    return {
        .status = UiActionStatus::applied,
        .overlaySequence = entry.sequence
    };
}

UiActionOutcome TitleOverlayStateMachine::openOverlay(
    const OverlayKind kind,
    const std::string_view payload,
    const bool requireTitleInteraction,
    const UiFrameContext context
) noexcept {
    const OverlayKey key = overlayKeyForKind(kind);
    if (key == OverlayKey::none) {
        return {.status = UiActionStatus::rejectedInvalidAction};
    }

    std::string_view normalizedPayload{};
    if (key == OverlayKey::externalLinkWarning) {
        const NormalizedBoundaryText normalized = normalizeUtf8Boundary(payload);
        if (!normalized.valid
            || normalized.value.empty()
            || !hasAllowedExternalUrl(normalized.value)) {
            return {.status = UiActionStatus::rejectedPayload};
        }
        normalizedPayload = normalized.value;
    }

    const std::size_t existingIndex = findOverlay(key);
    if (existingIndex != invalid_overlay_index) {
        // Manager keys stay attached through close completion, so keyed opens
        // keep returning the original sequence while that entry fades out.
        return {
            .status = UiActionStatus::alreadyActive,
            .overlaySequence = overlays_[existingIndex].sequence
        };
    }

    if (key == OverlayKey::externalLinkWarning
        && normalizedPayload.size() > maximum_external_url_bytes) {
        return {.status = UiActionStatus::rejectedPayload};
    }
    if (requireTitleInteraction && !titleInputEnabled()) {
        return {.status = UiActionStatus::rejectedSceneNotInteractive};
    }
    if (overlayCount_ >= overlays_.size()) {
        return {.status = UiActionStatus::rejectedCapacity};
    }
    if (nextSequence_ == 0U) {
        return {.status = UiActionStatus::rejectedSequenceExhausted};
    }

    OverlayEntry candidate{};
    candidate.kind = kind;
    candidate.key = key;
    candidate.sequence = nextSequence_;
    candidate.layer = overlayLayerForKind(kind);
    if (key == OverlayKey::externalLinkWarning
        && !copyFixedText(normalizedPayload, candidate.externalUrl)) {
        return {.status = UiActionStatus::rejectedPayload};
    }
    if (kind == OverlayKind::debug && context.animationPaused) {
        candidate.phase = OverlayPhase::open;
        candidate.alpha = 1.0;
        candidate.dimAlpha = 1.0;
        candidate.contentScale = 1.0;
        candidate.contentBlur = 0.0;
    }

    overlays_[overlayCount_] = candidate;
    ++overlayCount_;
    const std::uint32_t assignedSequence = nextSequence_;
    if (nextSequence_ == std::numeric_limits<std::uint32_t>::max()) {
        nextSequence_ = 0U;
    } else {
        ++nextSequence_;
    }
    incrementRevision();
    return {
        .status = UiActionStatus::applied,
        .overlaySequence = assignedSequence
    };
}

UiActionOutcome TitleOverlayStateMachine::beginCloseByKey(
    const OverlayKey key,
    const UiFrameContext context
) noexcept {
    const std::size_t index = findOverlay(key);
    if (index == invalid_overlay_index) {
        return {.status = UiActionStatus::rejectedMissingOverlay};
    }
    return beginCloseAt(index, context);
}

UiActionOutcome TitleOverlayStateMachine::beginCloseAt(
    const std::size_t index,
    const UiFrameContext context
) noexcept {
    if (index >= overlayCount_) {
        return {.status = UiActionStatus::rejectedMissingOverlay};
    }

    OverlayEntry& entry = overlays_[index];
    if (entry.phase == OverlayPhase::closing) {
        return {
            .status = UiActionStatus::rejectedAlreadyClosing,
            .overlaySequence = entry.sequence
        };
    }

    const std::uint32_t sequence = entry.sequence;
    const bool ownsInputFocus = index + 1U == overlayCount_;
    if (entry.kind == OverlayKind::debug
        && (context.animationPaused || !ownsInputFocus)) {
        eraseOverlay(index);
        incrementRevision();
        return {
            .status = UiActionStatus::applied,
            .overlaySequence = sequence
        };
    }

    entry.closeStartAlpha = entry.alpha;
    entry.closeStartDimAlpha = entry.dimAlpha;
    entry.closeStartScale = entry.contentScale;
    entry.closeStartBlur = entry.contentBlur;
    entry.phase = OverlayPhase::closing;
    entry.phaseElapsedSeconds = 0.0;
    entry.interactionsLocked = true;
    entry.externalOpenPending = false;
    incrementRevision();
    return {
        .status = UiActionStatus::applied,
        .overlaySequence = sequence
    };
}

UiActionOutcome TitleOverlayStateMachine::confirmTopOverlay() noexcept {
    if (overlayCount_ == 0U) {
        return {.status = UiActionStatus::rejectedMissingOverlay};
    }

    OverlayEntry& entry = overlays_[overlayCount_ - 1U];
    if (entry.phase == OverlayPhase::closing) {
        return {
            .status = UiActionStatus::rejectedAlreadyClosing,
            .overlaySequence = entry.sequence
        };
    }
    if (entry.interactionsLocked) {
        return {
            .status = UiActionStatus::rejectedInteractionLocked,
            .overlaySequence = entry.sequence
        };
    }

    if (entry.kind == OverlayKind::exitConfirm) {
        entry.interactionsLocked = true;
        applicationExitRequested_ = true;
        incrementRevision();
        return {
            .status = UiActionStatus::applied,
            .overlaySequence = entry.sequence
        };
    }

    if (entry.kind == OverlayKind::externalLinkWarning) {
        entry.interactionsLocked = true;
        entry.externalOpenPending = true;
        incrementRevision();
        return {
            .status = UiActionStatus::applied,
            .effect = UiEffect::openExternalUrl,
            .overlaySequence = entry.sequence,
            .effectText = entry.externalUrl
        };
    }

    return {
        .status = UiActionStatus::rejectedInvalidAction,
        .overlaySequence = entry.sequence
    };
}

UiActionOutcome TitleOverlayStateMachine::lockTopOverlay() noexcept {
    if (overlayCount_ == 0U) {
        return {.status = UiActionStatus::rejectedMissingOverlay};
    }

    OverlayEntry& entry = overlays_[overlayCount_ - 1U];
    if (entry.phase == OverlayPhase::closing) {
        return {
            .status = UiActionStatus::rejectedAlreadyClosing,
            .overlaySequence = entry.sequence
        };
    }
    if (entry.interactionsLocked) {
        return {
            .status = UiActionStatus::rejectedInteractionLocked,
            .overlaySequence = entry.sequence
        };
    }

    entry.interactionsLocked = true;
    incrementRevision();
    return {
        .status = UiActionStatus::applied,
        .overlaySequence = entry.sequence
    };
}

std::size_t TitleOverlayStateMachine::findOverlay(
    const OverlayKey key
) const noexcept {
    for (std::size_t index = 0U; index < overlayCount_; ++index) {
        if (overlays_[index].key == key) {
            return index;
        }
    }
    return invalid_overlay_index;
}

bool TitleOverlayStateMachine::titleInputEnabled() const noexcept {
    const bool revealComplete = titlePhase_ == TitlePhase::interactive
        || durationComplete(menuRevealElapsedSeconds_, menu_reveal_seconds);
    const bool menuReady = revealComplete && sceneTransitionProgress_ >= 0.98;
    return menuReady && overlayCount_ == 0U;
}

void TitleOverlayStateMachine::advanceTitleTimeline(
    const double deltaSeconds
) noexcept {
    double remainingSeconds = deltaSeconds;
    for (std::size_t transitionGuard = 0U;
         transitionGuard < 4U && remainingSeconds > 0.0;
         ++transitionGuard) {
        if (titlePhase_ == TitlePhase::interactive) {
            return;
        }

        double durationSeconds = intro_delay_seconds;
        if (titlePhase_ == TitlePhase::logoPlayback) {
            durationSeconds = logo_playback_seconds;
        } else if (titlePhase_ == TitlePhase::sceneTransition) {
            durationSeconds = scene_transition_seconds;
        }

        const double availableSeconds = std::max(
            0.0,
            durationSeconds - titlePhaseElapsedSeconds_
        );
        const double consumedSeconds = std::min(
            remainingSeconds,
            availableSeconds
        );
        titlePhaseElapsedSeconds_ += consumedSeconds;
        remainingSeconds = std::max(0.0, remainingSeconds - consumedSeconds);

        if (titlePhase_ == TitlePhase::sceneTransition) {
            menuRevealElapsedSeconds_ = std::min(
                menu_reveal_seconds,
                menuRevealElapsedSeconds_ + consumedSeconds
            );
            sceneTransitionProgress_ = calculateSceneTransitionProgress(
                titlePhaseElapsedSeconds_
            );
        }

        if (!durationComplete(titlePhaseElapsedSeconds_, durationSeconds)) {
            return;
        }

        switch (titlePhase_) {
        case TitlePhase::loadingDelay:
            titlePhase_ = TitlePhase::logoPlayback;
            titlePhaseElapsedSeconds_ = 0.0;
            break;
        case TitlePhase::logoPlayback:
            titlePhase_ = TitlePhase::sceneTransition;
            titlePhaseElapsedSeconds_ = 0.0;
            menuRevealElapsedSeconds_ = 0.0;
            sceneTransitionProgress_ = 0.0;
            break;
        case TitlePhase::sceneTransition:
            titlePhase_ = TitlePhase::interactive;
            titlePhaseElapsedSeconds_ = 0.0;
            menuRevealElapsedSeconds_ = menu_reveal_seconds;
            sceneTransitionProgress_ = 1.0;
            return;
        case TitlePhase::interactive:
            return;
        }
    }
}

bool TitleOverlayStateMachine::advanceOverlay(
    const std::size_t index,
    const double deltaSeconds
) noexcept {
    OverlayEntry& entry = overlays_[index];
    if (entry.phase == OverlayPhase::open) {
        return false;
    }

    entry.phaseElapsedSeconds = std::min(
        overlay_transition_seconds,
        entry.phaseElapsedSeconds + deltaSeconds
    );
    const double linearProgress = clampUnit(
        entry.phaseElapsedSeconds / overlay_transition_seconds
    );

    if (entry.phase == OverlayPhase::opening) {
        const double easedProgress = easeOutExpo(linearProgress);
        entry.alpha = easedProgress;
        entry.dimAlpha = easedProgress;
        entry.contentScale = interpolate(0.9, 1.0, easedProgress);
        entry.contentBlur = interpolate(10.0, 0.0, easedProgress);
        if (durationComplete(
            entry.phaseElapsedSeconds,
            overlay_transition_seconds
        )) {
            entry.phase = OverlayPhase::open;
            entry.phaseElapsedSeconds = 0.0;
            entry.alpha = 1.0;
            entry.dimAlpha = 1.0;
            entry.contentScale = 1.0;
            entry.contentBlur = 0.0;
        }
        return false;
    }

    const double easedProgress = easeInExpo(linearProgress);
    entry.alpha = interpolate(entry.closeStartAlpha, 0.0, easedProgress);
    entry.dimAlpha = interpolate(entry.closeStartDimAlpha, 0.0, easedProgress);
    entry.contentScale = interpolate(entry.closeStartScale, 0.9, easedProgress);
    entry.contentBlur = interpolate(entry.closeStartBlur, 10.0, easedProgress);
    return durationComplete(
        entry.phaseElapsedSeconds,
        overlay_transition_seconds
    );
}

void TitleOverlayStateMachine::eraseOverlay(
    const std::size_t index
) noexcept {
    for (std::size_t source = index + 1U; source < overlayCount_; ++source) {
        overlays_[source - 1U] = overlays_[source];
    }
    --overlayCount_;
    overlays_[overlayCount_] = {};
}

void TitleOverlayStateMachine::incrementRevision() noexcept {
    if (revision_ < std::numeric_limits<std::uint64_t>::max()) {
        ++revision_;
    }
}

} // namespace cirvivor::ui
