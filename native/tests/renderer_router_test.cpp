#include "render/backend/renderer_router.h"
#include "render/common/frame_packet.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

using cirvivor::render::FramePacket;
using cirvivor::render::backend::BackendAttemptOutcome;
using cirvivor::render::backend::BackendInitializeResult;
using cirvivor::render::backend::IRenderBackend;
using cirvivor::render::backend::RenderBackendKind;
using cirvivor::render::backend::RenderCapabilities;
using cirvivor::render::backend::RendererBackendFactory;
using cirvivor::render::backend::RendererPreference;
using cirvivor::render::backend::RendererRouter;
using cirvivor::render::backend::RendererSelection;

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

constexpr std::size_t backend_count = 3;

[[nodiscard]] constexpr std::size_t backendIndex(const RenderBackendKind kind) noexcept {
    return static_cast<std::size_t>(kind);
}

enum class FactoryMode : std::uint8_t {
    backend = 0,
    returnNull = 1,
    throwException = 2
};

enum class InitializeMode : std::uint8_t {
    succeed = 0,
    fail = 1,
    throwException = 2
};

struct FakePlanEntry final {
    FactoryMode factoryMode = FactoryMode::backend;
    InitializeMode initializeMode = InitializeMode::succeed;
    RenderBackendKind reportedKind = RenderBackendKind::software;
    bool operationsSucceed = true;
    std::string reason;
};

struct FakeState final {
    std::vector<RenderBackendKind> factoryRequests;
    std::array<std::size_t, backend_count> initializeCalls{};
    std::array<std::size_t, backend_count> shutdownCalls{};
    std::array<std::size_t, backend_count> resizeCalls{};
    std::array<std::size_t, backend_count> renderCalls{};
    std::array<std::size_t, backend_count> backgroundCalls{};
    std::array<std::size_t, backend_count> foregroundCalls{};
    std::array<std::size_t, backend_count> purgeCalls{};
    std::array<std::size_t, backend_count> targetResetCalls{};
    std::int32_t lastWidth = 0;
    std::int32_t lastHeight = 0;
    const FramePacket* lastFrame = nullptr;
};

class FakeBackend final : public IRenderBackend {
public:
    FakeBackend(
        std::shared_ptr<FakeState> state,
        const RenderBackendKind requestedKind,
        FakePlanEntry plan
    )
        : state_(std::move(state)),
          requestedKind_(requestedKind),
          plan_(std::move(plan)) {
        capabilities_.hardwareAccelerated = plan_.reportedKind != RenderBackendKind::software;
        capabilities_.maximumTextureSize = 8'192;
        capabilities_.maximumSampleCount = 4;
        capabilities_.backendName = std::string(
            cirvivor::render::backend::renderBackendKindName(plan_.reportedKind)
        );
        capabilities_.adapterName = "fake-adapter";
    }

    [[nodiscard]] RenderBackendKind kind() const noexcept override {
        return plan_.reportedKind;
    }

    [[nodiscard]] const RenderCapabilities& capabilities() const noexcept override {
        return capabilities_;
    }

    [[nodiscard]] BackendInitializeResult initialize() override {
        ++state_->initializeCalls[backendIndex(requestedKind_)];
        switch (plan_.initializeMode) {
        case InitializeMode::succeed:
            return BackendInitializeResult::success();
        case InitializeMode::fail:
            return BackendInitializeResult::failure(plan_.reason);
        case InitializeMode::throwException:
            throw std::runtime_error(plan_.reason);
        }
        return BackendInitializeResult::failure("unknown fake initialize mode");
    }

    void shutdown() noexcept override {
        if (!shutdown_) {
            shutdown_ = true;
            ++state_->shutdownCalls[backendIndex(requestedKind_)];
        }
    }

    [[nodiscard]] bool resize(
        const std::int32_t drawableWidth,
        const std::int32_t drawableHeight
    ) noexcept override {
        ++state_->resizeCalls[backendIndex(requestedKind_)];
        state_->lastWidth = drawableWidth;
        state_->lastHeight = drawableHeight;
        return plan_.operationsSucceed;
    }

    [[nodiscard]] bool render(const FramePacket& frame) noexcept override {
        ++state_->renderCalls[backendIndex(requestedKind_)];
        state_->lastFrame = &frame;
        return plan_.operationsSucceed;
    }

    [[nodiscard]] bool onBackground() noexcept override {
        ++state_->backgroundCalls[backendIndex(requestedKind_)];
        return plan_.operationsSucceed;
    }

