#include "platform/sdl/sdl_platform_event.h"

#include <SDL3/SDL_events.h>

namespace cirvivor::platform::sdl {
namespace {

struct MovementBinding final {
    PlatformAction action = PlatformAction::none;
    std::uint32_t sourceMask = 0;
};

[[nodiscard]] constexpr MovementBinding movementBinding(
    const SDL_Scancode scancode
) noexcept {
    switch (scancode) {
    case SDL_SCANCODE_W:
        return {PlatformAction::moveUp, 1U << 0U};
    case SDL_SCANCODE_UP:
        return {PlatformAction::moveUp, 1U << 1U};
    case SDL_SCANCODE_S:
        return {PlatformAction::moveDown, 1U << 2U};
    case SDL_SCANCODE_DOWN:
        return {PlatformAction::moveDown, 1U << 3U};
    case SDL_SCANCODE_A:
        return {PlatformAction::moveLeft, 1U << 4U};
    case SDL_SCANCODE_LEFT:
        return {PlatformAction::moveLeft, 1U << 5U};
    case SDL_SCANCODE_D:
        return {PlatformAction::moveRight, 1U << 6U};
    case SDL_SCANCODE_RIGHT:
        return {PlatformAction::moveRight, 1U << 7U};
    default:
        return {};
    }
}

} // namespace

PlatformEvent translateEvent(const SDL_Event& event) noexcept {
    switch (event.type) {
    case SDL_EVENT_QUIT:
        return {PlatformEventKind::quitRequested, 0};
    case SDL_EVENT_TERMINATING:
        return {PlatformEventKind::terminating, 0};
    case SDL_EVENT_LOW_MEMORY:
        return {PlatformEventKind::lowMemory, 0};
    case SDL_EVENT_WILL_ENTER_BACKGROUND:
        return {PlatformEventKind::willEnterBackground, 0};
    case SDL_EVENT_DID_ENTER_BACKGROUND:
        return {PlatformEventKind::didEnterBackground, 0};
    case SDL_EVENT_WILL_ENTER_FOREGROUND:
        return {PlatformEventKind::willEnterForeground, 0};
    case SDL_EVENT_DID_ENTER_FOREGROUND:
        return {PlatformEventKind::didEnterForeground, 0};
    case SDL_EVENT_WINDOW_CLOSE_REQUESTED:
        return {PlatformEventKind::quitRequested, event.window.windowID};
    case SDL_EVENT_WINDOW_FOCUS_GAINED:
        return {PlatformEventKind::focusGained, event.window.windowID};
    case SDL_EVENT_WINDOW_FOCUS_LOST:
        return {PlatformEventKind::focusLost, event.window.windowID};
    case SDL_EVENT_WINDOW_SHOWN:
    case SDL_EVENT_WINDOW_RESTORED:
        return {PlatformEventKind::windowShown, event.window.windowID};
    case SDL_EVENT_WINDOW_HIDDEN:
    case SDL_EVENT_WINDOW_MINIMIZED:
        return {PlatformEventKind::windowHidden, event.window.windowID};
    case SDL_EVENT_WINDOW_EXPOSED:
        return {PlatformEventKind::windowExposed, event.window.windowID};
    case SDL_EVENT_WINDOW_RESIZED:
    case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
    case SDL_EVENT_WINDOW_DISPLAY_CHANGED:
    case SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED:
    case SDL_EVENT_WINDOW_SAFE_AREA_CHANGED:
        return {PlatformEventKind::windowMetricsChanged, event.window.windowID};
    case SDL_EVENT_DISPLAY_ORIENTATION:
    case SDL_EVENT_DISPLAY_CONTENT_SCALE_CHANGED:
    case SDL_EVENT_DISPLAY_USABLE_BOUNDS_CHANGED:
        return {PlatformEventKind::windowMetricsChanged, 0};
    case SDL_EVENT_RENDER_TARGETS_RESET:
        return {PlatformEventKind::renderTargetsReset, event.render.windowID};
    case SDL_EVENT_RENDER_DEVICE_RESET:
        return {PlatformEventKind::renderDeviceReset, event.render.windowID};
    case SDL_EVENT_RENDER_DEVICE_LOST:
        return {PlatformEventKind::renderDeviceLost, event.render.windowID};
    case SDL_EVENT_KEY_DOWN:
    case SDL_EVENT_KEY_UP: {
        const MovementBinding binding = movementBinding(event.key.scancode);
        if (binding.action == PlatformAction::none) {
            return {};
        }
        return {
            PlatformEventKind::actionChanged,
            event.key.windowID,
            binding.action,
            event.type == SDL_EVENT_KEY_DOWN,
            binding.sourceMask
        };
    }
    default:
        return {};
    }
}

} // namespace cirvivor::platform::sdl
