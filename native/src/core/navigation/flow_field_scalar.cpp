#include "core/navigation/flow_field_scalar.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace cirvivor::core {
namespace {

constexpr double epsilon = 1.0e-6;
constexpr float infinityCost = 1.0e20F;
constexpr double unreachableCost = 5.0e19;
constexpr double diagonalCost = 1.41421356237;

constexpr std::array<std::int32_t, 8> directionX{
    1, -1, 0, 0, 1, 1, -1, -1
};
constexpr std::array<std::int32_t, 8> directionY{
    0, 0, 1, -1, 1, -1, 1, -1
};
constexpr std::array<double, 8> directionCost{
    1.0, 1.0, 1.0, 1.0,
    diagonalCost, diagonalCost, diagonalCost, diagonalCost
};

[[nodiscard]] std::size_t validateMaximumCellCount(const std::size_t count) {
    constexpr std::size_t maximumIndex = static_cast<std::size_t>(
        std::numeric_limits<std::int32_t>::max()
    );
    if (count > maximumIndex) {
        throw std::length_error("FlowFieldScalar capacity exceeds the WAT i32 index range.");
    }
    return count;
}

[[nodiscard]] bool isBlocked(
    const std::span<const std::uint8_t> blocked,
    const std::int32_t columns,
    const std::int32_t rows,
    const std::int32_t column,
    const std::int32_t row
) noexcept {
    if (column < 0 || row < 0 || column >= columns || row >= rows) {
        return true;
    }
    const auto index = static_cast<std::size_t>(row)
        * static_cast<std::size_t>(columns)
        + static_cast<std::size_t>(column);
    return blocked[index] != 0U;
}

} // namespace

FlowFieldScalar::FlowFieldScalar(const std::size_t maximumCellCount)
    : maximumCellCount_(validateMaximumCellCount(maximumCellCount)),
      heap_(maximumCellCount_),
      heapPositions_(maximumCellCount_) {}

std::size_t FlowFieldScalar::maximumCellCount() const noexcept {
    return maximumCellCount_;
}

