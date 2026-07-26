#include "core/world/tile_map.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace cirvivor::core {
namespace {

struct MacroCell final {
    int row = 0;
    int column = 0;
};

constexpr std::array<MacroCell, 25> corridorEightRoute{{
    {0, 0}, {1, 0}, {2, 0}, {2, 1}, {2, 2},
    {2, 3}, {2, 4}, {1, 4}, {0, 4}, {0, 3},
    {0, 2}, {1, 2}, {2, 2}, {3, 2}, {4, 2},
    {4, 3}, {4, 4}, {3, 4}, {2, 4}, {2, 5},
    {2, 6}, {2, 7}, {2, 8}, {3, 8}, {4, 8}
}};

} // namespace

TileMap TileMap::createCorridorEight() {
    constexpr int macroRows = 5;
    constexpr int macroColumns = 9;
    constexpr int pathWidthTiles = 6;
    TileMap map(
        macroRows * pathWidthTiles,
        macroColumns * pathWidthTiles,
        1.0
    );
    map.spawnRouteWaypoints_.reserve(corridorEightRoute.size());
    for (const MacroCell cell : corridorEightRoute) {
        map.markWalkableMacroCell(cell.row, cell.column, pathWidthTiles);
        const double centerOffset = static_cast<double>(pathWidthTiles) * 0.5;
        map.spawnRouteWaypoints_.push_back({
            (static_cast<double>(cell.column * pathWidthTiles) + centerOffset)
                * map.tileSize_,
            (static_cast<double>(cell.row * pathWidthTiles) + centerOffset)
                * map.tileSize_
        });
    }
    return map;
}

TileMap::TileMap(const int rows, const int columns, const double tileSize)
    : rows_(rows),
      columns_(columns),
      tileSize_(tileSize) {
    if (rows <= 0 || columns <= 0 || tileSize <= 0.0) {
        throw std::invalid_argument("TileMap dimensions and tile size must be positive.");
    }
    const auto rowCount = static_cast<std::size_t>(rows);
    const auto columnCount = static_cast<std::size_t>(columns);
    blocked_.assign(rowCount * columnCount, 1U);
}

int TileMap::rows() const noexcept {
    return rows_;
}

int TileMap::columns() const noexcept {
    return columns_;
}

double TileMap::tileSize() const noexcept {
    return tileSize_;
}

bool TileMap::isWalkableTile(const int row, const int column) const noexcept {
    if (row < 0 || row >= rows_ || column < 0 || column >= columns_) {
        return false;
    }
    const std::size_t index = static_cast<std::size_t>(row)
        * static_cast<std::size_t>(columns_)
        + static_cast<std::size_t>(column);
    return blocked_[index] == 0U;
}

std::span<const Vector2> TileMap::spawnRouteWaypoints() const noexcept {
    return spawnRouteWaypoints_;
}

void TileMap::markWalkableMacroCell(
    const int macroRow,
    const int macroColumn,
    const int pathWidthTiles
) {
    const int startRow = macroRow * pathWidthTiles;
    const int startColumn = macroColumn * pathWidthTiles;
    for (int rowOffset = 0; rowOffset < pathWidthTiles; ++rowOffset) {
        const std::size_t rowIndex = static_cast<std::size_t>(startRow + rowOffset)
            * static_cast<std::size_t>(columns_);
        for (int columnOffset = 0; columnOffset < pathWidthTiles; ++columnOffset) {
            blocked_[rowIndex + static_cast<std::size_t>(startColumn + columnOffset)] = 0U;
        }
    }
}

} // namespace cirvivor::core