    [[nodiscard]] bool onForeground() noexcept override {
        ++state_->foregroundCalls[backendIndex(requestedKind_)];
        return plan_.operationsSucceed;
    }

    [[nodiscard]] bool purgeTransientResources() noexcept override {
        ++state_->purgeCalls[backendIndex(requestedKind_)];
        return plan_.operationsSucceed;
    }

    [[nodiscard]] bool onRenderTargetsReset() noexcept override {
        ++state_->targetResetCalls[backendIndex(requestedKind_)];
        return plan_.operationsSucceed;
    }

private:
    std::shared_ptr<FakeState> state_;
    RenderBackendKind requestedKind_;
    FakePlanEntry plan_;
    RenderCapabilities capabilities_;
    bool shutdown_ = false;
};

class FakeHarness final {
public:
    FakeHarness()
        : state(std::make_shared<FakeState>()),
          plan(std::make_shared<std::array<FakePlanEntry, backend_count>>()) {
        (*plan)[backendIndex(RenderBackendKind::sdlGpu)].reportedKind =
            RenderBackendKind::sdlGpu;
        (*plan)[backendIndex(RenderBackendKind::gles)].reportedKind =
            RenderBackendKind::gles;
        (*plan)[backendIndex(RenderBackendKind::software)].reportedKind =
            RenderBackendKind::software;
    }

    [[nodiscard]] FakePlanEntry& entry(const RenderBackendKind kind) noexcept {
        return (*plan)[backendIndex(kind)];
    }

    [[nodiscard]] RendererBackendFactory factory() const {
        const std::shared_ptr<FakeState> capturedState = state;
        const std::shared_ptr<std::array<FakePlanEntry, backend_count>> capturedPlan = plan;
        return [capturedState, capturedPlan](
            const RenderBackendKind requestedKind
        ) -> std::unique_ptr<IRenderBackend> {
            capturedState->factoryRequests.push_back(requestedKind);
            FakePlanEntry selectedPlan = (*capturedPlan)[backendIndex(requestedKind)];
            switch (selectedPlan.factoryMode) {
            case FactoryMode::backend:
                return std::make_unique<FakeBackend>(
                    capturedState,
                    requestedKind,
                    std::move(selectedPlan)
                );
            case FactoryMode::returnNull:
                return nullptr;
            case FactoryMode::throwException:
                throw std::runtime_error(selectedPlan.reason);
            }
            return nullptr;
        };
    }

    std::shared_ptr<FakeState> state;
    std::shared_ptr<std::array<FakePlanEntry, backend_count>> plan;
};

void testAutomaticOrderAndDiagnostics() {
    FakeHarness harness;
    harness.entry(RenderBackendKind::sdlGpu).initializeMode = InitializeMode::fail;
    harness.entry(RenderBackendKind::sdlGpu).reason = "gpu probe failed";
    harness.entry(RenderBackendKind::gles).initializeMode = InitializeMode::fail;
    harness.entry(RenderBackendKind::gles).reason = "gles context failed";

    RendererRouter router(harness.factory());
    REQUIRE(router.initialize({RendererPreference::automatic, true}));
    REQUIRE(harness.state->factoryRequests == std::vector<RenderBackendKind>({
        RenderBackendKind::sdlGpu,
        RenderBackendKind::gles,
        RenderBackendKind::software
    }));
    REQUIRE(router.selectedBackend() == RenderBackendKind::software);

    const auto& diagnostics = router.lastDiagnostics();
    REQUIRE(diagnostics.succeeded());
    REQUIRE(diagnostics.attempts.size() == 3U);
    REQUIRE(diagnostics.attempts[0].outcome == BackendAttemptOutcome::initializationFailed);
    REQUIRE(diagnostics.attempts[0].reason == "gpu probe failed");
    REQUIRE(diagnostics.attempts[1].outcome == BackendAttemptOutcome::initializationFailed);
    REQUIRE(diagnostics.attempts[1].reason == "gles context failed");
    REQUIRE(diagnostics.attempts[2].outcome == BackendAttemptOutcome::initialized);
    REQUIRE(harness.state->shutdownCalls[backendIndex(RenderBackendKind::sdlGpu)] == 1U);
    REQUIRE(harness.state->shutdownCalls[backendIndex(RenderBackendKind::gles)] == 1U);
}

