#include "render/backend/renderer_router.h"

#include <array>
#include <cstddef>
#include <exception>
#include <string>
#include <string_view>
#include <utility>

namespace cirvivor::render::backend {
namespace {

struct AttemptOrder final {
    std::array<RenderBackendKind, 3> kinds{};
    std::size_t count = 0;
};

[[nodiscard]] AttemptOrder makeAttemptOrder(const RendererSelection& selection) noexcept {
    AttemptOrder order;
    const auto append = [&order](const RenderBackendKind kind) noexcept {
        order.kinds[order.count] = kind;
        ++order.count;
    };

    switch (selection.preference) {
    case RendererPreference::automatic:
    case RendererPreference::sdlGpu:
        append(RenderBackendKind::sdlGpu);
        if (selection.platformSupportsGles) {
            append(RenderBackendKind::gles);
        }
        append(RenderBackendKind::software);
        break;
    case RendererPreference::gles:
        append(RenderBackendKind::gles);
        append(RenderBackendKind::software);
        break;
    case RendererPreference::software:
        append(RenderBackendKind::software);
        break;
    }

    return order;
}

[[nodiscard]] std::string exceptionReason(
    const std::string_view prefix,
    const std::exception& error
) {
    std::string reason(prefix);
    reason += error.what();
    return reason;
}

} // namespace

RendererRouter::RendererRouter(RendererBackendFactory factory)
    : factory_(std::move(factory)) {}

RendererRouter::~RendererRouter() noexcept {
    shutdown();
}

bool RendererRouter::initialize(const RendererSelection& selection) {
    lastDiagnostics_ = {};
    lastDiagnostics_.selection = selection;

    if (activeBackend_ != nullptr) {
        lastDiagnostics_.terminalFailureReason =
            "renderer already has an active backend; call shutdown before reinitializing";
        return false;
    }

    const AttemptOrder order = makeAttemptOrder(selection);
    for (std::size_t index = 0; index < order.count; ++index) {
        const RenderBackendKind requestedKind = order.kinds[index];
        BackendAttemptDiagnostic diagnostic;
        diagnostic.kind = requestedKind;

        std::unique_ptr<IRenderBackend> candidate;
        if (!factory_) {
            diagnostic.outcome = BackendAttemptOutcome::factoryReturnedNull;
            diagnostic.reason = "renderer backend factory is not configured";
            lastDiagnostics_.attempts.push_back(std::move(diagnostic));
            continue;
        }

        try {
            candidate = factory_(requestedKind);
        } catch (const std::exception& error) {
            diagnostic.outcome = BackendAttemptOutcome::factoryException;
            diagnostic.reason = exceptionReason("backend factory threw: ", error);
            lastDiagnostics_.attempts.push_back(std::move(diagnostic));
            continue;
        } catch (...) {
            diagnostic.outcome = BackendAttemptOutcome::factoryException;
            diagnostic.reason = "backend factory threw a non-standard exception";
            lastDiagnostics_.attempts.push_back(std::move(diagnostic));
            continue;
        }

        if (candidate == nullptr) {
            diagnostic.outcome = BackendAttemptOutcome::factoryReturnedNull;
            diagnostic.reason = "backend factory returned null";
            lastDiagnostics_.attempts.push_back(std::move(diagnostic));
            continue;
        }

        const RenderBackendKind actualKind = candidate->kind();
        if (actualKind != requestedKind) {
            diagnostic.outcome = BackendAttemptOutcome::backendKindMismatch;
            diagnostic.reason = "backend factory returned ";
            diagnostic.reason += renderBackendKindName(actualKind);
            diagnostic.reason += " while ";
            diagnostic.reason += renderBackendKindName(requestedKind);
            diagnostic.reason += " was requested";
            candidate->shutdown();
            lastDiagnostics_.attempts.push_back(std::move(diagnostic));
            continue;
        }

        try {
            BackendInitializeResult result = candidate->initialize();
            if (!result.succeeded()) {
                diagnostic.outcome = BackendAttemptOutcome::initializationFailed;
                diagnostic.reason = result.reason().empty()
                    ? "backend initialization failed without a reason"
                    : result.reason();
                candidate->shutdown();
                lastDiagnostics_.attempts.push_back(std::move(diagnostic));
                continue;
            }
        } catch (const std::exception& error) {
            diagnostic.outcome = BackendAttemptOutcome::initializationException;
            diagnostic.reason = exceptionReason("backend initialization threw: ", error);
            candidate->shutdown();
            lastDiagnostics_.attempts.push_back(std::move(diagnostic));
            continue;
        } catch (...) {
            diagnostic.outcome = BackendAttemptOutcome::initializationException;
            diagnostic.reason = "backend initialization threw a non-standard exception";
            candidate->shutdown();
            lastDiagnostics_.attempts.push_back(std::move(diagnostic));
            continue;
        }

        if (selection.requiresGlyphRunAtlas
            && !candidate->capabilities().supportsGlyphRunAtlas) {
            diagnostic.outcome = BackendAttemptOutcome::unsupportedCapabilities;
            diagnostic.reason = "backend does not support A8 glyph atlas rendering";
            candidate->shutdown();
            lastDiagnostics_.attempts.push_back(std::move(diagnostic));
            continue;
        }

        diagnostic.outcome = BackendAttemptOutcome::initialized;
        diagnostic.reason = "backend initialized";
        lastDiagnostics_.attempts.push_back(std::move(diagnostic));
        lastDiagnostics_.selectedBackend = requestedKind;
        activeBackend_ = std::move(candidate);
        return true;
    }

    lastDiagnostics_.terminalFailureReason = "no render backend could be initialized";
    return false;
}

void RendererRouter::shutdown() noexcept {
    if (activeBackend_ != nullptr) {
        activeBackend_->shutdown();
        activeBackend_.reset();
    }
}

bool RendererRouter::resize(
    const std::int32_t drawableWidth,
    const std::int32_t drawableHeight
) noexcept {
    if (activeBackend_ == nullptr) {
        return false;
    }
    return activeBackend_->resize(drawableWidth, drawableHeight);
}

bool RendererRouter::render(
    const FramePacket& frame,
    const RenderResourcesView resources
) noexcept {
    if (activeBackend_ == nullptr) {
        return false;
    }
    return activeBackend_->render(frame, resources);
}

bool RendererRouter::onBackground() noexcept {
    if (activeBackend_ == nullptr) {
        return false;
    }
    return activeBackend_->onBackground();
}

bool RendererRouter::onForeground() noexcept {
    if (activeBackend_ == nullptr) {
        return false;
    }
    return activeBackend_->onForeground();
}

bool RendererRouter::purgeTransientResources() noexcept {
    if (activeBackend_ == nullptr) {
        return false;
    }
    return activeBackend_->purgeTransientResources();
}

bool RendererRouter::onRenderTargetsReset() noexcept {
    if (activeBackend_ == nullptr) {
        return false;
    }
    return activeBackend_->onRenderTargetsReset();
}

bool RendererRouter::hasActiveBackend() const noexcept {
    return activeBackend_ != nullptr;
}

std::optional<RenderBackendKind> RendererRouter::selectedBackend() const noexcept {
    if (activeBackend_ == nullptr) {
        return std::nullopt;
    }
    return activeBackend_->kind();
}

const RenderCapabilities* RendererRouter::capabilities() const noexcept {
    return activeBackend_ == nullptr ? nullptr : &activeBackend_->capabilities();
}

std::uint64_t RendererRouter::lastFrameContentHash() const noexcept {
    return activeBackend_ == nullptr
        ? 0U
        : activeBackend_->lastFrameContentHash();
}

const RendererSelectionDiagnostics& RendererRouter::lastDiagnostics() const noexcept {
    return lastDiagnostics_;
}

} // namespace cirvivor::render::backend
