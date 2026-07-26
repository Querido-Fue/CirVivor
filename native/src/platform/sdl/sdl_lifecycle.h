#pragma once

#include "platform/sdl/sdl_platform_event.h"

namespace cirvivor::platform::sdl {

struct LifecycleUpdate final {
    bool becameActive = false;
    bool becameInactive = false;
    bool requestRedraw = false;
};

class SdlLifecycle final {
public:
    void reset() noexcept;
    void synchronize(bool focused, bool visible) noexcept;

    [[nodiscard]] LifecycleUpdate apply(PlatformEventKind eventKind) noexcept;

    [[nodiscard]] bool isActive() const noexcept;
    [[nodiscard]] bool isBackgrounded() const noexcept;
    [[nodiscard]] bool isFocused() const noexcept;
    [[nodiscard]] bool isVisible() const noexcept;

private:
    bool backgrounded_ = false;
    bool focused_ = true;
    bool visible_ = true;
};

} // namespace cirvivor::platform::sdl