FlowFieldBuildResult FlowFieldScalar::build(
    const std::span<const std::uint8_t> blocked,
    const std::int32_t columns,
    const std::int32_t rows,
    const std::int32_t goalColumn,
    const std::int32_t goalRow,
    const FlowFieldPlanes& output
) noexcept {
    if (columns <= 0 || rows <= 0) {
        return {.status = FlowFieldStatus::invalidDimensions};
    }
    if (goalColumn < 0 || goalRow < 0 || goalColumn >= columns || goalRow >= rows) {
        return {.status = FlowFieldStatus::invalidGoal};
    }

    constexpr std::size_t maximumIndex = static_cast<std::size_t>(
        std::numeric_limits<std::int32_t>::max()
    );
    const auto columnCount = static_cast<std::size_t>(columns);
    const auto rowCount = static_cast<std::size_t>(rows);
    if (columnCount > maximumIndex / rowCount) {
        return {.status = FlowFieldStatus::dimensionOverflow};
    }
    const std::size_t cellCount = columnCount * rowCount;
    if (cellCount > maximumCellCount_) {
        return {
            .status = FlowFieldStatus::capacityExceeded,
            .cellCount = cellCount
        };
    }
    if (blocked.size() < cellCount) {
        return {
            .status = FlowFieldStatus::inputTooSmall,
            .cellCount = cellCount
        };
    }
    if (output.integration.size() < cellCount
        || output.directionX.size() < cellCount
        || output.directionY.size() < cellCount) {
        return {
            .status = FlowFieldStatus::outputTooSmall,
            .cellCount = cellCount
        };
    }

    const auto integration = output.integration.first(cellCount);
    const auto resultDirectionX = output.directionX.first(cellCount);
    const auto resultDirectionY = output.directionY.first(cellCount);
    std::fill(integration.begin(), integration.end(), infinityCost);
    std::fill(resultDirectionX.begin(), resultDirectionX.end(), 0.0F);
    std::fill(resultDirectionY.begin(), resultDirectionY.end(), 0.0F);
    std::fill_n(heapPositions_.begin(), cellCount, -1);

    const std::size_t goalIndex = static_cast<std::size_t>(goalRow) * columnCount
        + static_cast<std::size_t>(goalColumn);
    integration[goalIndex] = 0.0F;
    std::size_t heapCount = 0;
    pushHeapNode(goalIndex, heapCount, integration);

    while (heapCount > 0U) {
        const std::size_t bestIndex = popHeapNode(heapCount, integration);
        const auto cellColumn = static_cast<std::int32_t>(bestIndex % columnCount);
        const auto cellRow = static_cast<std::int32_t>(bestIndex / columnCount);

        for (std::size_t direction = 0; direction < directionX.size(); ++direction) {
            const std::int32_t deltaX = directionX[direction];
            const std::int32_t deltaY = directionY[direction];
            const std::int32_t nextColumn = cellColumn + deltaX;
            const std::int32_t nextRow = cellRow + deltaY;
            if (isBlocked(blocked, columns, rows, nextColumn, nextRow)) {
                continue;
            }
            if (deltaX != 0 && deltaY != 0
                && (isBlocked(blocked, columns, rows, cellColumn + deltaX, cellRow)
                    || isBlocked(blocked, columns, rows, cellColumn, cellRow + deltaY))) {
                continue;
            }

            const std::size_t neighborIndex = static_cast<std::size_t>(nextRow)
                * columnCount + static_cast<std::size_t>(nextColumn);
            const double candidate = static_cast<double>(integration[bestIndex])
                + directionCost[direction];
            if (candidate + epsilon >= static_cast<double>(integration[neighborIndex])) {
                continue;
            }
            integration[neighborIndex] = static_cast<float>(candidate);
            if (heapPositions_[neighborIndex] < 0) {
                pushHeapNode(neighborIndex, heapCount, integration);
            } else {
                decreaseHeapNode(neighborIndex, integration);
            }
        }
    }

    for (std::int32_t row = 0; row < rows; ++row) {
        for (std::int32_t column = 0; column < columns; ++column) {
            const std::size_t index = static_cast<std::size_t>(row) * columnCount
                + static_cast<std::size_t>(column);
            if (blocked[index] != 0U
                || static_cast<double>(integration[index]) >= unreachableCost) {
                continue;
            }

            std::size_t bestNeighborIndex = index;
            double bestCost = static_cast<double>(integration[index]);
            for (std::size_t direction = 0; direction < directionX.size(); ++direction) {
                const std::int32_t deltaX = directionX[direction];
                const std::int32_t deltaY = directionY[direction];
                const std::int32_t nextColumn = column + deltaX;
                const std::int32_t nextRow = row + deltaY;
                if (isBlocked(blocked, columns, rows, nextColumn, nextRow)) {
                    continue;
                }
                if (deltaX != 0 && deltaY != 0
                    && (isBlocked(blocked, columns, rows, column + deltaX, row)
                        || isBlocked(blocked, columns, rows, column, row + deltaY))) {
                    continue;
                }

                const std::size_t neighborIndex = static_cast<std::size_t>(nextRow)
                    * columnCount + static_cast<std::size_t>(nextColumn);
                const double neighborCost = static_cast<double>(integration[neighborIndex]);
                if (neighborCost + epsilon < bestCost) {
                    bestCost = neighborCost;
                    bestNeighborIndex = neighborIndex;
                }
            }

            if (bestNeighborIndex == index) {
                continue;
            }
            const auto bestColumn = static_cast<std::int32_t>(
                bestNeighborIndex % columnCount
            );
            const auto bestRow = static_cast<std::int32_t>(
                bestNeighborIndex / columnCount
            );
            const std::int32_t deltaX = bestColumn - column;
            const std::int32_t deltaY = bestRow - row;
            const double doubleDeltaX = static_cast<double>(deltaX);
            const double doubleDeltaY = static_cast<double>(deltaY);
            const double length = std::sqrt(
                (doubleDeltaX * doubleDeltaX) + (doubleDeltaY * doubleDeltaY)
            );
            if (length <= epsilon) {
                continue;
            }
            resultDirectionX[index] = static_cast<float>(doubleDeltaX / length);
            resultDirectionY[index] = static_cast<float>(doubleDeltaY / length);
        }
    }

    return {
        .status = FlowFieldStatus::ok,
        .cellCount = cellCount,
        .goalIndex = static_cast<std::uint32_t>(goalIndex)
    };
}

