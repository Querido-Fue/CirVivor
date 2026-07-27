#include "settings/settings_overlay_session.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace cirvivor::settings {
namespace {

[[nodiscard]] constexpr bool validField(
    const SettingsOverlayField field
) noexcept {
    return field >= SettingsOverlayField::windowMode
        && field < SettingsOverlayField::count;
}

[[nodiscard]] constexpr bool sameOverlayFields(
    const GameSettings& left,
    const GameSettings& right
) noexcept {
    return left.windowMode == right.windowMode
        && left.widescreenSupport == right.widescreenSupport
        && left.renderScalePercent == right.renderScalePercent
        && left.uiScalePercent == right.uiScalePercent
        && left.disableTransparency == right.disableTransparency
        && left.language == right.language
        && left.theme == right.theme
        && left.tooltipDelayTenths == right.tooltipDelayTenths
        && left.bgmVolumePercent == right.bgmVolumePercent
        && left.sfxVolumePercent == right.sfxVolumePercent;
}

template<typename Integer>
[[nodiscard]] Integer valueFromNormalized(
    const double normalizedValue,
    const Integer minimum,
    const Integer maximum
) noexcept {
    const double span = static_cast<double>(maximum - minimum);
    const double rounded = std::round(normalizedValue * span);
    return static_cast<Integer>(
        static_cast<double>(minimum) + rounded
    );
}

} // namespace

bool SettingsOverlaySession::begin(
    const std::uint32_t overlaySequence,
    const GameSettings& baseline
) noexcept {
    if (active_
        || overlaySequence == 0U
        || !validateSettings(baseline).succeeded()) {
        return false;
    }
    baseline_ = baseline;
    draft_ = baseline;
    overlaySequence_ = overlaySequence;
    active_ = true;
    incrementRevision();
    return true;
}

SettingsOverlayUpdate SettingsOverlaySession::activate(
    const std::uint32_t overlaySequence,
    const SettingsOverlayField field,
    const double normalizedValue
) noexcept {
    if (!active_) {
        return {
            .error = SettingsOverlayUpdateError::inactive,
            .revision = revision_
        };
    }
    if (overlaySequence == 0U || overlaySequence != overlaySequence_) {
        return {
            .error = SettingsOverlayUpdateError::staleSequence,
            .dirty = draft_ != baseline_,
            .changedFields = changedFields(),
            .revision = revision_
        };
    }
    if (!validField(field)) {
        return {
            .error = SettingsOverlayUpdateError::invalidField,
            .dirty = draft_ != baseline_,
            .changedFields = changedFields(),
            .revision = revision_
        };
    }
    if (!std::isfinite(normalizedValue)
        || normalizedValue < 0.0
        || normalizedValue > 1.0) {
        return {
            .error = SettingsOverlayUpdateError::invalidValue,
            .dirty = draft_ != baseline_,
            .changedFields = changedFields(),
            .revision = revision_
        };
    }

    const GameSettings before = draft_;
    switch (field) {
    case SettingsOverlayField::windowMode:
        draft_.windowMode = normalizedValue < 0.5
            ? WindowMode::windowed
            : WindowMode::fullscreen;
        break;
    case SettingsOverlayField::widescreenSupport:
        draft_.widescreenSupport = !draft_.widescreenSupport;
        break;
    case SettingsOverlayField::renderScale:
        draft_.renderScalePercent = valueFromNormalized<std::uint8_t>(
            normalizedValue,
            minimum_render_scale_percent,
            maximum_render_scale_percent
        );
        break;
    case SettingsOverlayField::uiScale:
        draft_.uiScalePercent = valueFromNormalized<std::uint16_t>(
            normalizedValue,
            minimum_ui_scale_percent,
            maximum_ui_scale_percent
        );
        break;
    case SettingsOverlayField::disableTransparency:
        draft_.disableTransparency = !draft_.disableTransparency;
        break;
    case SettingsOverlayField::language:
        draft_.language = normalizedValue < 0.5
            ? Language::korean
            : Language::english;
        break;
    case SettingsOverlayField::theme:
        draft_.theme = normalizedValue < 0.5 ? Theme::light : Theme::dark;
        break;
    case SettingsOverlayField::tooltipDelay:
        draft_.tooltipDelayTenths = valueFromNormalized<std::uint8_t>(
            normalizedValue,
            std::uint8_t{0U},
            maximum_tooltip_delay_tenths
        );
        break;
    case SettingsOverlayField::bgmVolume:
        draft_.bgmVolumePercent = valueFromNormalized<std::uint8_t>(
            normalizedValue,
            std::uint8_t{0U},
            maximum_volume_percent
        );
        break;
    case SettingsOverlayField::sfxVolume:
        draft_.sfxVolumePercent = valueFromNormalized<std::uint8_t>(
            normalizedValue,
            std::uint8_t{0U},
            maximum_volume_percent
        );
        break;
    case SettingsOverlayField::count:
        return {
            .error = SettingsOverlayUpdateError::invalidField,
            .dirty = draft_ != baseline_,
            .changedFields = changedFields(),
            .revision = revision_
        };
    }

    const bool changed = draft_ != before;
    if (changed) {
        incrementRevision();
    }
    return {
        .changed = changed,
        .dirty = draft_ != baseline_,
        .changedFields = changedFields(),
        .revision = revision_
    };
}

