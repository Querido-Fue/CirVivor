#include "platform/sdl/storage/sdl_settings_storage.h"
#include "platform/sdl/storage/sdl_user_storage.h"
#include "settings/settings_repository.h"

#include <SDL3/SDL_init.h>
#include <SDL3/SDL_timer.h>

#include <array>
#include <cstddef>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

using namespace cirvivor;

class TestFailure final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void require(
    const bool condition,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!condition) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)

class SdlGuard final {
public:
    SdlGuard() {
        REQUIRE(SDL_Init(0));
    }

    ~SdlGuard() {
        SDL_Quit();
    }

    SdlGuard(const SdlGuard&) = delete;
    SdlGuard& operator=(const SdlGuard&) = delete;
};

void waitUntilReady(platform::sdl::SdlUserStorage& storage) {
    constexpr std::size_t maximumAttempts = 1'000U;
    for (std::size_t attempt = 0U; attempt < maximumAttempts; ++attempt) {
        if (storage.readyState() == platform::sdl::StorageReadyState::ready) {
            return;
        }
        SDL_Delay(1U);
    }
    REQUIRE(false);
}

void removeIfPresent(
    platform::sdl::SdlUserStorage& storage,
    const char* const path
) {
    const platform::sdl::StorageExistsResult exists = storage.exists(path);
    REQUIRE(exists.succeeded());
    if (exists.exists) {
        REQUIRE(storage.remove(path) == platform::sdl::StorageResult::success);
    }
}

void testRepositoryRoundTripAndRecovery() {
    SdlGuard guard;
    platform::sdl::SdlUserStorage storage;
    REQUIRE(storage.open("CirVivorTests", "NativeSettingsStorage")
        == platform::sdl::StorageResult::success);
    waitUntilReady(storage);
    removeIfPresent(storage, "settings.json.tmp");
    removeIfPresent(storage, "settings.json");

    platform::sdl::SdlSettingsStorage adapter(storage);
    settings::SettingsRepository repository(
        adapter,
        {settings::Language::korean}
    );
    const settings::SettingsLoadResult missing = repository.load();
    REQUIRE(missing.status == settings::SettingsLoadStatus::defaultsForMissingFile);

    settings::GameSettings candidate = repository.current();
    candidate.theme = settings::Theme::light;
    candidate.uiScalePercent = 125U;
    REQUIRE(repository.save(candidate).succeeded());
    REQUIRE(repository.current() == candidate);

    const platform::sdl::StorageExistsResult mainExists = storage.exists(
        "settings.json"
    );
    const platform::sdl::StorageExistsResult temporaryExists = storage.exists(
        "settings.json.tmp"
    );
    REQUIRE(mainExists.succeeded());
    REQUIRE(mainExists.exists);
    REQUIRE(temporaryExists.succeeded());
    REQUIRE(!temporaryExists.exists);

    settings::SettingsRepository reloaded(
        adapter,
        {settings::Language::korean}
    );
    const settings::SettingsLoadResult loaded = reloaded.load();
    REQUIRE(loaded.status == settings::SettingsLoadStatus::loaded);
    REQUIRE(reloaded.current() == candidate);

    constexpr std::string_view corrupt = "{\"theme\":\"dark\"";
    const std::span corruptBytes(
        reinterpret_cast<const std::byte*>(corrupt.data()),
        corrupt.size()
    );
    REQUIRE(storage.write("settings.json", corruptBytes)
        == platform::sdl::StorageResult::success);
    const settings::SettingsLoadResult recovered = reloaded.load();
    REQUIRE(recovered.status
        == settings::SettingsLoadStatus::defaultsRecoveredFromCorruptFile);
    REQUIRE(recovered.canonicalRewriteSucceeded());
    REQUIRE(reloaded.current()
        == settings::makeDefaultSettings({settings::Language::korean}));

    removeIfPresent(storage, "settings.json.tmp");
    removeIfPresent(storage, "settings.json");
    REQUIRE(storage.close() == platform::sdl::StorageResult::success);
}

} // namespace

int main() {
    try {
        testRepositoryRoundTripAndRecovery();
        std::cout << "[PASS] SDL settings storage roundtrip and recovery\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "[FAIL] SDL settings storage: " << error.what() << '\n';
        return 1;
    }
}
