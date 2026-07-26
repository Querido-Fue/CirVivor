#pragma once

#include "core/physics/body_soa.h"
#include "core/world/tile_map.h"

#include <cstddef>

namespace cirvivor::core {

struct TileCollisionResolveStats final {
    std::size_t tileProbeCount = 0;
    std::size_t positionCorrectionCount = 0;
};

class TileCollisionSolver final {
public:
    [[nodiscard]] TileCollisionResolveStats resolve(
        BodySoA& bodies,
        BodySoA::Index bodyIndex,
        double radius,
        const TileMap& tileMap
    ) const;
};

} // namespace cirvivor::core
