#include "settings/settings_repository.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <exception>
#include <iostream>
#include <new>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace {

using namespace cirvivor::settings;

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

class MemorySettingsStorage final : public ISettingsStorage {
public:
    [[nodiscard]] SettingsStorageExistsResult exists(
        const std::string_view path
    ) const noexcept override {
        ++existsCalls;
        if (existsStatus != SettingsStorageStatus::success) {
            return {existsStatus, false};
        }
        if (path == settings_file_path) {
            return {SettingsStorageStatus::success, mainExists};
        }
        if (path == settings_temporary_file_path) {
            return {SettingsStorageStatus::success, temporaryExists};
        }
        return {SettingsStorageStatus::invalidArgument, false};
    }

    [[nodiscard]] SettingsStorageReadResult read(
        const std::string_view path,
        const std::size_t maximumBytes
    ) const noexcept override {
        ++readCalls;
        if (readStatus != SettingsStorageStatus::success) {
            return {readStatus, {}};
        }

        const std::string* source = nullptr;
        if (path == settings_file_path && mainExists) {
            source = &mainFile;
        } else if (path == settings_temporary_file_path && temporaryExists) {
            source = &temporaryFile;
        } else if (path == settings_file_path
                   || path == settings_temporary_file_path) {
            return {SettingsStorageStatus::notFound, {}};
        } else {
            return {SettingsStorageStatus::invalidArgument, {}};
        }
        if (source->size() > maximumBytes) {
            return {SettingsStorageStatus::readLimitExceeded, {}};
        }

        SettingsStorageReadResult result;
        try {
            result.bytes.resize(source->size());
        } catch (const std::bad_alloc&) {
            result.status = SettingsStorageStatus::allocationFailed;
            return result;
        } catch (const std::length_error&) {
            result.status = SettingsStorageStatus::allocationFailed;
            return result;
        }
        std::transform(
            source->begin(),
            source->end(),
            result.bytes.begin(),
            [](const char byte) {
                return static_cast<std::byte>(
                    static_cast<unsigned char>(byte)
                );
            }
        );
        result.status = SettingsStorageStatus::success;
        return result;
    }

    [[nodiscard]] SettingsStorageStatus write(
        const std::string_view path,
        const std::span<const std::byte> bytes
    ) noexcept override {
        ++writeCalls;
        if (path != settings_temporary_file_path) {
            return SettingsStorageStatus::invalidArgument;
        }
        if (writeStatus != SettingsStorageStatus::success) {
            if (leavePartialTemporaryOnWriteFailure) {
                temporaryFile = "partial";
                temporaryExists = true;
            }
            return writeStatus;
        }

        std::string candidate;
        try {
            candidate.resize(bytes.size());
        } catch (const std::bad_alloc&) {
            return SettingsStorageStatus::allocationFailed;
        } catch (const std::length_error&) {
            return SettingsStorageStatus::allocationFailed;
        }
        std::transform(
            bytes.begin(),
            bytes.end(),
            candidate.begin(),
            [](const std::byte byte) {
                return static_cast<char>(std::to_integer<unsigned char>(byte));
            }
        );
        temporaryFile = std::move(candidate);
        temporaryExists = true;
        return SettingsStorageStatus::success;
    }

    [[nodiscard]] SettingsStorageStatus renameReplace(
        const std::string_view source,
        const std::string_view destination
    ) noexcept override {
        ++renameCalls;
        if (source != settings_temporary_file_path
            || destination != settings_file_path) {
            return SettingsStorageStatus::invalidArgument;
        }
        if (renameStatus != SettingsStorageStatus::success) {
            return renameStatus;
        }
        if (!temporaryExists) {
            return SettingsStorageStatus::notFound;
        }
        mainFile = std::move(temporaryFile);
        mainExists = true;
        temporaryFile.clear();
        temporaryExists = false;
        return SettingsStorageStatus::success;
    }

