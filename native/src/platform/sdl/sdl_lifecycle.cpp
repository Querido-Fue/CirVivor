#include "platform/sdl/sdl_lifecycle.h"

namespace cirvivor::platform::sdl {

void SdlLifecycle::reset() noexcept {
    backgrounded_ = false;
    focused_ = true;
    visible_ = true;
}

void SdlLifecycle::synchronize(const bool focused, const bool visible) noexcept {
    focused_ = focused;
    visible_ = visible;
}

LifecycleUpdate SdlLifecycle::apply(const PlatformEventKind eventKind) noexcept {
    const bool wasActive = isActive();
    LifecycleUpdate update;

    switch (eventKind) {
    case PlatformEventKind::willEnterBackground:
    case PlatformEventKind::didEnterBackground:
        backgrounded_ = true;
        break;
    case PlatformEventKind::didEnterForeground:
        backgrounded_ = false;
        update.requestRedraw = true;
        break;
    case PlatformEventKind::focusGained:
        focused_ = true;
        update.requestRedraw = true;
        break;
    case PlatformEventKind::focusLost:
        focused_ = false;
        break;
    case PlatformEventKind::windowShown:
        visible_ = true;
        update.requestRedraw = true;
        break;
    case PlatformEventKind::windowHidden:
        visible_ = false;
        break;
    case PlatformEventKind::windowExposed:
    case PlatformEventKind::windowMetricsChanged:
        update.requestRedraw = true;
        break;
    default:
        break;
    }

    const bool active = isActive();
    update.becameActive = !wasActive && active;
    update.becameInactive = wasActive && !active;
    return update;
}

bool SdlLifecycle::isActive() const noexcept {
    return !backgrounded_ && focused_ && visible_;
}

bool SdlLifecycle::isBackgrounded() const noexcept {
    return backgrounded_;
}

bool SdlLifecycle::isFocused() const noexcept {
    return focused_;
}

bool SdlLifecycle::isVisible() const noexcept {
    return visible_;
}

} // namespace cirvivor::platform::sdl