bool SettingsOverlaySession::discard(
    const std::uint32_t overlaySequence,
    GameSettings& output,
    SettingsOverlayFieldMask& changedFieldsOutput
) noexcept {
    if (!active_
        || overlaySequence == 0U
        || overlaySequence != overlaySequence_) {
        return false;
    }
    const SettingsOverlayFieldMask fields = changedFields();
    output = baseline_;
    changedFieldsOutput = fields;
    endSession();
    return true;
}

bool SettingsOverlaySession::tryBuildSaveCandidate(
    const std::uint32_t overlaySequence,
    const GameSettings& currentAuthority,
    GameSettings& output
) const noexcept {
    if (!active_
        || overlaySequence == 0U
        || overlaySequence != overlaySequence_
        || !validateSettings(currentAuthority).succeeded()) {
        return false;
    }

    GameSettings candidate = currentAuthority;
    candidate.windowMode = draft_.windowMode;
    candidate.widescreenSupport = draft_.widescreenSupport;
    candidate.renderScalePercent = draft_.renderScalePercent;
    candidate.uiScalePercent = draft_.uiScalePercent;
    candidate.disableTransparency = draft_.disableTransparency;
    candidate.language = draft_.language;
    candidate.theme = draft_.theme;
    candidate.tooltipDelayTenths = draft_.tooltipDelayTenths;
    candidate.bgmVolumePercent = draft_.bgmVolumePercent;
    candidate.sfxVolumePercent = draft_.sfxVolumePercent;
    candidate.screenModeChanged = false;
    if (!validateSettings(candidate).succeeded()) {
        return false;
    }
    output = candidate;
    return true;
}

bool SettingsOverlaySession::acceptSaved(
    const std::uint32_t overlaySequence,
    const GameSettings& committed
) noexcept {
    if (!active_
        || overlaySequence == 0U
        || overlaySequence != overlaySequence_
        || !validateSettings(committed).succeeded()
        || !sameOverlayFields(committed, draft_)) {
        return false;
    }
    baseline_ = committed;
    draft_ = committed;
    endSession();
    return true;
}

bool SettingsOverlaySession::abandon(
    const std::uint32_t overlaySequence
) noexcept {
    if (!active_
        || overlaySequence == 0U
        || overlaySequence != overlaySequence_) {
        return false;
    }
    endSession();
    return true;
}

const GameSettings& SettingsOverlaySession::draft() const noexcept {
    return draft_;
}

SettingsOverlaySessionSnapshot SettingsOverlaySession::snapshot() const noexcept {
    return {
        .baseline = baseline_,
        .draft = draft_,
        .overlaySequence = overlaySequence_,
        .revision = revision_,
        .changedFields = active_
            ? changedFields()
            : SettingsOverlayFieldMask{0U},
        .active = active_,
        .dirty = active_ && draft_ != baseline_
    };
}

SettingsOverlayFieldMask SettingsOverlaySession::changedFields() const noexcept {
    SettingsOverlayFieldMask result = 0U;
    const auto addIf = [&result](
        const SettingsOverlayField field,
        const bool changed
    ) noexcept {
        if (changed) {
            result = static_cast<SettingsOverlayFieldMask>(
                result | settingsOverlayFieldBit(field)
            );
        }
    };
    addIf(SettingsOverlayField::windowMode,
        draft_.windowMode != baseline_.windowMode);
    addIf(SettingsOverlayField::widescreenSupport,
        draft_.widescreenSupport != baseline_.widescreenSupport);
    addIf(SettingsOverlayField::renderScale,
        draft_.renderScalePercent != baseline_.renderScalePercent);
    addIf(SettingsOverlayField::uiScale,
        draft_.uiScalePercent != baseline_.uiScalePercent);
    addIf(SettingsOverlayField::disableTransparency,
        draft_.disableTransparency != baseline_.disableTransparency);
    addIf(SettingsOverlayField::language,
        draft_.language != baseline_.language);
    addIf(SettingsOverlayField::theme,
        draft_.theme != baseline_.theme);
    addIf(SettingsOverlayField::tooltipDelay,
        draft_.tooltipDelayTenths != baseline_.tooltipDelayTenths);
    addIf(SettingsOverlayField::bgmVolume,
        draft_.bgmVolumePercent != baseline_.bgmVolumePercent);
    addIf(SettingsOverlayField::sfxVolume,
        draft_.sfxVolumePercent != baseline_.sfxVolumePercent);
    return result;
}

void SettingsOverlaySession::incrementRevision() noexcept {
    if (revision_ < std::numeric_limits<std::uint64_t>::max()) {
        ++revision_;
    }
}

void SettingsOverlaySession::endSession() noexcept {
    overlaySequence_ = 0U;
    active_ = false;
    incrementRevision();
}

} // namespace cirvivor::settings