    [[nodiscard]] SettingsStorageStatus remove(
        const std::string_view path
    ) noexcept override {
        ++removeCalls;
        if (removeStatus != SettingsStorageStatus::success) {
            return removeStatus;
        }
        if (path == settings_temporary_file_path) {
            if (!temporaryExists) {
                return SettingsStorageStatus::notFound;
            }
            temporaryFile.clear();
            temporaryExists = false;
            return SettingsStorageStatus::success;
        }
        if (path == settings_file_path) {
            if (!mainExists) {
                return SettingsStorageStatus::notFound;
            }
            mainFile.clear();
            mainExists = false;
            return SettingsStorageStatus::success;
        }
        return SettingsStorageStatus::invalidArgument;
    }

    void seedMain(std::string text) {
        mainFile = std::move(text);
        mainExists = true;
    }

    mutable std::size_t existsCalls = 0U;
    mutable std::size_t readCalls = 0U;
    std::size_t writeCalls = 0U;
    std::size_t renameCalls = 0U;
    std::size_t removeCalls = 0U;
    SettingsStorageStatus existsStatus = SettingsStorageStatus::success;
    SettingsStorageStatus readStatus = SettingsStorageStatus::success;
    SettingsStorageStatus writeStatus = SettingsStorageStatus::success;
    SettingsStorageStatus renameStatus = SettingsStorageStatus::success;
    SettingsStorageStatus removeStatus = SettingsStorageStatus::success;
    bool leavePartialTemporaryOnWriteFailure = false;
    bool mainExists = false;
    bool temporaryExists = false;
    std::string mainFile;
    std::string temporaryFile;
};

[[nodiscard]] std::string canonical(const GameSettings& settings) {
    const SettingsEncodeResult encoded = encodeSettingsJson(settings);
    REQUIRE(encoded.succeeded());
    return encoded.json;
}

void testMissingUsesDefaultsWithoutCreatingFile() {
    MemorySettingsStorage storage;
    SettingsRepository repository(storage, {Language::korean});

    const SettingsLoadResult load = repository.load();

    REQUIRE(load.succeeded());
    REQUIRE(load.status == SettingsLoadStatus::defaultsForMissingFile);
    REQUIRE(repository.current() == makeDefaultSettings({Language::korean}));
    REQUIRE(!load.canonicalRewriteRequired);
    REQUIRE(storage.readCalls == 0U);
    REQUIRE(storage.writeCalls == 0U);
    REQUIRE(!storage.mainExists);
}

void testCanonicalFileLoadsWithoutRewrite() {
    MemorySettingsStorage storage;
    GameSettings expected = makeDefaultSettings();
    expected.theme = Theme::light;
    expected.width = 1'920;
    expected.height = 1'080;
    storage.seedMain(canonical(expected));
    SettingsRepository repository(storage);

    const SettingsLoadResult load = repository.load();

    REQUIRE(load.status == SettingsLoadStatus::loaded);
    REQUIRE(repository.current() == expected);
    REQUIRE(!load.canonicalRewriteRequired);
    REQUIRE(storage.writeCalls == 0U);
    REQUIRE(storage.renameCalls == 0U);
}

void testNonCanonicalFileIsRewrittenAtomically() {
    MemorySettingsStorage storage;
    storage.seedMain("{}");
    SettingsRepository repository(storage, {Language::korean});

    const SettingsLoadResult load = repository.load();

    REQUIRE(load.status == SettingsLoadStatus::loaded);
    REQUIRE(load.canonicalRewriteRequired);
    REQUIRE(load.canonicalRewriteSucceeded());
    REQUIRE(repository.current() == makeDefaultSettings({Language::korean}));
    REQUIRE(storage.mainFile == canonical(repository.current()));
    REQUIRE(!storage.temporaryExists);
    REQUIRE(storage.writeCalls == 1U);
    REQUIRE(storage.renameCalls == 1U);
}