void testAutomaticSkipsUnsupportedGles() {
    FakeHarness harness;
    harness.entry(RenderBackendKind::sdlGpu).initializeMode = InitializeMode::fail;
    harness.entry(RenderBackendKind::sdlGpu).reason = "no gpu";

    RendererRouter router(harness.factory());
    REQUIRE(router.initialize({RendererPreference::automatic, false}));
    REQUIRE(harness.state->factoryRequests == std::vector<RenderBackendKind>({
        RenderBackendKind::sdlGpu,
        RenderBackendKind::software
    }));
    REQUIRE(router.selectedBackend() == RenderBackendKind::software);
}

void testForcedModesUseRequiredFallbacks() {
    FakeHarness glesHarness;
    glesHarness.entry(RenderBackendKind::gles).initializeMode = InitializeMode::fail;
    glesHarness.entry(RenderBackendKind::gles).reason = "forced gles failed";
    RendererRouter glesRouter(glesHarness.factory());
    REQUIRE(glesRouter.initialize({RendererPreference::gles, false}));
    REQUIRE(glesHarness.state->factoryRequests == std::vector<RenderBackendKind>({
        RenderBackendKind::gles,
        RenderBackendKind::software
    }));

    FakeHarness softwareHarness;
    softwareHarness.entry(RenderBackendKind::software).initializeMode = InitializeMode::fail;
    softwareHarness.entry(RenderBackendKind::software).reason = "software failed";
    RendererRouter softwareRouter(softwareHarness.factory());
    REQUIRE(!softwareRouter.initialize({RendererPreference::software, true}));
    REQUIRE(softwareHarness.state->factoryRequests == std::vector<RenderBackendKind>({
        RenderBackendKind::software
    }));
}

void testExceptionsFallBackAcrossFactoryAndInitializeBoundaries() {
    FakeHarness harness;
    harness.entry(RenderBackendKind::sdlGpu).factoryMode = FactoryMode::throwException;
    harness.entry(RenderBackendKind::sdlGpu).reason = "factory explosion";
    harness.entry(RenderBackendKind::gles).initializeMode = InitializeMode::throwException;
    harness.entry(RenderBackendKind::gles).reason = "driver explosion";

    RendererRouter router(harness.factory());
    REQUIRE(router.initialize({RendererPreference::automatic, true}));
    REQUIRE(router.selectedBackend() == RenderBackendKind::software);

    const auto& attempts = router.lastDiagnostics().attempts;
    REQUIRE(attempts.size() == 3U);
    REQUIRE(attempts[0].outcome == BackendAttemptOutcome::factoryException);
    REQUIRE(attempts[0].reason.find("factory explosion") != std::string::npos);
    REQUIRE(attempts[1].outcome == BackendAttemptOutcome::initializationException);
    REQUIRE(attempts[1].reason.find("driver explosion") != std::string::npos);
    REQUIRE(attempts[2].outcome == BackendAttemptOutcome::initialized);
    REQUIRE(harness.state->shutdownCalls[backendIndex(RenderBackendKind::gles)] == 1U);
}

void testAllFailuresLeaveSafeNullState() {
    FakeHarness harness;
    harness.entry(RenderBackendKind::sdlGpu).factoryMode = FactoryMode::returnNull;
    harness.entry(RenderBackendKind::gles).initializeMode = InitializeMode::fail;
    harness.entry(RenderBackendKind::gles).reason.clear();
    harness.entry(RenderBackendKind::software).initializeMode = InitializeMode::fail;
    harness.entry(RenderBackendKind::software).reason = "surface unavailable";

    RendererRouter router(harness.factory());
    REQUIRE(!router.initialize({RendererPreference::automatic, true}));
    REQUIRE(!router.hasActiveBackend());
    REQUIRE(!router.selectedBackend().has_value());
    REQUIRE(router.capabilities() == nullptr);
    REQUIRE(!router.resize(640, 360));
    FramePacket frame;
    REQUIRE(!router.render(frame));
    REQUIRE(!router.onBackground());
    REQUIRE(!router.onForeground());
    REQUIRE(!router.purgeTransientResources());
    REQUIRE(!router.onRenderTargetsReset());

    const auto& diagnostics = router.lastDiagnostics();
    REQUIRE(!diagnostics.succeeded());
    REQUIRE(diagnostics.attempts.size() == 3U);
    REQUIRE(diagnostics.attempts[0].outcome == BackendAttemptOutcome::factoryReturnedNull);
    REQUIRE(diagnostics.attempts[1].reason == "backend initialization failed without a reason");
    REQUIRE(diagnostics.terminalFailureReason == "no render backend could be initialized");
}

