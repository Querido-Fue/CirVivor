#define SDL_MAIN_USE_CALLBACKS 1
#include <SDL3/SDL.h>
#include <SDL3/SDL_main.h>

#include "app/application.h"
#include "platform/sdl/sdl_platform_event.h"

#include <memory>
#include <mutex>
#include <utility>
#include <vector>

namespace {

constexpr std::size_t maximumPendingEventCount = 4'096;

struct CallbackState final {
    cirvivor::app::Application application;
    std::mutex eventMutex;
    std::vector<cirvivor::platform::sdl::PlatformEvent> pendingEvents;
};

std::mutex callbackStateMutex;
std::shared_ptr<CallbackState> registeredCallbackState;

[[nodiscard]] std::shared_ptr<CallbackState> acquireCallbackState(
    const void* const appstate
) {
    std::lock_guard lock(callbackStateMutex);
    if (registeredCallbackState == nullptr
        || registeredCallbackState.get() != appstate) {
        return {};
    }
    return registeredCallbackState;
}

[[nodiscard]] SDL_AppResult toSdlResult(
    const cirvivor::app::ApplicationResult result
) noexcept {
    switch (result) {
    case cirvivor::app::ApplicationResult::success:
        return SDL_APP_SUCCESS;
    case cirvivor::app::ApplicationResult::failure:
        return SDL_APP_FAILURE;
    case cirvivor::app::ApplicationResult::continueRunning:
    default:
        return SDL_APP_CONTINUE;
    }
}

} // namespace

SDL_AppResult SDL_AppInit(void** appstate, const int argc, char* argv[]) {
    std::shared_ptr<CallbackState> state;
    try {
        state = std::make_shared<CallbackState>();
    } catch (...) {
        SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "Application allocation failed.");
        return SDL_APP_FAILURE;
    }

    {
        std::lock_guard lock(callbackStateMutex);
        if (registeredCallbackState != nullptr) {
            SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "Application state is already registered.");
            return SDL_APP_FAILURE;
        }
        registeredCallbackState = state;
    }
    *appstate = state.get();
    return state->application.initialize(argc, argv)
        ? SDL_APP_CONTINUE
        : SDL_APP_FAILURE;
}

SDL_AppResult SDL_AppEvent(void* appstate, SDL_Event* event) {
    if (appstate == nullptr || event == nullptr) {
        return SDL_APP_FAILURE;
    }
    const std::shared_ptr<CallbackState> state = acquireCallbackState(appstate);
    if (state == nullptr) {
        return SDL_APP_CONTINUE;
    }

    const cirvivor::platform::sdl::PlatformEvent platformEvent =
        cirvivor::platform::sdl::translateEvent(*event);
    if (platformEvent.kind == cirvivor::platform::sdl::PlatformEventKind::none) {
        return SDL_APP_CONTINUE;
    }

    try {
        std::lock_guard lock(state->eventMutex);
        if (state->pendingEvents.size() >= maximumPendingEventCount) {
            SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "Platform event queue overflowed.");
            return SDL_APP_FAILURE;
        }
        state->pendingEvents.push_back(platformEvent);
    } catch (...) {
        SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "Platform event queue allocation failed.");
        return SDL_APP_FAILURE;
    }
    return SDL_APP_CONTINUE;
}

SDL_AppResult SDL_AppIterate(void* appstate) {
    if (appstate == nullptr) {
        return SDL_APP_FAILURE;
    }
    const std::shared_ptr<CallbackState> state = acquireCallbackState(appstate);
    if (state == nullptr) {
        return SDL_APP_FAILURE;
    }

    std::vector<cirvivor::platform::sdl::PlatformEvent> pendingEvents;
    {
        std::lock_guard lock(state->eventMutex);
        pendingEvents.swap(state->pendingEvents);
    }
    for (const cirvivor::platform::sdl::PlatformEvent& event : pendingEvents) {
        const cirvivor::app::ApplicationResult result = state->application.handleEvent(event);
        if (result != cirvivor::app::ApplicationResult::continueRunning) {
            return toSdlResult(result);
        }
    }
    return toSdlResult(state->application.iterate());
}

void SDL_AppQuit(void* appstate, SDL_AppResult result) {
    static_cast<void>(result);
    std::shared_ptr<CallbackState> state;
    {
        std::lock_guard lock(callbackStateMutex);
        if (registeredCallbackState != nullptr
            && registeredCallbackState.get() == appstate) {
            state = std::move(registeredCallbackState);
        }
    }
    if (state != nullptr) {
        state->application.shutdown();
    }
}