void testCorruptFileRecoversDefaultsAndRewrites() {
    MemorySettingsStorage storage;
    storage.seedMain("{\"theme\":\"dark\"");
    SettingsRepository repository(storage, {Language::userLanguage});

    const SettingsLoadResult load = repository.load();

    REQUIRE(load.status == SettingsLoadStatus::defaultsRecoveredFromCorruptFile);
    REQUIRE(load.decodeError == SettingsDecodeError::malformedJson);
    REQUIRE(load.canonicalRewriteSucceeded());
    REQUIRE(repository.current() == makeDefaultSettings({Language::userLanguage}));
    REQUIRE(storage.mainFile == canonical(repository.current()));
}

void testOversizedFileRecoversWithoutReadingPayload() {
    MemorySettingsStorage storage;
    storage.seedMain(std::string(maximum_settings_json_bytes + 1U, 'x'));
    SettingsRepository repository(storage);

    const SettingsLoadResult load = repository.load();

    REQUIRE(load.status == SettingsLoadStatus::defaultsRecoveredFromCorruptFile);
    REQUIRE(load.decodeError == SettingsDecodeError::inputTooLarge);
    REQUIRE(load.canonicalRewriteSucceeded());
    REQUIRE(storage.mainFile == canonical(makeDefaultSettings()));
}

void testSaveCommitsDiskBeforeMemory() {
    MemorySettingsStorage storage;
    storage.seedMain(canonical(makeDefaultSettings()));
    SettingsRepository repository(storage);
    REQUIRE(repository.load().succeeded());

    GameSettings candidate = repository.current();
    candidate.theme = Theme::light;
    candidate.bgmVolumePercent = 77U;
    const SettingsSaveResult save = repository.save(candidate);

    REQUIRE(save.succeeded());
    REQUIRE(repository.current() == candidate);
    REQUIRE(storage.mainFile == canonical(candidate));
    REQUIRE(!storage.temporaryExists);
}

void testTemporaryWriteFailurePreservesDiskAndMemory() {
    MemorySettingsStorage storage;
    const GameSettings original = makeDefaultSettings();
    const std::string originalJson = canonical(original);
    storage.seedMain(originalJson);
    SettingsRepository repository(storage);
    REQUIRE(repository.load().succeeded());

    GameSettings candidate = original;
    candidate.sfxVolumePercent = 99U;
    storage.writeStatus = SettingsStorageStatus::ioFailure;
    storage.leavePartialTemporaryOnWriteFailure = true;
    const SettingsSaveResult save = repository.save(candidate);

    REQUIRE(save.error == SettingsSaveError::temporaryWriteFailed);
    REQUIRE(save.cleanupAttempted);
    REQUIRE(save.cleanupSucceeded);
    REQUIRE(repository.current() == original);
    REQUIRE(storage.mainFile == originalJson);
    REQUIRE(!storage.temporaryExists);
    REQUIRE(storage.renameCalls == 0U);
}

void testReplaceFailurePreservesDiskAndMemory() {
    MemorySettingsStorage storage;
    const GameSettings original = makeDefaultSettings();
    const std::string originalJson = canonical(original);
    storage.seedMain(originalJson);
    SettingsRepository repository(storage);
    REQUIRE(repository.load().succeeded());

    GameSettings candidate = original;
    candidate.uiScalePercent = 125U;
    storage.renameStatus = SettingsStorageStatus::ioFailure;
    const SettingsSaveResult save = repository.save(candidate);

    REQUIRE(save.error == SettingsSaveError::replaceFailed);
    REQUIRE(save.cleanupAttempted);
    REQUIRE(save.cleanupSucceeded);
    REQUIRE(repository.current() == original);
    REQUIRE(storage.mainFile == originalJson);
    REQUIRE(!storage.temporaryExists);
}

void testCleanupIsBestEffortAfterReplaceFailure() {
    MemorySettingsStorage storage;
    const GameSettings original = makeDefaultSettings();
    const std::string originalJson = canonical(original);
    storage.seedMain(originalJson);
    SettingsRepository repository(storage);
    REQUIRE(repository.load().succeeded());

    GameSettings candidate = original;
    candidate.debugMode = true;
    storage.renameStatus = SettingsStorageStatus::ioFailure;
    storage.removeStatus = SettingsStorageStatus::ioFailure;
    const SettingsSaveResult save = repository.save(candidate);

    REQUIRE(save.error == SettingsSaveError::replaceFailed);
    REQUIRE(save.cleanupAttempted);
    REQUIRE(!save.cleanupSucceeded);
    REQUIRE(repository.current() == original);
    REQUIRE(storage.mainFile == originalJson);
    REQUIRE(storage.temporaryExists);
}

