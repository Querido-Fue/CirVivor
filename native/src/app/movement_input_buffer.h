#pragma once

#include "game/game_system.h"

#include <array>
#include <cstdint>

namespace cirvivor::app {

enum class MovementInputChannel : std::uint8_t {
    up,
    down,
    left,
    right
};

// Preserves a press until at least one authoritative fixed update consumes it.
// This keeps short down/up pairs from disappearing when SDL drains both events
// before the next fixed step, while held sources remain level-triggered.
class MovementInputBuffer final {
public:
    void apply(
        MovementInputChannel channel,
        std::uint32_t sourceMask,
        bool pressed
    ) noexcept;

    [[nodiscard]] game::MovementActionState consumeFixedStep() noexcept;
    void clear() noexcept;

private:
    [[nodiscard]] static std::size_t channelIndex(
        MovementInputChannel channel
    ) noexcept;
    [[nodiscard]] game::MovementActionState heldActions() const noexcept;

    std::array<std::uint32_t, 4> sourceMasks_{};
    std::array<bool, 4> pendingPresses_{};
};

} // namespace cirvivor::app
