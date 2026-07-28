#pragma once

#include "render/common/pre_shaped_text.h"
#include "render/frontend/frame_packet_builder.h"
#include "ui/title_overlay_content.h"
#include "ui/title_ui_controller.h"

namespace cirvivor::render::frontend {

struct TitleOverlayPresenterInput final {
    const ui::TitleOverlayPresentation& presentation;
    const ui::OverlaySnapshot& overlay;
    const ui::TitleUiControllerSnapshot& interaction;
    const ui::layout::UiLayoutSnapshot& layout;
    const ui::layout::ThemeMetrics& theme;
    PreShapedTextResourcesView textResources{};
    UiTextLocale locale = UiTextLocale::korean;
    CommandHeader header{};
    bool disableTransparency = false;
};

/**
 * 공통 panel 안의 실제 overlay content를 fixed-capacity builder에 기록합니다.
 * panel clip/session과 dim/glass pass는 title scene이 소유합니다.
 */
[[nodiscard]] bool addTitleOverlayPresentation(
    FramePacketBuilder& builder,
    const TitleOverlayPresenterInput& input
);

} // namespace cirvivor::render::frontend