void testLifecycleForwardingAndReinitializeGuard() {
    FakeHarness harness;
    RendererRouter router(harness.factory());
    REQUIRE(router.initialize({RendererPreference::software, false}));
    REQUIRE(router.hasActiveBackend());
    REQUIRE(router.capabilities() != nullptr);
    REQUIRE(router.capabilities()->backendName == "software");

    FramePacket frame;
    REQUIRE(router.resize(1'280, 720));
    REQUIRE(router.render(frame));
    REQUIRE(router.onBackground());
    REQUIRE(router.purgeTransientResources());
    REQUIRE(router.onRenderTargetsReset());
    REQUIRE(router.onForeground());
    const std::size_t requestCount = harness.state->factoryRequests.size();
    REQUIRE(!router.initialize({RendererPreference::automatic, true}));
    REQUIRE(harness.state->factoryRequests.size() == requestCount);
    REQUIRE(router.hasActiveBackend());
    REQUIRE(router.selectedBackend() == RenderBackendKind::software);
    REQUIRE(router.lastDiagnostics().attempts.empty());
    REQUIRE(router.lastDiagnostics().terminalFailureReason.find("already has an active backend")
        != std::string::npos);

    const std::size_t softwareIndex = backendIndex(RenderBackendKind::software);
    REQUIRE(harness.state->resizeCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->lastWidth == 1'280);
    REQUIRE(harness.state->lastHeight == 720);
    REQUIRE(harness.state->renderCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->lastFrame == &frame);
    REQUIRE(harness.state->backgroundCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->foregroundCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->purgeCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->targetResetCalls[softwareIndex] == 1U);

    router.shutdown();
    router.shutdown();
    REQUIRE(harness.state->shutdownCalls[softwareIndex] == 1U);
    REQUIRE(!router.hasActiveBackend());
    REQUIRE(!router.render(frame));
}

void testBackendOperationFailuresPropagate() {
    FakeHarness harness;
    harness.entry(RenderBackendKind::software).operationsSucceed = false;
    RendererRouter router(harness.factory());
    REQUIRE(router.initialize({RendererPreference::software, false}));

    FramePacket frame;
    REQUIRE(!router.resize(960, 540));
    REQUIRE(!router.render(frame));
    REQUIRE(!router.onBackground());
    REQUIRE(!router.onForeground());
    REQUIRE(!router.purgeTransientResources());
    REQUIRE(!router.onRenderTargetsReset());

    const std::size_t softwareIndex = backendIndex(RenderBackendKind::software);
    REQUIRE(harness.state->resizeCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->renderCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->backgroundCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->foregroundCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->purgeCalls[softwareIndex] == 1U);
    REQUIRE(harness.state->targetResetCalls[softwareIndex] == 1U);
}

void testKindMismatchIsRejectedAndRouterOwnsShutdown() {
    FakeHarness harness;
    harness.entry(RenderBackendKind::sdlGpu).reportedKind = RenderBackendKind::gles;
    const std::size_t softwareIndex = backendIndex(RenderBackendKind::software);
    {
        RendererRouter router(harness.factory());
        REQUIRE(router.initialize({RendererPreference::automatic, false}));
        REQUIRE(router.selectedBackend() == RenderBackendKind::software);
        REQUIRE(router.lastDiagnostics().attempts[0].outcome
            == BackendAttemptOutcome::backendKindMismatch);
        REQUIRE(harness.state->initializeCalls[backendIndex(RenderBackendKind::sdlGpu)] == 0U);
        REQUIRE(harness.state->shutdownCalls[backendIndex(RenderBackendKind::sdlGpu)] == 1U);
        REQUIRE(harness.state->shutdownCalls[softwareIndex] == 0U);
    }
    REQUIRE(harness.state->shutdownCalls[softwareIndex] == 1U);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"automatic order and diagnostics", testAutomaticOrderAndDiagnostics},
        TestCase{"automatic GLES gate", testAutomaticSkipsUnsupportedGles},
        TestCase{"forced mode fallbacks", testForcedModesUseRequiredFallbacks},
        TestCase{"exception fallbacks", testExceptionsFallBackAcrossFactoryAndInitializeBoundaries},
        TestCase{"all failure null state", testAllFailuresLeaveSafeNullState},
        TestCase{"lifecycle forwarding", testLifecycleForwardingAndReinitializeGuard},
        TestCase{"operation failure propagation", testBackendOperationFailuresPropagate},
        TestCase{"kind mismatch and RAII", testKindMismatchIsRejectedAndRouterOwnsShutdown}
    };

    std::size_t passed = 0;
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