bool FlowFieldScalar::isHeapNodeBefore(
    const std::size_t leftIndex,
    const std::size_t rightIndex,
    const std::span<const float> integration
) const noexcept {
    const float leftCost = integration[leftIndex];
    const float rightCost = integration[rightIndex];
    return leftCost < rightCost || (leftCost == rightCost && leftIndex < rightIndex);
}

void FlowFieldScalar::pushHeapNode(
    const std::size_t cellIndex,
    std::size_t& heapCount,
    const std::span<const float> integration
) noexcept {
    std::size_t position = heapCount;
    heap_[position] = static_cast<std::int32_t>(cellIndex);
    heapPositions_[cellIndex] = static_cast<std::int32_t>(position);

    while (position > 0U) {
        const std::size_t parentPosition = (position - 1U) >> 1U;
        const std::size_t parentIndex = static_cast<std::size_t>(heap_[parentPosition]);
        if (!isHeapNodeBefore(cellIndex, parentIndex, integration)) {
            break;
        }
        heap_[position] = static_cast<std::int32_t>(parentIndex);
        heapPositions_[parentIndex] = static_cast<std::int32_t>(position);
        position = parentPosition;
    }
    heap_[position] = static_cast<std::int32_t>(cellIndex);
    heapPositions_[cellIndex] = static_cast<std::int32_t>(position);
    ++heapCount;
}

void FlowFieldScalar::decreaseHeapNode(
    const std::size_t cellIndex,
    const std::span<const float> integration
) noexcept {
    auto positionValue = heapPositions_[cellIndex];
    if (positionValue < 0) {
        return;
    }
    std::size_t position = static_cast<std::size_t>(positionValue);
    while (position > 0U) {
        const std::size_t parentPosition = (position - 1U) >> 1U;
        const std::size_t parentIndex = static_cast<std::size_t>(heap_[parentPosition]);
        if (!isHeapNodeBefore(cellIndex, parentIndex, integration)) {
            break;
        }
        heap_[position] = static_cast<std::int32_t>(parentIndex);
        heapPositions_[parentIndex] = static_cast<std::int32_t>(position);
        position = parentPosition;
    }
    heap_[position] = static_cast<std::int32_t>(cellIndex);
    heapPositions_[cellIndex] = static_cast<std::int32_t>(position);
}

std::size_t FlowFieldScalar::popHeapNode(
    std::size_t& heapCount,
    const std::span<const float> integration
) noexcept {
    const std::size_t rootIndex = static_cast<std::size_t>(heap_[0]);
    --heapCount;
    const std::size_t lastIndex = static_cast<std::size_t>(heap_[heapCount]);
    heapPositions_[rootIndex] = -1;
    if (heapCount == 0U) {
        return rootIndex;
    }

    std::size_t position = 0;
    heap_[0] = static_cast<std::int32_t>(lastIndex);
    heapPositions_[lastIndex] = 0;
    while (true) {
        const std::size_t leftPosition = (position * 2U) + 1U;
        if (leftPosition >= heapCount) {
            break;
        }
        const std::size_t rightPosition = leftPosition + 1U;
        std::size_t nextPosition = leftPosition;
        if (rightPosition < heapCount
            && isHeapNodeBefore(
                static_cast<std::size_t>(heap_[rightPosition]),
                static_cast<std::size_t>(heap_[leftPosition]),
                integration
            )) {
            nextPosition = rightPosition;
        }
        const std::size_t nextIndex = static_cast<std::size_t>(heap_[nextPosition]);
        if (!isHeapNodeBefore(nextIndex, lastIndex, integration)) {
            break;
        }
        heap_[position] = static_cast<std::int32_t>(nextIndex);
        heapPositions_[nextIndex] = static_cast<std::int32_t>(position);
        position = nextPosition;
    }
    heap_[position] = static_cast<std::int32_t>(lastIndex);
    heapPositions_[lastIndex] = static_cast<std::int32_t>(position);
    return rootIndex;
}

} // namespace cirvivor::core
