#pragma once

#include "render/frontend/debug_telemetry_hud.h"
#include "render/frontend/frame_packet_builder.h"
#include "render/frontend/global_debug_overlay.h"

#include <cstdint>

namespace cirvivor::render::frontend {

struct SyntheticSceneConfig final {
    SizeI physicalDisplaySize{960, 540};
    RectI physicalWindowBounds{0, 0, 960, 540};
    SizeI drawableSize{960, 540};
    InsetsI safeArea{};
    float dpiScale = 1.0F;
    float uiScale = 1.0F;
    float worldRenderScale = 1.0F;
    std::uint64_t projectionRevision = 1;
    std::uint64_t frameId = 1;
    std::uint64_t simulationTick = 1;
    std::uint32_t phaseStep = 0;
    std::uint32_t seed = 0x00c1'2a57U;
    EffectQuality effectQuality = EffectQuality::full;
};

struct SyntheticSceneResult final {
    bool success = false;
    FrameBuildError error = FrameBuildError::none;
};

/** 테스트 장면의 모든 command와 UTF-8 문자열을 무할당으로 담기 위한 권장 capacity입니다. */
[[nodiscard]] constexpr FramePacketCapacity syntheticTestSceneCapacity() noexcept {
    return {
        25,
        6,
        3,
        2,
        5,
        4,
        2,
        4,
        256
    };
}

/** 기존 synthetic 장면과 선택적 Debug overlay를 함께 담는 exact capacity입니다. */
[[nodiscard]] FramePacketCapacity syntheticTestSceneCapacity(
    const GlobalDebugOverlayInput& globalDebugOverlay,
    const DebugTelemetryHudInput* debugTelemetry = nullptr
) noexcept;

[[nodiscard]] constexpr FramePacketCapacity maximumSyntheticTestSceneCapacity() noexcept {
    return additiveFramePacketCapacity(
        additiveFramePacketCapacity(
            syntheticTestSceneCapacity(),
            maximumGlobalDebugOverlayCapacity()
        ),
        additiveFramePacketCapacity(
            maximumDebugPoolHudCapacity(),
            maximumDebugTopHudCapacity()
        )
    );
}

[[nodiscard]] ViewportState makeSyntheticViewport(const SyntheticSceneConfig& config) noexcept;

/**
 * backend나 SDL 상태를 읽지 않고 같은 config에서 byte-identical command 값을 만듭니다.
 * packet은 호출 간 재사용할 수 있습니다.
 */
[[nodiscard]] SyntheticSceneResult buildSyntheticTestScene(
    FramePacket& packet,
    const SyntheticSceneConfig& config = {},
    PacketCapacityPolicy capacityPolicy = PacketCapacityPolicy::growAsNeeded,
    const GlobalDebugOverlayInput* globalDebugOverlay = nullptr,
    const DebugTelemetryHudInput* debugTelemetry = nullptr
);

} // namespace cirvivor::render::frontend
