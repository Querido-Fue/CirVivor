#include "core/physics/tile_collision_solver.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace cirvivor::core {
namespace {

constexpr int maximumResolveIterations = 8;
constexpr double penetrationEpsilon = 1.0e-8;

struct Contact final {
    double normalX = 0.0;
    double normalY = 0.0;
    double penetration = 0.0;
};

[[nodiscard]] Contact resolveInsideTile(
    const double x,
    const double y,
    const double radius,
    const double left,
    const double top,
    const double right,
    const double bottom
) noexcept {
    const std::array<double, 4> distances{
        x - left,
        right - x,
        y - top,
        bottom - y
    };
    std::size_t nearestIndex = 0;
    for (std::size_t index = 1; index < distances.size(); ++index) {
        if (distances[index] < distances[nearestIndex]) {
            nearestIndex = index;
        }
    }
    return {
        nearestIndex == 0U ? -1.0 : nearestIndex == 1U ? 1.0 : 0.0,
        nearestIndex == 2U ? -1.0 : nearestIndex == 3U ? 1.0 : 0.0,
        distances[nearestIndex] + radius
    };
}

} // namespace

TileCollisionResolveStats TileCollisionSolver::resolve(
    BodySoA& bodies,
    const BodySoA::Index bodyIndex,
    const double radius,
    const TileMap& tileMap
) const {
    TileCollisionResolveStats stats;
    if (!bodies.isEnabled(bodyIndex)
        || bodies.type(bodyIndex) == PhysicsBodyType::staticBody
        || !std::isfinite(radius)
        || radius <= 0.0) {
        return stats;
    }

    const double tileSize = tileMap.tileSize();
    for (int iteration = 0; iteration < maximumResolveIterations; ++iteration) {
        const Vector2 position = bodies.position(bodyIndex);
        const int minColumn = static_cast<int>(std::floor((position.x - radius) / tileSize));
        const int maxColumn = static_cast<int>(std::floor((position.x + radius) / tileSize));
        const int minRow = static_cast<int>(std::floor((position.y - radius) / tileSize));
        const int maxRow = static_cast<int>(std::floor((position.y + radius) / tileSize));
        Contact best;

        for (int row = minRow; row <= maxRow; ++row) {
            for (int column = minColumn; column <= maxColumn; ++column) {
                ++stats.tileProbeCount;
                if (tileMap.isWalkableTile(row, column)) {
                    continue;
                }

                const double left = static_cast<double>(column) * tileSize;
                const double top = static_cast<double>(row) * tileSize;
                const double right = left + tileSize;
                const double bottom = top + tileSize;
                const double closestX = std::min(right, std::max(left, position.x));
                const double closestY = std::min(bottom, std::max(top, position.y));
                const double deltaX = position.x - closestX;
                const double deltaY = position.y - closestY;
                const double distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
                Contact contact;

                if (distanceSquared <= penetrationEpsilon) {
                    contact = resolveInsideTile(
                        position.x,
                        position.y,
                        radius,
                        left,
                        top,
                        right,
                        bottom
                    );
                } else {
                    const double distance = std::sqrt(distanceSquared);
                    contact.penetration = radius - distance;
                    if (contact.penetration <= penetrationEpsilon) {
                        continue;
                    }
                    contact.normalX = deltaX / distance;
                    contact.normalY = deltaY / distance;
                }

                if (contact.penetration > best.penetration) {
                    best = contact;
                }
            }
        }

        if (best.penetration <= penetrationEpsilon) {
            break;
        }
        static_cast<void>(bodies.applyPositionCorrection(
            bodyIndex,
            best.normalX * best.penetration,
            best.normalY * best.penetration
        ));
        const Vector2 velocity = bodies.velocity(bodyIndex);
        const double inwardSpeed = (velocity.x * best.normalX)
            + (velocity.y * best.normalY);
        if (inwardSpeed < 0.0) {
            bodies.setVelocity(
                bodyIndex,
                velocity.x - (inwardSpeed * best.normalX),
                velocity.y - (inwardSpeed * best.normalY)
            );
        }
        ++stats.positionCorrectionCount;
    }
    return stats;
}

} // namespace cirvivor::core
