#pragma once

#include "core/math/vector2.h"

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace cirvivor::core {

class TileMap final {
public:
    static TileMap createCorridorEight();

    [[nodiscard]] int rows() const noexcept;
    [[nodiscard]] int columns() const noexcept;
    [[nodiscard]] double tileSize() const noexcept;
    [[nodiscard]] bool isWalkableTile(int row, int column) const noexcept;
    [[nodiscard]] std::span<const Vector2> spawnRouteWaypoints() const noexcept;

private:
    TileMap(int rows, int columns, double tileSize);
    void markWalkableMacroCell(int macroRow, int macroColumn, int pathWidthTiles);

    int rows_ = 0;
    int columns_ = 0;
    double tileSize_ = 1.0;
    std::vector<std::uint8_t> blocked_;
    std::vector<Vector2> spawnRouteWaypoints_;
};

} // namespace cirvivor::core
