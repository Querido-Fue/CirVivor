#pragma once

#include "game/game_system.h"
#include "render/frontend/frame_packet_builder.h"

#include <cstdint>

namespace cirvivor::render::frontend {

struct PlayableGameSceneConfig final {
    SizeI physicalDisplaySize{1'280, 720};
    RectI physicalWindowBounds{0, 0, 1'280, 720};
    SizeI drawableSize{1'280, 720};
    InsetsI safeArea{};
    float dpiScale = 1.0F;
    float uiScale = 1.0F;
    float worldRenderScale = 1.0F;
    float cameraZoom = 0.7F;
    std::uint64_t projectionRevision = 1;
    std::uint64_t frameId = 1;
    std::uint64_t simulationTick = 0;
    double presentationTimeSeconds = -1.0;
    float interpolationAlpha = 0.0F;
};

struct PlayableGameSceneResult final {
    bool success = false;
    FrameBuildError error = FrameBuildError::none;
};

/**
 * 현재 GameSystem 맵의 연속된 walkable 행 구간과 경로, Core/Tower를 모두 담는
 * 정확한 권장 capacity를 계산합니다. 반환값으로 packet을 한 번 reserve한 뒤
 * fixedCapacity 정책을 사용하면 반복 프레임 빌드에서 heap 할당이 없습니다.
 */
[[nodiscard]] FramePacketCapacity playableGameSceneCapacity(
    const game::GameSystem& gameSystem
) noexcept;

/** 현재 단일 맵 카탈로그가 요구하는 playable packet의 고정 상한입니다. */
[[nodiscard]] constexpr FramePacketCapacity maximumPlayableGameSceneCapacity() noexcept {
    FramePacketCapacity capacity{};
    capacity.commandCount = 94U;
    capacity.shapeCount = 70U;
    capacity.lineCount = 24U;
    return capacity;
}

/**
 * 플랫폼이 전달한 창·drawable·safe-area·DPI와 플레이 월드를 backend 중립
 * ViewportState로 변환합니다. 기본 zoom은 전체 맵 중앙, 더 큰 zoom은 보간된
 * Tower 위치를 중앙에 두며 simulation 좌표는 변경하지 않습니다.
 */
[[nodiscard]] ViewportState makePlayableGameViewport(
    const game::GameSystem& gameSystem,
    const PlayableGameSceneConfig& config = {}
) noexcept;

/**
 * 실제 C++ GameSystem의 corridor 맵과 보간된 Core/Tower 상태를 FramePacket으로
 * 만듭니다. synthetic smoke 장면의 texture/effect/UI 명령은 포함하지 않습니다.
 */
[[nodiscard]] PlayableGameSceneResult buildPlayableGameScene(
    FramePacket& packet,
    const game::GameSystem& gameSystem,
    const PlayableGameSceneConfig& config = {},
    PacketCapacityPolicy capacityPolicy = PacketCapacityPolicy::growAsNeeded
);

} // namespace cirvivor::render::frontend
