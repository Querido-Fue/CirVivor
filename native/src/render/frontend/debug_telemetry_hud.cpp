#include "render/frontend/debug_telemetry_hud.h"

#include "render/text/title_text_catalog.h"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>

namespace cirvivor::render::frontend {
namespace {

constexpr std::size_t performance_section_count = static_cast<std::size_t>(
    debug::DebugPerformanceSection::count
);
constexpr double minimum_visible_average_milliseconds = 0.01;
constexpr double maximum_display_milliseconds = 9'999'999'999'999.99;
constexpr float white = 1.0F;

constexpr StableElementId frame_panel_id = stableResourceId(
    "debug.telemetry.frame.panel"
);
constexpr StableElementId pool_panel_id = stableResourceId(
    "debug.telemetry.pool.panel"
);

constexpr std::array performance_sections{
    debug::DebugPerformanceSection::frameCpu,
    debug::DebugPerformanceSection::updateBuild,
    debug::DebugPerformanceSection::fixedUpdate,
    debug::DebugPerformanceSection::sceneBuild,
    debug::DebugPerformanceSection::renderCall
};
static_assert(performance_sections.size() == performance_section_count);

constexpr std::array performance_semantics{
    UiTextSemanticId::debugProfilerFrameCpu,
    UiTextSemanticId::debugProfilerUpdateBuild,
    UiTextSemanticId::debugProfilerFixedUpdate,
    UiTextSemanticId::debugProfilerSceneBuild,
    UiTextSemanticId::debugProfilerRenderCall
};
static_assert(performance_semantics.size() == performance_section_count);

constexpr std::array pool_semantics{
    UiTextSemanticId::debugPoolPhysicsBodies,
    UiTextSemanticId::debugPoolFrameCommands,
    UiTextSemanticId::debugPoolGlyphAtlas
};
static_assert(pool_semantics.size() == maximum_debug_pool_usage_count);

constexpr std::array numeric_semantics{
    UiTextSemanticId::debugTelemetryDigit0,
    UiTextSemanticId::debugTelemetryDigit1,
    UiTextSemanticId::debugTelemetryDigit2,
    UiTextSemanticId::debugTelemetryDigit3,
    UiTextSemanticId::debugTelemetryDigit4,
    UiTextSemanticId::debugTelemetryDigit5,
    UiTextSemanticId::debugTelemetryDigit6,
    UiTextSemanticId::debugTelemetryDigit7,
    UiTextSemanticId::debugTelemetryDigit8,
    UiTextSemanticId::debugTelemetryDigit9,
    UiTextSemanticId::debugTelemetryDecimalPoint,
    UiTextSemanticId::debugTelemetrySlash,
    UiTextSemanticId::debugTelemetryDash
};

struct HudTextResources final {
    const PreShapedTextRunView* profilerHeader = nullptr;
    std::array<const PreShapedTextRunView*, performance_section_count>
        performanceLabels{};
    std::array<const PreShapedTextRunView*, maximum_debug_pool_usage_count>
        poolLabels{};
    std::array<const PreShapedTextRunView*, numeric_semantics.size()>
        numeric{};
};

struct PerformanceRow final {
    debug::DebugPerformanceSection section =
        debug::DebugPerformanceSection::frameCpu;
    const debug::DebugPerformanceSectionSnapshot* snapshot = nullptr;
    const PreShapedTextRunView* label = nullptr;
};

struct NumericToken final {
    std::array<
        UiTextSemanticId,
        maximum_debug_numeric_token_glyph_count
    > semantics{};
    std::size_t count = 0U;
};

struct NumericGlyphAssembly final {
    std::array<GlyphInstance, maximum_debug_numeric_token_glyph_count> glyphs{};
    std::size_t count = 0U;
    float advance = 0.0F;
    const PreShapedTextRunView* style = nullptr;
};

struct HudArea final {
    float x = 0.0F;
    float y = 0.0F;
    float width = 0.0F;
    float height = 0.0F;
};

[[nodiscard]] constexpr bool validLocale(const UiTextLocale locale) noexcept {
    switch (locale) {
    case UiTextLocale::korean:
    case UiTextLocale::english:
        return true;
    }
    return false;
}

[[nodiscard]] constexpr bool validPoolKind(const DebugPoolKind kind) noexcept {
    return kind >= DebugPoolKind::physicsBodies && kind < DebugPoolKind::count;
}

[[nodiscard]] constexpr std::size_t poolIndex(const DebugPoolKind kind) noexcept {
    return static_cast<std::size_t>(kind);
}

[[nodiscard]] constexpr std::size_t sectionIndex(
    const debug::DebugPerformanceSection section
) noexcept {
    return static_cast<std::size_t>(section);
}

[[nodiscard]] bool finiteGlyph(const GlyphInstance& glyph) noexcept {
    const auto finiteVector = [](const Vec2F value) noexcept {
        return std::isfinite(value.x) && std::isfinite(value.y);
    };
    return finiteVector(glyph.position)
        && finiteVector(glyph.advance)
        && finiteVector(glyph.offset)
        && std::isfinite(glyph.uv.x)
        && std::isfinite(glyph.uv.y)
        && std::isfinite(glyph.uv.width)
        && std::isfinite(glyph.uv.height)
        && glyph.uv.x >= 0.0F
        && glyph.uv.y >= 0.0F
        && glyph.uv.width >= 0.0F
        && glyph.uv.height >= 0.0F
        && glyph.uv.x + glyph.uv.width <= 1.0F
        && glyph.uv.y + glyph.uv.height <= 1.0F;
}

[[nodiscard]] bool validTextRun(
    const PreShapedTextRunView* const run,
    const std::size_t maximumGlyphCount,
    const bool requireSingleGlyph
) noexcept {
    if (run == nullptr
        || run->fontId == invalid_resource_id
        || run->glyphAtlasId == invalid_resource_id
        || run->rasterPixelSize == 0U
        || run->key.weight < 1
        || run->key.weight > 1'000
        || run->glyphs.empty()
        || run->glyphs.size() > maximumGlyphCount
        || (requireSingleGlyph && run->glyphs.size() != 1U)
        || !std::isfinite(run->advance)
        || !std::isfinite(run->ascent)
        || !std::isfinite(run->descent)
        || run->advance <= 0.0F
        || run->ascent < 0.0F
        || run->descent < 0.0F) {
        return false;
    }
    return std::all_of(
        run->glyphs.begin(),
        run->glyphs.end(),
        finiteGlyph
    );
}

[[nodiscard]] bool sameNumericStyle(
    const PreShapedTextRunView& first,
    const PreShapedTextRunView& second
) noexcept {
    return first.fontId == second.fontId
        && first.glyphAtlasId == second.glyphAtlasId
        && first.rasterPixelSize == second.rasterPixelSize
        && first.key.weight == second.key.weight
        && first.key.logicalPixelSizeMilli == second.key.logicalPixelSizeMilli
        && first.key.locale == second.key.locale;
}

[[nodiscard]] const PreShapedTextRunView* findRun(
    const DebugTelemetryHudInput& input,
    const UiTextSemanticId semantic
) noexcept {
    return input.textResources.find(text::titleTextKey(semantic, input.locale));
}

[[nodiscard]] bool resolveTextResources(
    const DebugTelemetryHudInput& input,
    HudTextResources& output
) noexcept {
    if (!input.showFrameTime && !input.showPoolInfo) {
        output = {};
        return true;
    }
    if (!input.textResources.isValid() || !validLocale(input.locale)) {
        return false;
    }

    HudTextResources candidate{};
    if (input.showFrameTime) {
        candidate.profilerHeader = findRun(
            input,
            UiTextSemanticId::debugProfilerHeader
        );
        if (!validTextRun(
                candidate.profilerHeader,
                maximum_debug_static_text_glyph_count,
                false
            )) {
            return false;
        }
        for (std::size_t index = 0U;
             index < candidate.performanceLabels.size();
             ++index) {
            candidate.performanceLabels[index] = findRun(
                input,
                performance_semantics[index]
            );
            if (!validTextRun(
                    candidate.performanceLabels[index],
                    maximum_debug_static_text_glyph_count,
                    false
                )) {
                return false;
            }
        }
    }

    if (input.showPoolInfo) {
        for (std::size_t index = 0U;
             index < candidate.poolLabels.size();
             ++index) {
            candidate.poolLabels[index] = findRun(input, pool_semantics[index]);
            if (!validTextRun(
                    candidate.poolLabels[index],
                    maximum_debug_static_text_glyph_count,
                    false
                )) {
                return false;
            }
        }
    }

    if (input.showFrameTime || input.showPoolInfo) {
        for (std::size_t index = 0U; index < numeric_semantics.size(); ++index) {
            candidate.numeric[index] = findRun(input, numeric_semantics[index]);
            if (!validTextRun(candidate.numeric[index], 1U, true)) {
                return false;
            }
        }
        for (std::size_t index = 1U; index < candidate.numeric.size(); ++index) {
            if (!sameNumericStyle(
                    *candidate.numeric[0],
                    *candidate.numeric[index]
                )) {
                return false;
            }
        }
    }

    output = candidate;
    return true;
}

[[nodiscard]] bool validPerformanceSection(
    const debug::DebugPerformanceSectionSnapshot& section
) noexcept {
    if (!section.hasSamples) {
        return section.sampleCount == 0U
            && section.averageMilliseconds == 0.0
            && section.lastMilliseconds == 0.0
            && section.maximumMilliseconds == 0.0;
    }
    if (section.sampleCount == 0U
        || !std::isfinite(section.averageMilliseconds)
        || !std::isfinite(section.lastMilliseconds)
        || !std::isfinite(section.maximumMilliseconds)
        || section.averageMilliseconds < 0.0
        || section.lastMilliseconds < 0.0
        || section.maximumMilliseconds < 0.0
        || section.averageMilliseconds > maximum_display_milliseconds
        || section.lastMilliseconds > maximum_display_milliseconds
        || section.maximumMilliseconds > maximum_display_milliseconds) {
        return false;
    }
    constexpr double tolerance = 1.0e-9;
    return section.averageMilliseconds <= section.maximumMilliseconds + tolerance
        && section.lastMilliseconds <= section.maximumMilliseconds + tolerance;
}

[[nodiscard]] bool validPerformanceSnapshot(
    const debug::DebugPerformanceSnapshot& snapshot
) noexcept {
    return std::all_of(
        snapshot.sections.begin(),
        snapshot.sections.end(),
        validPerformanceSection
    );
}

[[nodiscard]] bool validPools(const DebugTelemetryHudInput& input) noexcept {
    if (input.poolCount > input.pools.size()) {
        return false;
    }
    for (std::size_t index = 0U; index < input.poolCount; ++index) {
        const DebugPoolUsage& pool = input.pools[index];
        if (!validPoolKind(pool.kind)
            || pool.active > pool.allocated
            || pool.allocated > pool.capacity) {
            return false;
        }
        for (std::size_t previous = 0U; previous < index; ++previous) {
            if (input.pools[previous].kind == pool.kind) {
                return false;
            }
        }
    }
    return true;
}

[[nodiscard]] bool validPremultipliedColor(
    const PremultipliedRgba color
) noexcept {
    if (!std::isfinite(color.red)
        || !std::isfinite(color.green)
        || !std::isfinite(color.blue)
        || !std::isfinite(color.alpha)
        || color.alpha <= 0.0F
        || color.alpha > 1.0F
        || color.red < 0.0F
        || color.green < 0.0F
        || color.blue < 0.0F) {
        return false;
    }
    constexpr float tolerance = 1.0e-6F;
    return color.red <= color.alpha + tolerance
        && color.green <= color.alpha + tolerance
        && color.blue <= color.alpha + tolerance;
}

[[nodiscard]] bool validHitboxes(const DebugTelemetryHudInput& input) noexcept {
    if (input.hitboxCount > input.hitboxes.size()) {
        return false;
    }
    for (std::size_t index = 0U; index < input.hitboxCount; ++index) {
        const DebugHitboxCircle& circle = input.hitboxes[index];
        if (!std::isfinite(circle.center.x)
            || !std::isfinite(circle.center.y)
            || !std::isfinite(circle.radius)
            || !std::isfinite(circle.strokeWidth)
            || circle.radius <= 0.0F
            || circle.strokeWidth <= 0.0F
            || !validPremultipliedColor(circle.color)) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool anyHudEnabled(const DebugTelemetryHudInput& input) noexcept {
    return input.showFrameTime || input.showPoolInfo || input.showHitboxes;
}

[[nodiscard]] std::size_t buildPerformanceRows(
    const DebugTelemetryHudInput& input,
    const HudTextResources& resources,
    std::array<PerformanceRow, performance_section_count>& output
) noexcept {
    output[0] = {
        debug::DebugPerformanceSection::frameCpu,
        &input.performance.section(debug::DebugPerformanceSection::frameCpu),
        resources.performanceLabels[0]
    };
    std::size_t count = 1U;
    for (std::size_t index = 1U; index < performance_sections.size(); ++index) {
        const debug::DebugPerformanceSection section = performance_sections[index];
        const auto& snapshot = input.performance.section(section);
        if (!snapshot.hasSamples
            || snapshot.averageMilliseconds
                < minimum_visible_average_milliseconds) {
            continue;
        }
        output[count++] = {
            section,
            &snapshot,
            resources.performanceLabels[index]
        };
    }
    std::sort(
        output.begin() + 1,
        output.begin() + static_cast<std::ptrdiff_t>(count),
        [](const PerformanceRow& left, const PerformanceRow& right) noexcept {
            if (left.snapshot->averageMilliseconds
                != right.snapshot->averageMilliseconds) {
                return left.snapshot->averageMilliseconds
                    > right.snapshot->averageMilliseconds;
            }
            return sectionIndex(left.section) < sectionIndex(right.section);
        }
    );
    return count;
}

[[nodiscard]] UiTextSemanticId semanticForCharacter(const char value) noexcept {
    if (value >= '0' && value <= '9') {
        return static_cast<UiTextSemanticId>(
            static_cast<std::uint16_t>(UiTextSemanticId::debugTelemetryDigit0)
                + static_cast<std::uint16_t>(value - '0')
        );
    }
    switch (value) {
    case '.':
        return UiTextSemanticId::debugTelemetryDecimalPoint;
    case '/':
        return UiTextSemanticId::debugTelemetrySlash;
    case '-':
        return UiTextSemanticId::debugTelemetryDash;
    default:
        return UiTextSemanticId::debugTelemetryDash;
    }
}

[[nodiscard]] bool appendCharacter(
    NumericToken& token,
    const char value
) noexcept {
    if (token.count >= token.semantics.size()) {
        return false;
    }
    token.semantics[token.count++] = semanticForCharacter(value);
    return true;
}

[[nodiscard]] bool appendUnsigned(
    NumericToken& token,
    const std::uint64_t value
) noexcept {
    std::array<char, 32U> buffer{};
    const auto conversion = std::to_chars(
        buffer.data(),
        buffer.data() + buffer.size(),
        value
    );
    if (conversion.ec != std::errc{}) {
        return false;
    }
    for (const char* cursor = buffer.data(); cursor < conversion.ptr; ++cursor) {
        if (!appendCharacter(token, *cursor)) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool appendFixedTwo(
    NumericToken& token,
    const double milliseconds
) noexcept {
    if (!std::isfinite(milliseconds)
        || milliseconds < 0.0
        || milliseconds > maximum_display_milliseconds) {
        return false;
    }
    const long double scaled = std::floor(
        static_cast<long double>(milliseconds) * 100.0L + 0.5L
    );
    if (scaled < 0.0L
        || scaled > static_cast<long double>(
            std::numeric_limits<std::uint64_t>::max()
        )) {
        return false;
    }
    const std::uint64_t hundredths = static_cast<std::uint64_t>(scaled);
    return appendUnsigned(token, hundredths / 100U)
        && appendCharacter(token, '.')
        && appendCharacter(
            token,
            static_cast<char>('0' + ((hundredths / 10U) % 10U))
        )
        && appendCharacter(
            token,
            static_cast<char>('0' + (hundredths % 10U))
        );
}

[[nodiscard]] bool buildPerformanceToken(
    const debug::DebugPerformanceSectionSnapshot& snapshot,
    NumericToken& output
) noexcept {
    NumericToken candidate{};
    if (!snapshot.hasSamples) {
        if (!appendCharacter(candidate, '-')
            || !appendCharacter(candidate, '/')
            || !appendCharacter(candidate, '-')
            || !appendCharacter(candidate, '/')
            || !appendCharacter(candidate, '-')) {
            return false;
        }
    } else if (!appendFixedTwo(candidate, snapshot.averageMilliseconds)
        || !appendCharacter(candidate, '/')
        || !appendFixedTwo(candidate, snapshot.lastMilliseconds)
        || !appendCharacter(candidate, '/')
        || !appendFixedTwo(candidate, snapshot.maximumMilliseconds)) {
        return false;
    }
    output = candidate;
    return true;
}

[[nodiscard]] bool buildPoolToken(
    const DebugPoolUsage& pool,
    NumericToken& output
) noexcept {
    NumericToken candidate{};
    if (!appendUnsigned(candidate, pool.active)
        || !appendCharacter(candidate, '/')
        || !appendUnsigned(candidate, pool.allocated)
        || !appendCharacter(candidate, '/')
        || !appendUnsigned(candidate, pool.capacity)) {
        return false;
    }
    output = candidate;
    return true;
}

[[nodiscard]] std::size_t numericIndex(
    const UiTextSemanticId semantic
) noexcept {
    for (std::size_t index = 0U; index < numeric_semantics.size(); ++index) {
        if (numeric_semantics[index] == semantic) {
            return index;
        }
    }
    return numeric_semantics.size();
}

[[nodiscard]] const PreShapedTextRunView* numericRun(
    const HudTextResources& resources,
    const UiTextSemanticId semantic
) noexcept {
    const std::size_t index = numericIndex(semantic);
    return index < resources.numeric.size() ? resources.numeric[index] : nullptr;
}

[[nodiscard]] bool assembleNumericGlyphs(
    const HudTextResources& resources,
    const NumericToken& token,
    NumericGlyphAssembly& output
) noexcept {
    NumericGlyphAssembly candidate{};
    float pen = 0.0F;
    for (std::size_t index = 0U; index < token.count; ++index) {
        const PreShapedTextRunView* const run = numericRun(
            resources,
            token.semantics[index]
        );
        if (run == nullptr || run->glyphs.size() != 1U
            || !std::isfinite(pen + run->advance)) {
            return false;
        }
        if (candidate.style == nullptr) {
            candidate.style = run;
        }
        GlyphInstance glyph = run->glyphs.front();
        glyph.position.x += pen;
        candidate.glyphs[candidate.count++] = glyph;
        pen += run->advance;
    }
    if (candidate.style == nullptr || candidate.count == 0U) {
        return false;
    }
    candidate.advance = pen;
    output = candidate;
    return true;
}

[[nodiscard]] bool resolveHudArea(
    const ViewportState& viewport,
    HudArea& output
) noexcept {
    const RectF content = viewport.logicalUi.contentRect;
    const InsetsF safe = viewport.logicalUi.safeArea;
    if (!std::isfinite(content.x)
        || !std::isfinite(content.y)
        || !std::isfinite(content.width)
        || !std::isfinite(content.height)
        || !std::isfinite(safe.left)
        || !std::isfinite(safe.top)
        || !std::isfinite(safe.right)
        || !std::isfinite(safe.bottom)
        || content.width <= 0.0F
        || content.height <= 0.0F
        || safe.left < 0.0F
        || safe.top < 0.0F
        || safe.right < 0.0F
        || safe.bottom < 0.0F
        || safe.left + safe.right >= content.width
        || safe.top + safe.bottom >= content.height) {
        return false;
    }
    output = {
        content.x + safe.left,
        content.y + safe.top,
        content.width - safe.left - safe.right,
        content.height - safe.top - safe.bottom
    };
    return true;
}

[[nodiscard]] CommandHeader makeHeader(
    const RenderLayer layer,
    const CoordinateSpace coordinateSpace,
    const std::int32_t layerOrder
) noexcept {
    return {
        layer,
        coordinateSpace,
        BlendMode::premultipliedAlpha,
        0U,
        layerOrder,
        0U
    };
}

[[nodiscard]] float logicalAdvance(
    const PreShapedTextRunView& run,
    const float fontSize
) noexcept {
    return run.advance * fontSize / static_cast<float>(run.rasterPixelSize);
}

[[nodiscard]] float numericLogicalAdvance(
    const HudTextResources& resources,
    const NumericToken& token,
    const float fontSize
) noexcept {
    float advance = 0.0F;
    for (std::size_t index = 0U; index < token.count; ++index) {
        const PreShapedTextRunView* const run = numericRun(
            resources,
            token.semantics[index]
        );
        if (run != nullptr) {
            advance += logicalAdvance(*run, fontSize);
        }
    }
    return advance;
}

[[nodiscard]] GlyphRunCommand makeGlyphCommand(
    const CommandHeader header,
    const PreShapedTextRunView& style,
    const float fontSize,
    const float x,
    const float top
) noexcept {
    const float scale = fontSize / static_cast<float>(style.rasterPixelSize);
    const Vec2F origin{x, top + style.ascent * scale};
    GlyphRunCommand command{};
    command.header = header;
    command.fontId = style.fontId;
    command.glyphAtlasId = style.glyphAtlasId;
    command.origin = origin;
    command.pixelsPerEm = fontSize;
    command.weight = style.key.weight;
    command.color = PremultipliedRgba::opaque(white, white, white);
    command.transform.elements = {
        scale, 0.0F, origin.x * (1.0F - scale),
        0.0F, scale, origin.y * (1.0F - scale),
        0.0F, 0.0F, 1.0F
    };
    command.sampling = SamplingMode::linear;
    return command;
}

[[nodiscard]] bool addStaticText(
    FramePacketBuilder& builder,
    const CommandHeader header,
    const PreShapedTextRunView& run,
    const float fontSize,
    const float x,
    const float top
) {
    return builder.addGlyphRun(
        makeGlyphCommand(header, run, fontSize, x, top),
        run.glyphs
    );
}

[[nodiscard]] bool addNumericText(
    FramePacketBuilder& builder,
    const CommandHeader header,
    const HudTextResources& resources,
    const NumericToken& token,
    const float fontSize,
    const float x,
    const float top
) {
    NumericGlyphAssembly assembly{};
    if (!assembleNumericGlyphs(resources, token, assembly)) {
        return false;
    }
    return builder.addGlyphRun(
        makeGlyphCommand(header, *assembly.style, fontSize, x, top),
        std::span<const GlyphInstance>(assembly.glyphs.data(), assembly.count)
    );
}

[[nodiscard]] UiCommand makePanel(
    const CommandHeader header,
    const StableElementId elementId,
    const RectF bounds,
    const float radius,
    const float alpha
) noexcept {
    UiCommand panel{};
    panel.header = header;
    panel.primitive = UiPrimitive::panel;
    panel.elementId = elementId;
    panel.bounds = bounds;
    panel.cornerRadius = radius;
    panel.backgroundColor = PremultipliedRgba::fromStraight(
        0.0F,
        0.0F,
        0.0F,
        alpha
    );
    return panel;
}

[[nodiscard]] FramePacketCapacity poolCapacityAssumingValid(
    const DebugTelemetryHudInput& input,
    const HudTextResources& resources
) noexcept {
    if (!input.showPoolInfo || input.poolCount == 0U) {
        return {};
    }
    FramePacketCapacity capacity{};
    capacity.uiCount = 1U;
    for (std::size_t index = 0U; index < input.poolCount; ++index) {
        NumericToken token{};
        if (!buildPoolToken(input.pools[index], token)) {
            return {};
        }
        capacity.glyphRunCount += 2U;
        capacity.glyphInstanceCount += resources.poolLabels[
            poolIndex(input.pools[index].kind)
        ]->glyphs.size() + token.count;
    }
    capacity.commandCount = capacity.uiCount + capacity.glyphRunCount;
    return capacity;
}

[[nodiscard]] FramePacketCapacity topCapacityAssumingValid(
    const DebugTelemetryHudInput& input,
    const HudTextResources& resources
) noexcept {
    FramePacketCapacity capacity{};
    if (input.showHitboxes) {
        capacity.shapeCount = input.hitboxCount;
    }
    if (input.showFrameTime) {
        std::array<PerformanceRow, performance_section_count> rows{};
        const std::size_t rowCount = buildPerformanceRows(
            input,
            resources,
            rows
        );
        capacity.uiCount = 1U;
        capacity.glyphRunCount = 1U + rowCount * 2U;
        capacity.glyphInstanceCount = resources.profilerHeader->glyphs.size();
        for (std::size_t index = 0U; index < rowCount; ++index) {
            NumericToken token{};
            if (!buildPerformanceToken(*rows[index].snapshot, token)) {
                return {};
            }
            capacity.glyphInstanceCount += rows[index].label->glyphs.size()
                + token.count;
        }
    }
    capacity.commandCount = capacity.shapeCount
        + capacity.uiCount
        + capacity.glyphRunCount;
    return capacity;
}

[[nodiscard]] bool capacityContains(
    const FramePacketCapacity& outer,
    const FramePacketCapacity& inner
) noexcept {
    return inner.commandCount <= outer.commandCount
        && inner.spriteCount <= outer.spriteCount
        && inner.shapeCount <= outer.shapeCount
        && inner.lineCount <= outer.lineCount
        && inner.textCount <= outer.textCount
        && inner.effectCount <= outer.effectCount
        && inner.uiCount <= outer.uiCount
        && inner.overlayCount <= outer.overlayCount
        && inner.utf8ByteCount <= outer.utf8ByteCount
        && inner.glyphRunCount <= outer.glyphRunCount
        && inner.glyphInstanceCount <= outer.glyphInstanceCount
        && inner.texturedMeshCount <= outer.texturedMeshCount
        && inner.meshVertexCount <= outer.meshVertexCount
        && inner.meshIndexCount <= outer.meshIndexCount
        && inner.gradientCount <= outer.gradientCount
        && inner.gradientStopCount <= outer.gradientStopCount
        && inner.clipCount <= outer.clipCount
        && inner.passCount <= outer.passCount;
}

[[nodiscard]] bool addHitboxes(
    FramePacketBuilder& builder,
    const DebugTelemetryHudInput& input
) {
    const CommandHeader header = makeHeader(
        RenderLayer::top,
        CoordinateSpace::world,
        debug_hitbox_layer_order
    );
    for (std::size_t index = 0U; index < input.hitboxCount; ++index) {
        const DebugHitboxCircle& source = input.hitboxes[index];
        ShapeCommand circle{};
        circle.header = header;
        circle.shape = ShapeType::circle;
        circle.fillEnabled = 0U;
        circle.strokeEnabled = 1U;
        circle.bounds = {
            source.center.x - source.radius,
            source.center.y - source.radius,
            source.radius * 2.0F,
            source.radius * 2.0F
        };
        circle.strokeWidth = source.strokeWidth;
        circle.fill = PremultipliedRgba::transparent();
        circle.stroke = source.color;
        if (!builder.addShape(circle)) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool addFrameHud(
    FramePacketBuilder& builder,
    const DebugTelemetryHudInput& input,
    const HudTextResources& resources,
    const HudArea& area
) {
    std::array<PerformanceRow, performance_section_count> rows{};
    const std::size_t rowCount = buildPerformanceRows(input, resources, rows);
    std::array<NumericToken, performance_section_count> tokens{};
    for (std::size_t index = 0U; index < rowCount; ++index) {
        if (!buildPerformanceToken(*rows[index].snapshot, tokens[index])) {
            return false;
        }
    }

    const float fontSize = std::max(12.0F, std::floor(area.height * 0.014F));
    const float lineGap = std::max(4.0F, std::floor(area.height * 0.004F));
    const float lineHeight = fontSize + lineGap;
    const float padding = std::max(6.0F, std::floor(area.height * 0.005F));
    const float offset = std::max(10.0F, std::floor(area.height * 0.01F));
    const float columnGap = std::max(8.0F, fontSize * 0.75F);
    const float startX = area.x + offset;
    const float startY = area.y + offset;

    float maximumLabelWidth = 0.0F;
    float maximumNumericWidth = 0.0F;
    for (std::size_t index = 0U; index < rowCount; ++index) {
        maximumLabelWidth = std::max(
            maximumLabelWidth,
            logicalAdvance(*rows[index].label, fontSize)
        );
        maximumNumericWidth = std::max(
            maximumNumericWidth,
            numericLogicalAdvance(resources, tokens[index], fontSize)
        );
    }
    const float headerWidth = logicalAdvance(*resources.profilerHeader, fontSize);
    const float contentWidth = std::max(
        headerWidth,
        maximumLabelWidth + columnGap + maximumNumericWidth
    );
    const float availableWidth = std::max(1.0F, area.width - offset * 2.0F);
    const float panelWidth = std::min(
        availableWidth,
        contentWidth + padding * 2.0F
    );
    const float panelHeight = (1.0F + static_cast<float>(rowCount))
        * lineHeight + padding * 2.0F;
    const CommandHeader header = makeHeader(
        RenderLayer::top,
        CoordinateSpace::logicalUi,
        debug_frame_hud_layer_order
    );
    if (!builder.addUi(makePanel(
            header,
            frame_panel_id,
            {startX - padding, startY - padding, panelWidth, panelHeight},
            padding,
            0.78F
        ))
        || !addStaticText(
            builder,
            header,
            *resources.profilerHeader,
            fontSize,
            startX,
            startY
        )) {
        return false;
    }

    const float numericX = startX + maximumLabelWidth + columnGap;
    for (std::size_t index = 0U; index < rowCount; ++index) {
        const float top = startY
            + static_cast<float>(index + 1U) * lineHeight;
        if (!addStaticText(
                builder,
                header,
                *rows[index].label,
                fontSize,
                startX,
                top
            )
            || !addNumericText(
                builder,
                header,
                resources,
                tokens[index],
                fontSize,
                numericX,
                top
            )) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool addPoolPanel(
    FramePacketBuilder& builder,
    const DebugTelemetryHudInput& input,
    const HudTextResources& resources,
    const HudArea& area
) {
    std::array<NumericToken, maximum_debug_pool_usage_count> tokens{};
    for (std::size_t index = 0U; index < input.poolCount; ++index) {
        if (!buildPoolToken(input.pools[index], tokens[index])) {
            return false;
        }
    }

    const float fontSize = std::max(12.0F, std::floor(area.height * 0.015F));
    const float lineGap = std::max(4.0F, std::floor(area.height * 0.005F));
    const float lineHeight = fontSize + lineGap;
    const float padding = std::max(5.0F, std::floor(area.height * 0.005F));
    const float offset = std::max(10.0F, std::floor(area.height * 0.01F));
    const float columnGap = std::max(8.0F, fontSize * 0.75F);
    const float startX = area.x + offset;
    const float startY = area.y + area.height - offset
        - static_cast<float>(input.poolCount) * lineHeight;

    float maximumLabelWidth = 0.0F;
    float maximumNumericWidth = 0.0F;
    for (std::size_t index = 0U; index < input.poolCount; ++index) {
        const PreShapedTextRunView& label = *resources.poolLabels[
            poolIndex(input.pools[index].kind)
        ];
        maximumLabelWidth = std::max(
            maximumLabelWidth,
            logicalAdvance(label, fontSize)
        );
        maximumNumericWidth = std::max(
            maximumNumericWidth,
            numericLogicalAdvance(resources, tokens[index], fontSize)
        );
    }
    const float availableWidth = std::max(1.0F, area.width - offset * 2.0F);
    const float panelWidth = std::min(
        availableWidth,
        maximumLabelWidth + columnGap + maximumNumericWidth + padding * 2.0F
    );
    const float panelHeight = static_cast<float>(input.poolCount) * lineHeight
        + padding * 2.0F;
    const CommandHeader header = makeHeader(
        RenderLayer::ui,
        CoordinateSpace::logicalUi,
        debug_pool_hud_layer_order
    );
    if (!builder.addUi(makePanel(
            header,
            pool_panel_id,
            {startX - padding, startY - padding, panelWidth, panelHeight},
            padding,
            0.70F
        ))) {
        return false;
    }

    const float numericX = startX + maximumLabelWidth + columnGap;
    for (std::size_t index = 0U; index < input.poolCount; ++index) {
        const float top = startY + static_cast<float>(index) * lineHeight;
        const PreShapedTextRunView& label = *resources.poolLabels[
            poolIndex(input.pools[index].kind)
        ];
        if (!addStaticText(
                builder,
                header,
                label,
                fontSize,
                startX,
                top
            )
            || !addNumericText(
                builder,
                header,
                resources,
                tokens[index],
                fontSize,
                numericX,
                top
            )) {
            return false;
        }
    }
    return true;
}

} // namespace

bool debugTelemetryHudInputIsValid(
    const DebugTelemetryHudInput& input
) noexcept {
    if (!anyHudEnabled(input)) {
        return true;
    }
    if (!validPerformanceSnapshot(input.performance)
        || !validPools(input)
        || !validHitboxes(input)) {
        return false;
    }
    HudTextResources resources{};
    if (!resolveTextResources(input, resources)) {
        return false;
    }
    return capacityContains(
            maximumDebugPoolHudCapacity(),
            poolCapacityAssumingValid(input, resources)
        )
        && capacityContains(
            maximumDebugTopHudCapacity(),
            topCapacityAssumingValid(input, resources)
        );
}

FramePacketCapacity debugPoolHudCapacity(
    const DebugTelemetryHudInput& input
) noexcept {
    if (!debugTelemetryHudInputIsValid(input)) {
        return {};
    }
    if (!input.showPoolInfo || input.poolCount == 0U) {
        return {};
    }
    HudTextResources resources{};
    return resolveTextResources(input, resources)
        ? poolCapacityAssumingValid(input, resources)
        : FramePacketCapacity{};
}

FramePacketCapacity debugTopHudCapacity(
    const DebugTelemetryHudInput& input
) noexcept {
    if (!debugTelemetryHudInputIsValid(input)) {
        return {};
    }
    if (!input.showFrameTime && !input.showHitboxes) {
        return {};
    }
    HudTextResources resources{};
    return resolveTextResources(input, resources)
        ? topCapacityAssumingValid(input, resources)
        : FramePacketCapacity{};
}

bool addDebugPoolHud(
    FramePacketBuilder& builder,
    const DebugTelemetryHudInput& input
) {
    if (!debugTelemetryHudInputIsValid(input)) {
        return false;
    }
    if (!input.showPoolInfo || input.poolCount == 0U) {
        return true;
    }
    if (!builder.isBuilding()) {
        return false;
    }
    const ViewportState* const viewport = builder.activeViewport();
    HudArea area{};
    HudTextResources resources{};
    if (viewport == nullptr
        || !resolveHudArea(*viewport, area)
        || !resolveTextResources(input, resources)) {
        return false;
    }
    return addPoolPanel(builder, input, resources, area);
}

bool addDebugTopHud(
    FramePacketBuilder& builder,
    const DebugTelemetryHudInput& input
) {
    if (!debugTelemetryHudInputIsValid(input)) {
        return false;
    }
    if (!input.showFrameTime && !input.showHitboxes) {
        return true;
    }
    if (!builder.isBuilding()) {
        return false;
    }
    const ViewportState* const viewport = builder.activeViewport();
    HudArea area{};
    HudTextResources resources{};
    if (viewport == nullptr
        || (input.showFrameTime && !resolveHudArea(*viewport, area))
        || !resolveTextResources(input, resources)) {
        return false;
    }

    if (input.showHitboxes && !addHitboxes(builder, input)) {
        return false;
    }
    return !input.showFrameTime
        || addFrameHud(builder, input, resources, area);
}

} // namespace cirvivor::render::frontend