void testInvalidSaveNeverTouchesStorage() {
    MemorySettingsStorage storage;
    const GameSettings original = makeDefaultSettings();
    storage.seedMain(canonical(original));
    SettingsRepository repository(storage);
    REQUIRE(repository.load().succeeded());

    GameSettings candidate = original;
    candidate.width = minimum_window_width - 1;
    const SettingsSaveResult save = repository.save(candidate);

    REQUIRE(save.error == SettingsSaveError::invalidSettings);
    REQUIRE(save.validation.error == SettingsValidationError::invalidWindowWidth);
    REQUIRE(repository.current() == original);
    REQUIRE(storage.writeCalls == 0U);
    REQUIRE(storage.renameCalls == 0U);
    REQUIRE(storage.removeCalls == 0U);
}

void testRewriteFailureKeepsDecodedValueAndOldFile() {
    MemorySettingsStorage storage;
    storage.seedMain(R"({"theme":"light"})");
    const std::string originalJson = storage.mainFile;
    storage.renameStatus = SettingsStorageStatus::ioFailure;
    SettingsRepository repository(storage);

    const SettingsLoadResult load = repository.load();

    REQUIRE(load.succeeded());
    REQUIRE(load.status == SettingsLoadStatus::loaded);
    REQUIRE(load.canonicalRewriteRequired);
    REQUIRE(!load.canonicalRewriteSucceeded());
    REQUIRE(load.canonicalRewrite.error == SettingsSaveError::replaceFailed);
    REQUIRE(repository.current().theme == Theme::light);
    REQUIRE(storage.mainFile == originalJson);
    REQUIRE(!storage.temporaryExists);
}

void testStorageFailurePreservesCurrentValue() {
    MemorySettingsStorage storage;
    GameSettings expected = makeDefaultSettings();
    expected.language = Language::korean;
    storage.seedMain(canonical(expected));
    SettingsRepository repository(storage);
    REQUIRE(repository.load().succeeded());
    REQUIRE(repository.current() == expected);

    storage.readStatus = SettingsStorageStatus::ioFailure;
    storage.seedMain("{}");
    const SettingsLoadResult load = repository.load();

    REQUIRE(!load.succeeded());
    REQUIRE(load.status == SettingsLoadStatus::storageFailure);
    REQUIRE(load.storageStatus == SettingsStorageStatus::ioFailure);
    REQUIRE(repository.current() == expected);
    REQUIRE(storage.writeCalls == 0U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    constexpr std::array tests{
        TestCase{"missing file uses defaults", testMissingUsesDefaultsWithoutCreatingFile},
        TestCase{"canonical file loads", testCanonicalFileLoadsWithoutRewrite},
        TestCase{"non-canonical file rewrites", testNonCanonicalFileIsRewrittenAtomically},
        TestCase{"corrupt file recovers", testCorruptFileRecoversDefaultsAndRewrites},
        TestCase{"oversized file recovers", testOversizedFileRecoversWithoutReadingPayload},
        TestCase{"save commits disk before memory", testSaveCommitsDiskBeforeMemory},
        TestCase{"write failure is atomic", testTemporaryWriteFailurePreservesDiskAndMemory},
        TestCase{"replace failure is atomic", testReplaceFailurePreservesDiskAndMemory},
        TestCase{"cleanup is best effort", testCleanupIsBestEffortAfterReplaceFailure},
        TestCase{"invalid save is side-effect free", testInvalidSaveNeverTouchesStorage},
        TestCase{"rewrite failure keeps decoded value", testRewriteFailureKeepsDecodedValueAndOldFile},
        TestCase{"storage failure preserves current", testStorageFailurePreservesCurrentValue}
    };

    std::size_t passed = 0U;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }
    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
