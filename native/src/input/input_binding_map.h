#pragma once

#include "settings/settings_model.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>
#include <type_traits>

namespace cirvivor::input {

enum class InputBindingReplaceStatus : std::uint8_t {
    unchanged,
    replaced,
    rejectedInvalid
};

struct InputActionTransition final {
    settings::InputAction action = settings::InputAction::moveUp;
    bool pressed = false;
    bool repeated = false;

    constexpr bool operator==(const InputActionTransition&) const noexcept = default;
};

struct InputActionTransitionBatch final {
    std::array<InputActionTransition, settings::input_action_count> values{};
    std::uint8_t count = 0U;
    bool matched = false;

    [[nodiscard]] constexpr const InputActionTransition* begin() const noexcept {
        return values.data();
    }

    [[nodiscard]] constexpr const InputActionTransition* end() const noexcept {
        return values.data() + count;
    }
};

/**
 * SDL이나 DOM을 모르는 고정 용량 의미 입력 mapper입니다.
 * 물리 code 문자열은 기존 KeyboardEvent.code 계약을 사용합니다.
 */
class InputBindingMap final {
public:
    InputBindingMap() noexcept;

    /** invalid 입력은 현재 binding과 held 상태를 모두 보존합니다. */
    [[nodiscard]] InputBindingReplaceStatus replace(
        const settings::InputBindings& overrides
    ) noexcept;

    [[nodiscard]] InputActionTransitionBatch apply(
        std::string_view keyboardCode,
        bool pressed,
        bool repeated
    ) noexcept;

    /** binding은 유지하고 모든 물리 held slot만 해제합니다. */
    [[nodiscard]] bool clearPressed() noexcept;

    [[nodiscard]] std::uint8_t bindingCount(
        settings::InputAction action
    ) const noexcept;
    [[nodiscard]] std::string_view bindingCode(
        settings::InputAction action,
        std::size_t bindingIndex
    ) const noexcept;

private:
    using ActionCodes = std::array<
        settings::KeyboardCode,
        settings::maximum_input_bindings_per_action
    >;

    std::array<ActionCodes, settings::input_action_count> bindings_{};
    std::array<std::uint8_t, settings::input_action_count> bindingCounts_{};
    std::array<std::uint8_t, settings::input_action_count> pressedMasks_{};
};

static_assert(std::is_trivially_copyable_v<InputActionTransition>);
static_assert(std::is_trivially_copyable_v<InputActionTransitionBatch>);
static_assert(std::is_trivially_copyable_v<InputBindingMap>);
static_assert(std::is_standard_layout_v<InputBindingMap>);

} // namespace cirvivor::input
