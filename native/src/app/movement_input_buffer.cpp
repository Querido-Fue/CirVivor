#include "app/movement_input_buffer.h"

#include <cstddef>

namespace cirvivor::app {

std::size_t MovementInputBuffer::channelIndex(
    const MovementInputChannel channel
) noexcept {
    switch (channel) {
    case MovementInputChannel::up:
        return 0U;
    case MovementInputChannel::down:
        return 1U;
    case MovementInputChannel::left:
        return 2U;
    case MovementInputChannel::right:
        return 3U;
    }
    return 0U;
}

void MovementInputBuffer::apply(
    const MovementInputChannel channel,
    const std::uint32_t sourceMask,
    const bool pressed
) noexcept {
    if (sourceMask == 0U) {
        return;
    }

    const std::size_t index = channelIndex(channel);
    const bool actionWasHeld = sourceMasks_[index] != 0U;
    if (pressed) {
        sourceMasks_[index] |= sourceMask;
        if (!actionWasHeld) {
            pendingPresses_[index] = true;
        }
    } else {
        sourceMasks_[index] &= ~sourceMask;
    }
}

game::MovementActionState MovementInputBuffer::consumeFixedStep() noexcept {
    game::MovementActionState actions = heldActions();
    actions.moveUp = actions.moveUp || pendingPresses_[0];
    actions.moveDown = actions.moveDown || pendingPresses_[1];
    actions.moveLeft = actions.moveLeft || pendingPresses_[2];
    actions.moveRight = actions.moveRight || pendingPresses_[3];
    pendingPresses_.fill(false);
    return actions;
}

void MovementInputBuffer::clear() noexcept {
    sourceMasks_.fill(0U);
    pendingPresses_.fill(false);
}

game::MovementActionState MovementInputBuffer::heldActions() const noexcept {
    return {
        sourceMasks_[0] != 0U,
        sourceMasks_[1] != 0U,
        sourceMasks_[2] != 0U,
        sourceMasks_[3] != 0U
    };
}

} // namespace cirvivor::app
