#pragma once

#include "render/common/render_resources.h"

#include <cstddef>
#include <cstdint>
#include <span>

namespace cirvivor::render {

enum class UiTextLocale : std::uint8_t {
    korean = 0,
    english = 1
};

enum class UiTextSemanticId : std::uint16_t {
    titleCardStart,
    titleCardQuickStart,
    titleCardQuickStartDescription,
    titleCardRecords,
    titleCardDeck,
    titleCardDeckDescription,
    titleCardResearch,
    titleCardResearchDescription,
    utilitySetting,
    utilityCredits,
    utilityAchievements,
    utilityExit,
    versionLabel,
    versionHistoryLink,
    mapSelectTitle,
    mapName,
    mapSelected,
    mapDescription,
    mapCancel,
    mapStart,
    exitTitle,
    exitBody,
    exitNo,
    exitYes,
    externalTitle,
    externalBody,
    externalUrlGoogle,
    externalUrlJukchang,
    externalUrlCirVivor,
    externalUrlPretendard,
    externalUrlOutfit,
    externalUrlReactBits,
    externalNo,
    externalYes
};

/** logicalPixelSizeMilli는 layout px를 1/1000 단위로 보존합니다. */
struct PreShapedTextKey final {
    UiTextSemanticId semantic = UiTextSemanticId::titleCardStart;
    UiTextLocale locale = UiTextLocale::korean;
    std::uint32_t logicalPixelSizeMilli = 0;
    std::int32_t weight = 400;

    constexpr bool operator==(const PreShapedTextKey&) const noexcept = default;
};

struct PreShapedTextRunView final {
    PreShapedTextKey key{};
    ResourceId fontId = invalid_resource_id;
    ResourceId glyphAtlasId = invalid_resource_id;
    std::uint32_t rasterPixelSize = 0;
    float advance = 0.0F;
    float ascent = 0.0F;
    float descent = 0.0F;
    std::span<const GlyphInstance> glyphs;

    [[nodiscard]] constexpr float logicalPixelSize() const noexcept {
        return static_cast<float>(key.logicalPixelSizeMilli) / 1'000.0F;
    }

    [[nodiscard]] constexpr float logicalScale() const noexcept {
        return rasterPixelSize == 0U
            ? 0.0F
            : logicalPixelSize() / static_cast<float>(rasterPixelSize);
    }

    [[nodiscard]] constexpr float logicalAdvance() const noexcept {
        return advance * logicalScale();
    }
};

/**
 * immutable ShapedTextCache가 빌려 주는 allocation-free lookup view입니다.
 * 포함된 span은 그 snapshot과 해당 render() 호출보다 오래 저장하면 안 됩니다.
 */
class PreShapedTextResourcesView final {
public:
    constexpr PreShapedTextResourcesView() noexcept = default;

    constexpr PreShapedTextResourcesView(
        const std::uint64_t generation,
        const std::span<const PreShapedTextRunView> runs,
        const RenderResourcesView renderResources
    ) noexcept
        : generation_(generation), runs_(runs), renderResources_(renderResources) {}

    [[nodiscard]] constexpr bool isValid() const noexcept {
        if (generation_ == 0U || !renderResources_.isValid()) {
            return false;
        }
        for (std::size_t index = 0U; index < runs_.size(); ++index) {
            const PreShapedTextRunView& run = runs_[index];
            if (run.key.logicalPixelSizeMilli == 0U
                || run.fontId == invalid_resource_id
                || run.glyphAtlasId == invalid_resource_id
                || run.rasterPixelSize == 0U
                || renderResources_.findAlpha8(run.glyphAtlasId, generation_) == nullptr) {
                return false;
            }
            for (std::size_t other = index + 1U; other < runs_.size(); ++other) {
                if (run.key == runs_[other].key) {
                    return false;
                }
            }
        }
        return true;
    }

    [[nodiscard]] constexpr const PreShapedTextRunView* find(
        const PreShapedTextKey& key
    ) const noexcept {
        for (const PreShapedTextRunView& run : runs_) {
            if (run.key == key) {
                return &run;
            }
        }
        return nullptr;
    }

    [[nodiscard]] constexpr std::uint64_t generation() const noexcept {
        return generation_;
    }

    [[nodiscard]] constexpr std::span<const PreShapedTextRunView> runs() const noexcept {
        return runs_;
    }

    [[nodiscard]] constexpr RenderResourcesView renderResources() const noexcept {
        return renderResources_;
    }

private:
    std::uint64_t generation_ = 0;
    std::span<const PreShapedTextRunView> runs_;
    RenderResourcesView renderResources_;
};

} // namespace cirvivor::render
