#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace cirvivor::core {

enum class FlowFieldStatus : std::uint8_t {
    ok,
    invalidDimensions,
    dimensionOverflow,
    invalidGoal,
    capacityExceeded,
    inputTooSmall,
    outputTooSmall
};

struct FlowFieldPlanes final {
    std::span<float> integration;
    std::span<float> directionX;
    std::span<float> directionY;
};

struct FlowFieldBuildResult final {
    FlowFieldStatus status = FlowFieldStatus::invalidDimensions;
    std::size_t cellCount = 0;
    std::uint32_t goalIndex = 0;

    [[nodiscard]] explicit operator bool() const noexcept {
        return status == FlowFieldStatus::ok;
    }
};

// Fixed-capacity scalar reference for the production enemy-AI flow-field WAT.
// Construction owns all scratch allocation; build() never grows storage.
class FlowFieldScalar final {
public:
    explicit FlowFieldScalar(std::size_t maximumCellCount);

    [[nodiscard]] std::size_t maximumCellCount() const noexcept;

    [[nodiscard]] FlowFieldBuildResult build(
        std::span<const std::uint8_t> blocked,
        std::int32_t columns,
        std::int32_t rows,
        std::int32_t goalColumn,
        std::int32_t goalRow,
        const FlowFieldPlanes& output
    ) noexcept;

private:
    [[nodiscard]] bool isHeapNodeBefore(
        std::size_t leftIndex,
        std::size_t rightIndex,
        std::span<const float> integration
    ) const noexcept;
    void pushHeapNode(
        std::size_t cellIndex,
        std::size_t& heapCount,
        std::span<const float> integration
    ) noexcept;
    void decreaseHeapNode(
        std::size_t cellIndex,
        std::span<const float> integration
    ) noexcept;
    [[nodiscard]] std::size_t popHeapNode(
        std::size_t& heapCount,
        std::span<const float> integration
    ) noexcept;

    std::size_t maximumCellCount_ = 0;
    std::vector<std::int32_t> heap_;
    std::vector<std::int32_t> heapPositions_;
};

} // namespace cirvivor::core
