#pragma once

#include "settings/settings_model.h"

#include <cstddef>
#include <cstdint>

namespace cirvivor::settings {

enum class SettingsOverlayField : std::uint8_t {
    windowMode = 0,
    widescreenSupport,
    renderScale,
    uiScale,
    disableTransparency,
    language,
    theme,
    tooltipDelay,
    bgmVolume,
    sfxVolume,
    count
};

using SettingsOverlayFieldMask = std::uint16_t;

static_assert(
    static_cast<std::size_t>(SettingsOverlayField::count)
    <= (sizeof(SettingsOverlayFieldMask) * 8U)
);

[[nodiscard]] constexpr SettingsOverlayFieldMask settingsOverlayFieldBit(
    const SettingsOverlayField field
) noexcept {
    const std::uint8_t index = static_cast<std::uint8_t>(field);
    return index < static_cast<std::uint8_t>(SettingsOverlayField::count)
        ? static_cast<SettingsOverlayFieldMask>(
            SettingsOverlayFieldMask{1U} << index
        )
        : SettingsOverlayFieldMask{0U};
}

enum class SettingsOverlayUpdateError : std::uint8_t {
    none = 0,
    inactive,
    staleSequence,
    invalidField,
    invalidValue
};

struct SettingsOverlayUpdate final {
    SettingsOverlayUpdateError error = SettingsOverlayUpdateError::none;
    bool changed = false;
    bool dirty = false;
    SettingsOverlayFieldMask changedFields = 0U;
    std::uint64_t revision = 0U;

    [[nodiscard]] bool accepted() const noexcept {
        return error == SettingsOverlayUpdateError::none;
    }
};

struct SettingsOverlaySessionSnapshot final {
    GameSettings baseline{};
    GameSettings draft{};
    std::uint32_t overlaySequence = 0U;
    std::uint64_t revision = 0U;
    SettingsOverlayFieldMask changedFields = 0U;
    bool active = false;
    bool dirty = false;

    constexpr bool operator==(
        const SettingsOverlaySessionSnapshot&
    ) const noexcept = default;
};

/**
 * Settings overlay 한 attachment의 baseline/draft 수명을 소유합니다.
 * 저장소와 UI control ID에는 의존하지 않으며 stale sequence는 변경하지 않습니다.
 */
class SettingsOverlaySession final {
public:
    [[nodiscard]] bool begin(
        std::uint32_t overlaySequence,
        const GameSettings& baseline
    ) noexcept;

    /**
     * control rect 안의 0..1 위치를 값으로 반영합니다. toggle 두 종은 위치와
     * 관계없이 현재 값을 뒤집고 dropdown은 좌/우 절반을 두 값으로 사용합니다.
     */
    [[nodiscard]] SettingsOverlayUpdate activate(
        std::uint32_t overlaySequence,
        SettingsOverlayField field,
        double normalizedValue
    ) noexcept;

    /**
     * baseline과 실제 변경된 노출 필드 mask를 반환하고 세션을 끝냅니다.
     * 실패 시 output과 changedFields를 변경하지 않습니다.
     */
    [[nodiscard]] bool discard(
        std::uint32_t overlaySequence,
        GameSettings& output,
        SettingsOverlayFieldMask& changedFields
    ) noexcept;

    /**
     * currentAuthority의 숨김/비노출 값을 보존하고 draft의 10개 노출 필드만
     * 병합한 저장 후보를 만듭니다. stale/inactive이면 output을 변경하지 않습니다.
     */
    [[nodiscard]] bool tryBuildSaveCandidate(
        std::uint32_t overlaySequence,
        const GameSettings& currentAuthority,
        GameSettings& output
    ) const noexcept;

    /** repository save 성공 뒤 실제 committed 값을 확정하고 세션을 끝냅니다. */
    [[nodiscard]] bool acceptSaved(
        std::uint32_t overlaySequence,
        const GameSettings& committed
    ) noexcept;

    /** benchmark 전환처럼 rollback 없이 현재 draft를 유지한 채 세션만 끝냅니다. */
    [[nodiscard]] bool abandon(std::uint32_t overlaySequence) noexcept;

    [[nodiscard]] const GameSettings& draft() const noexcept;
    [[nodiscard]] SettingsOverlaySessionSnapshot snapshot() const noexcept;

private:
    [[nodiscard]] SettingsOverlayFieldMask changedFields() const noexcept;
    void incrementRevision() noexcept;
    void endSession() noexcept;

    GameSettings baseline_{};
    GameSettings draft_{};
    std::uint32_t overlaySequence_ = 0U;
    std::uint64_t revision_ = 0U;
    bool active_ = false;
};

} // namespace cirvivor::settings
