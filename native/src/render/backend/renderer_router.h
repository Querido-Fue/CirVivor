#pragma once

#include "render/backend/render_backend.h"

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace cirvivor::render::backend {

enum class RendererPreference : std::uint8_t {
    automatic = 0,
    sdlGpu = 1,
    gles = 2,
    software = 3
};

enum class BackendAttemptOutcome : std::uint8_t {
    initialized = 0,
    factoryReturnedNull = 1,
    factoryException = 2,
    backendKindMismatch = 3,
    initializationFailed = 4,
    initializationException = 5,
    unsupportedCapabilities = 6
};

struct RendererSelection final {
    RendererPreference preference = RendererPreference::automatic;
    bool platformSupportsGles = false;
    bool requiresGlyphRunAtlas = false;

    constexpr bool operator==(const RendererSelection&) const noexcept = default;
};

struct BackendAttemptDiagnostic final {
    RenderBackendKind kind = RenderBackendKind::software;
    BackendAttemptOutcome outcome = BackendAttemptOutcome::initializationFailed;
    std::string reason;

    bool operator==(const BackendAttemptDiagnostic&) const = default;
};

struct RendererSelectionDiagnostics final {
    RendererSelection selection;
    std::vector<BackendAttemptDiagnostic> attempts;
    std::optional<RenderBackendKind> selectedBackend;
    std::string terminalFailureReason;

    [[nodiscard]] bool succeeded() const noexcept {
        return selectedBackend.has_value();
    }
};

using RendererBackendFactory =
    std::function<std::unique_ptr<IRenderBackend>(RenderBackendKind kind)>;

/**
 * 선택된 backend 하나만 소유합니다. initialize()는 활성 backend가 있는 동안
 * 거부되며, 명시적인 shutdown() 뒤에만 새 선택을 시작할 수 있습니다.
 */
class RendererRouter final {
public:
    explicit RendererRouter(RendererBackendFactory factory);
    ~RendererRouter() noexcept;

    RendererRouter(const RendererRouter&) = delete;
    RendererRouter& operator=(const RendererRouter&) = delete;
    RendererRouter(RendererRouter&&) = delete;
    RendererRouter& operator=(RendererRouter&&) = delete;

    [[nodiscard]] bool initialize(const RendererSelection& selection);
    void shutdown() noexcept;

    [[nodiscard]] bool resize(
        std::int32_t drawableWidth,
        std::int32_t drawableHeight
    ) noexcept;
    [[nodiscard]] bool render(
        const FramePacket& frame,
        RenderResourcesView resources = {}
    ) noexcept;
    [[nodiscard]] bool onBackground() noexcept;
    [[nodiscard]] bool onForeground() noexcept;
    [[nodiscard]] bool purgeTransientResources() noexcept;
    [[nodiscard]] bool onRenderTargetsReset() noexcept;

    [[nodiscard]] bool hasActiveBackend() const noexcept;
    [[nodiscard]] std::optional<RenderBackendKind> selectedBackend() const noexcept;
    [[nodiscard]] const RenderCapabilities* capabilities() const noexcept;
    [[nodiscard]] const RendererSelectionDiagnostics& lastDiagnostics() const noexcept;

private:
    RendererBackendFactory factory_;
    std::unique_ptr<IRenderBackend> activeBackend_;
    RendererSelectionDiagnostics lastDiagnostics_;
};

} // namespace cirvivor::render::backend
