#pragma once

#include "render/common/pre_shaped_text.h"
#include "render/frontend/frame_packet_builder.h"
#include "ui/layout/ui_layout_metrics.h"
#include "ui/title_overlay_content.h"
#include "ui/title_overlay_state_machine.h"
#include "ui/title_ui_controller.h"

#include <cstdint>

namespace cirvivor::render::frontend {

/**
 * 타이틀 밖의 scene이 Debug overlay 한 장을 합성할 때 빌려 주는 immutable view입니다.
 * layout.viewport의 ww/wh가 logical bounds이며 반환 capacity는 기존 scene packet에
 * 필드별로 더해야 하는 순수 증분입니다.
 */
struct GlobalDebugOverlayInput final {
    const ui::UiStateSnapshot& uiState;
    const ui::TitleUiControllerSnapshot& interaction;
    const ui::layout::UiLayoutSnapshot& layout;
    const ui::layout::ThemeMetrics& theme;
    const ui::TitleOverlayPresentationSet& overlayPresentations;
    PreShapedTextResourcesView textResources{};
    UiTextLocale locale = UiTextLocale::korean;
    bool disableTransparency = false;
    std::uint64_t backdropRevision = 1U;
};

/** 제품 shaped-text generation을 포함하는 Debug overlay 증분 상한입니다. */
[[nodiscard]] constexpr FramePacketCapacity maximumGlobalDebugOverlayCapacity() noexcept {
    FramePacketCapacity capacity{};
    capacity.commandCount = 27U;
    capacity.shapeCount = 1U;
    capacity.uiCount = 7U;
    capacity.overlayCount = 5U;
    capacity.glyphRunCount = 8U;
    capacity.glyphInstanceCount = 8'192U;
    capacity.clipCount = 2U;
    capacity.passCount = 4U;
    return capacity;
}

/**
 * 선택된 Debug overlay 한 장의 정확한 additive capacity를 반환합니다.
 * Debug가 없거나 입력이 유효하지 않으면 zero capacity입니다.
 */
[[nodiscard]] FramePacketCapacity globalDebugOverlayCapacity(
    const GlobalDebugOverlayInput& input
) noexcept;

/**
 * 기존 FramePacketBuilder 뒤에 Debug overlay 한 장만 기록합니다. Debug가 없으면
 * true no-op이며, 잘못된 입력은 builder를 건드리기 전에 false를 반환합니다.
 * builder capacity 실패 뒤의 전체 frame rollback은 호출자가 abort()로 완료합니다.
 */
[[nodiscard]] bool addGlobalDebugOverlay(
    FramePacketBuilder& builder,
    const GlobalDebugOverlayInput& input
);

} // namespace cirvivor::render::frontend
