#include "input/input_binding_map.h"

#include <algorithm>

namespace cirvivor::input {
namespace {

using ActionCodes = std::array<
    settings::KeyboardCode,
    settings::maximum_input_bindings_per_action
>;

struct CompiledBindings final {
    std::array<ActionCodes, settings::input_action_count> values{};
    std::array<std::uint8_t, settings::input_action_count> counts{};
};

constexpr std::array<std::array<std::string_view, 2U>, 4U>
    movementDefaults{{
        {"KeyW", "ArrowUp"},
        {"KeyS", "ArrowDown"},
        {"KeyA", "ArrowLeft"},
        {"KeyD", "ArrowRight"}
    }};

[[nodiscard]] bool validAction(const settings::InputAction action) noexcept {
    return action >= settings::InputAction::moveUp
        && action < settings::InputAction::count;
}

[[nodiscard]] bool appendCode(
    ActionCodes& destination,
    std::uint8_t& count,
    const std::string_view code
) noexcept {
    if (count >= destination.size()) {
        return false;
    }
    settings::KeyboardCode compiled;
    if (!settings::tryMakeKeyboardCode(code, compiled)) {
        return false;
    }
    destination[count] = compiled;
    ++count;
    return true;
}

[[nodiscard]] bool appendDefaults(
    const settings::InputAction action,
    ActionCodes& destination,
    std::uint8_t& count
) noexcept {
    const std::size_t actionIndex = static_cast<std::size_t>(action);
    if (actionIndex < movementDefaults.size()) {
        return appendCode(destination, count, movementDefaults[actionIndex][0U])
            && appendCode(destination, count, movementDefaults[actionIndex][1U]);
    }
    switch (action) {
    case settings::InputAction::primaryAction:
        return appendCode(destination, count, "Space");
    case settings::InputAction::pause:
        return appendCode(destination, count, "KeyP");
    case settings::InputAction::reload:
        return appendCode(destination, count, "KeyR");
    case settings::InputAction::debugPause:
        return appendCode(destination, count, "Slash");
    case settings::InputAction::debugStep:
        return appendCode(destination, count, "Period");
    case settings::InputAction::moveUp:
    case settings::InputAction::moveDown:
    case settings::InputAction::moveLeft:
    case settings::InputAction::moveRight:
    case settings::InputAction::count:
        break;
    }
    return false;
}

[[nodiscard]] bool compileBindings(
    const settings::InputBindings& overrides,
    CompiledBindings& output
) noexcept {
    CompiledBindings candidate;
    for (std::size_t actionIndex = 0U;
         actionIndex < settings::input_action_count;
         ++actionIndex) {
        const settings::InputBindingOverride& overrideValue =
            overrides.actions[actionIndex];
        if (overrideValue.count > settings::maximum_input_bindings_per_action
            || (!overrideValue.present && overrideValue.count != 0U)) {
            return false;
        }

        ActionCodes& codes = candidate.values[actionIndex];
        std::uint8_t& count = candidate.counts[actionIndex];
        if (!overrideValue.present) {
            if (!appendDefaults(
                    static_cast<settings::InputAction>(actionIndex),
                    codes,
                    count)) {
                return false;
            }
            continue;
        }

        for (std::size_t bindingIndex = 0U;
             bindingIndex < overrideValue.count;
             ++bindingIndex) {
            if (overrideValue.codes[bindingIndex].size
                > settings::maximum_keyboard_code_bytes) {
                return false;
            }
            const std::string_view code = overrideValue.codes[bindingIndex].view();
            if (!settings::isValidKeyboardCode(code)) {
                return false;
            }
            for (std::size_t prior = 0U; prior < bindingIndex; ++prior) {
                if (code == overrideValue.codes[prior].view()) {
                    return false;
                }
            }
            if (!appendCode(codes, count, code)) {
                return false;
            }
        }
    }
    output = candidate;
    return true;
}

[[nodiscard]] bool bindingsEqual(
    const CompiledBindings& candidate,
    const std::array<ActionCodes, settings::input_action_count>& bindings,
    const std::array<std::uint8_t, settings::input_action_count>& counts
) noexcept {
    for (std::size_t action = 0U; action < settings::input_action_count; ++action) {
        if (candidate.counts[action] != counts[action]) {
            return false;
        }
        for (std::size_t binding = 0U; binding < counts[action]; ++binding) {
            if (candidate.values[action][binding] != bindings[action][binding]) {
                return false;
            }
        }
    }
    return true;
}

} // namespace

InputBindingMap::InputBindingMap() noexcept {
    const InputBindingReplaceStatus status = replace({});
    static_cast<void>(status);
}

InputBindingReplaceStatus InputBindingMap::replace(
    const settings::InputBindings& overrides
) noexcept {
    CompiledBindings candidate;
    if (!compileBindings(overrides, candidate)) {
        return InputBindingReplaceStatus::rejectedInvalid;
    }
    if (bindingsEqual(candidate, bindings_, bindingCounts_)) {
        return InputBindingReplaceStatus::unchanged;
    }
    bindings_ = candidate.values;
    bindingCounts_ = candidate.counts;
    pressedMasks_.fill(0U);
    return InputBindingReplaceStatus::replaced;
}

InputActionTransitionBatch InputBindingMap::apply(
    const std::string_view keyboardCode,
    const bool pressed,
    const bool repeated
) noexcept {
    InputActionTransitionBatch result;
    if (!settings::isValidKeyboardCode(keyboardCode)) {
        return result;
    }

    for (std::size_t actionIndex = 0U;
         actionIndex < settings::input_action_count;
         ++actionIndex) {
        std::uint8_t matchedMask = 0U;
        for (std::size_t bindingIndex = 0U;
             bindingIndex < bindingCounts_[actionIndex];
             ++bindingIndex) {
            if (bindings_[actionIndex][bindingIndex].view() == keyboardCode) {
                matchedMask = static_cast<std::uint8_t>(1U << bindingIndex);
                break;
            }
        }
        if (matchedMask == 0U) {
            continue;
        }

        result.matched = true;
        const bool wasPressed = pressedMasks_[actionIndex] != 0U;
        if (pressed) {
            pressedMasks_[actionIndex] = static_cast<std::uint8_t>(
                pressedMasks_[actionIndex] | matchedMask
            );
        } else {
            pressedMasks_[actionIndex] = static_cast<std::uint8_t>(
                pressedMasks_[actionIndex] & ~matchedMask
            );
        }
        const bool isPressed = pressedMasks_[actionIndex] != 0U;
        if (wasPressed == isPressed) {
            continue;
        }
        result.values[result.count] = {
            .action = static_cast<settings::InputAction>(actionIndex),
            .pressed = isPressed,
            .repeated = repeated
        };
        ++result.count;
    }
    return result;
}

bool InputBindingMap::clearPressed() noexcept {
    const bool changed = std::any_of(
        pressedMasks_.begin(),
        pressedMasks_.end(),
        [](const std::uint8_t mask) noexcept { return mask != 0U; }
    );
    pressedMasks_.fill(0U);
    return changed;
}

std::uint8_t InputBindingMap::bindingCount(
    const settings::InputAction action
) const noexcept {
    return validAction(action)
        ? bindingCounts_[static_cast<std::size_t>(action)]
        : 0U;
}

std::string_view InputBindingMap::bindingCode(
    const settings::InputAction action,
    const std::size_t bindingIndex
) const noexcept {
    if (!validAction(action)) {
        return {};
    }
    const std::size_t actionIndex = static_cast<std::size_t>(action);
    return bindingIndex < bindingCounts_[actionIndex]
        ? bindings_[actionIndex][bindingIndex].view()
        : std::string_view{};
}

} // namespace cirvivor::input
