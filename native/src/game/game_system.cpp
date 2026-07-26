#include "game/game_system.h"

#include "core/state_hash/canonical_state_hasher.h"

#include <bit>
#include <cstdint>

namespace cirvivor::game {
namespace {

constexpr double towerControlAcceleration = 78.0;
constexpr double towerLinearFriction = 10.0;
constexpr double towerSleepSpeed = 1.0 / 96.0;
constexpr double towerMaximumLinearSpeed = 25.0;

// InputActionMapper first multiplies both diagonal axes by Math.SQRT1_2.
// TheTower then observes Math.hypot(x, y) > 1 and normalizes once more. V8's
// authoritative result is one ULP below Math.SQRT1_2.
constexpr double normalizedDiagonal = std::bit_cast<double>(
    std::uint64_t{0x3fe6'a09e'667f'3bccULL}
);

void appendVector(
    core::CanonicalStateHasher64& hasher,
    const core::Vector2 vector
) {
    hasher.beginObject(2);
    hasher.appendObjectKey("x");
    hasher.appendNumber(vector.x);
    hasher.appendObjectKey("y");
    hasher.appendNumber(vector.y);
    hasher.endObject();
}

void appendCollider(
    core::CanonicalStateHasher64& hasher,
    const std::string_view colliderId,
    const std::uint32_t collisionLayer,
    const std::uint32_t collisionMask,
    const bool enabled,
    const double radius
) {
    hasher.beginObject(6);
    hasher.appendObjectKey("colliderId");
    hasher.appendString(colliderId);
    hasher.appendObjectKey("collisionLayer");
    hasher.appendNumber(static_cast<double>(collisionLayer));
    hasher.appendObjectKey("collisionMask");
    hasher.appendNumber(static_cast<double>(collisionMask));
    hasher.appendObjectKey("enabled");
    hasher.appendBoolean(enabled);
    hasher.appendObjectKey("radius");
    hasher.appendNumber(radius);
    hasher.appendObjectKey("shape");
    hasher.appendString("circle");
    hasher.endObject();
}

void appendPhysicsBody(
    core::CanonicalStateHasher64& hasher,
    const core::BodySoA& bodies,
    const core::BodySoA::Index index,
    const std::string_view physicsBodyId
) {
    const bool isStatic = bodies.type(index) == core::PhysicsBodyType::staticBody;
    hasher.beginObject(8);
    hasher.appendObjectKey("bodyType");
    hasher.appendString(isStatic ? "static" : "dynamic");
    hasher.appendObjectKey("enabled");
    hasher.appendBoolean(bodies.isEnabled(index));
    hasher.appendObjectKey("inverseMass");
    hasher.appendNumber(bodies.inverseMass(index));
    hasher.appendObjectKey("mass");
    if (isStatic) {
        hasher.appendNull();
    } else {
        hasher.appendNumber(bodies.mass(index));
    }
    hasher.appendObjectKey("physicsBodyId");
    hasher.appendString(physicsBodyId);
    hasher.appendObjectKey("position");
    appendVector(hasher, bodies.position(index));
    hasher.appendObjectKey("previousPosition");
    appendVector(hasher, bodies.previousPosition(index));
    hasher.appendObjectKey("velocity");
    appendVector(hasher, bodies.velocity(index));
    hasher.endObject();
}

void appendCoreEntity(
    core::CanonicalStateHasher64& hasher,
    const GameSystem& gameSystem
) {
    const core::BodySoA& bodies = gameSystem.bodies();
    const core::BodySoA::Index bodyIndex = gameSystem.coreBodyIndex();
    const bool enabled = bodies.isEnabled(bodyIndex);

    hasher.beginObject(7);
    hasher.appendObjectKey("active");
    hasher.appendBoolean(enabled);
    hasher.appendObjectKey("collider");
    appendCollider(
        hasher,
        "the-core:collider",
        4U,
        10U,
        enabled,
        GameSystem::core_radius
    );
    hasher.appendObjectKey("id");
    hasher.appendString("the-core");
    hasher.appendObjectKey("integrity");
    hasher.beginObject(3);
    hasher.appendObjectKey("current");
    hasher.appendNumber(GameSystem::core_integrity);
    hasher.appendObjectKey("depleted");
    hasher.appendBoolean(false);
    hasher.appendObjectKey("maximum");
    hasher.appendNumber(GameSystem::core_integrity);
    hasher.endObject();
    hasher.appendObjectKey("kind");
    hasher.appendString("core");
    hasher.appendObjectKey("physics");
    appendPhysicsBody(hasher, bodies, bodyIndex, "the-core:physics");
    hasher.appendObjectKey("radius");
    hasher.appendNumber(GameSystem::core_radius);
    hasher.endObject();
}

void appendTowerEntity(
    core::CanonicalStateHasher64& hasher,
    const GameSystem& gameSystem
) {
    const core::BodySoA& bodies = gameSystem.bodies();
    const core::BodySoA::Index bodyIndex = gameSystem.towerBodyIndex();
    const bool enabled = bodies.isEnabled(bodyIndex);

    hasher.beginObject(7);
    hasher.appendObjectKey("active");
    hasher.appendBoolean(enabled);
    hasher.appendObjectKey("collider");
    appendCollider(
        hasher,
        "the-tower:collider",
        2U,
        13U,
        enabled,
        GameSystem::tower_radius
    );
    hasher.appendObjectKey("id");
    hasher.appendString("the-tower");
    hasher.appendObjectKey("kind");
    hasher.appendString("tower");
    hasher.appendObjectKey("moveIntent");
    appendVector(hasher, gameSystem.towerMoveIntent());
    hasher.appendObjectKey("physics");
    appendPhysicsBody(hasher, bodies, bodyIndex, "the-tower:physics");
    hasher.appendObjectKey("radius");
    hasher.appendNumber(GameSystem::tower_radius);
    hasher.endObject();
}

} // namespace

GameSystem::GameSystem()
    : tileMap_(core::TileMap::createCorridorEight()),
      bodies_(2) {
    towerBodyIndex_ = bodies_.addBody({
        .type = core::PhysicsBodyType::dynamic,
        .x = 45.0,
        .y = 15.0,
        .mass = 1.0,
        .linearFriction = towerLinearFriction,
        .sleepSpeed = towerSleepSpeed,
        .maxLinearSpeed = towerMaximumLinearSpeed
    });
    coreBodyIndex_ = bodies_.addBody({
        .type = core::PhysicsBodyType::staticBody,
        .x = 51.0,
        .y = 27.0
    });
    bodies_.seal();
}

FixedUpdateResult GameSystem::fixedUpdate(const MovementActionState& actions) {
    towerMoveIntent_ = mapMovementIntent(actions);
    static_cast<void>(bodies_.beginStep(towerBodyIndex_));
    static_cast<void>(bodies_.addAcceleration(
        towerBodyIndex_,
        towerMoveIntent_.x * towerControlAcceleration,
        towerMoveIntent_.y * towerControlAcceleration
    ));
    static_cast<void>(bodies_.integrate(towerBodyIndex_, fixed_delta_seconds));
    const core::TileCollisionResolveStats collision = collisionSolver_.resolve(
        bodies_,
        towerBodyIndex_,
        tower_radius,
        tileMap_
    );
    return {
        collision.tileProbeCount,
        collision.positionCorrectionCount
    };
}

const core::TileMap& GameSystem::tileMap() const noexcept {
    return tileMap_;
}

const core::BodySoA& GameSystem::bodies() const noexcept {
    return bodies_;
}

core::BodySoA::Index GameSystem::towerBodyIndex() const noexcept {
    return towerBodyIndex_;
}

core::BodySoA::Index GameSystem::coreBodyIndex() const noexcept {
    return coreBodyIndex_;
}

core::Vector2 GameSystem::towerMoveIntent() const noexcept {
    return towerMoveIntent_;
}

core::Vector2 GameSystem::mapMovementIntent(
    const MovementActionState& actions
) noexcept {
    const int horizontal = static_cast<int>(actions.moveRight)
        - static_cast<int>(actions.moveLeft);
    const int vertical = static_cast<int>(actions.moveDown)
        - static_cast<int>(actions.moveUp);
    if (horizontal != 0 && vertical != 0) {
        return {
            static_cast<double>(horizontal) * normalizedDiagonal,
            static_cast<double>(vertical) * normalizedDiagonal
        };
    }
    return {
        static_cast<double>(horizontal),
        static_cast<double>(vertical)
    };
}

std::uint64_t hashFixedState(
    const GameSystem& gameSystem,
    const int tick,
    const std::size_t tileCorrectionCount
) {
    core::CanonicalStateHasher64 hasher;
    hasher.beginObject(4);
    hasher.appendObjectKey("counts");
    hasher.beginObject(7);
    hasher.appendObjectKey("colliderCount");
    hasher.appendNumber(2.0);
    hasher.appendObjectKey("committedEventCount");
    hasher.appendNumber(0.0);
    hasher.appendObjectKey("contactCount");
    hasher.appendNumber(0.0);
    hasher.appendObjectKey("entityCount");
    hasher.appendNumber(2.0);
    hasher.appendObjectKey("physicsBodyCount");
    hasher.appendNumber(2.0);
    hasher.appendObjectKey("projectileCount");
    hasher.appendNumber(0.0);
    hasher.appendObjectKey("tileCorrectionCount");
    hasher.appendNumber(static_cast<double>(tileCorrectionCount));
    hasher.endObject();
    hasher.appendObjectKey("entities");
    hasher.beginArray(2);
    appendCoreEntity(hasher, gameSystem);
    appendTowerEntity(hasher, gameSystem);
    hasher.endArray();
    hasher.appendObjectKey("staticWorldHash");
    hasher.appendString(GameSystem::static_world_hash);
    hasher.appendObjectKey("tick");
    hasher.appendNumber(static_cast<double>(tick));
    hasher.endObject();
    return hasher.value();
}

} // namespace cirvivor::game
