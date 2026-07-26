#pragma once

#include "core/math/vector2.h"
#include "core/physics/body_soa.h"
#include "core/physics/tile_collision_solver.h"
#include "core/world/tile_map.h"

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace cirvivor::game {

// Platform input is converted to these semantic actions before it reaches the
// authoritative fixed-step session. Physical key and SDL event identities do
// not belong in this layer.
struct MovementActionState final {
    bool moveUp = false;
    bool moveDown = false;
    bool moveLeft = false;
    bool moveRight = false;
};

struct FixedUpdateResult final {
    std::size_t tileProbeCount = 0;
    std::size_t tileCorrectionCount = 0;
};

// First native playable-slice session: corridor-eight, The Tower, and The Core.
// Construction may allocate fixed-capacity storage; fixedUpdate() does not.
class GameSystem final {
public:
    static constexpr std::string_view map_id = "corridor_eight_01";
    static constexpr std::string_view static_world_hash = "fd31f3c2801962f7";
    static constexpr double fixed_delta_seconds = 1.0 / 60.0;
    static constexpr double tower_radius = 0.5;
    static constexpr double core_radius = 0.5;
    static constexpr double core_integrity = 100.0;

    GameSystem();

    [[nodiscard]] FixedUpdateResult fixedUpdate(
        const MovementActionState& actions
    );

    [[nodiscard]] const core::TileMap& tileMap() const noexcept;
    [[nodiscard]] const core::BodySoA& bodies() const noexcept;
    [[nodiscard]] core::BodySoA::Index towerBodyIndex() const noexcept;
    [[nodiscard]] core::BodySoA::Index coreBodyIndex() const noexcept;
    [[nodiscard]] core::Vector2 towerMoveIntent() const noexcept;

private:
    [[nodiscard]] static core::Vector2 mapMovementIntent(
        const MovementActionState& actions
    ) noexcept;

    core::TileMap tileMap_;
    core::BodySoA bodies_;
    core::TileCollisionSolver collisionSolver_;
    core::BodySoA::Index towerBodyIndex_ = 0;
    core::BodySoA::Index coreBodyIndex_ = 0;
    core::Vector2 towerMoveIntent_{};
};

// Hashes the same authoritative object graph as
// export_sdl_game_system_baseline.mjs. Presentation-only state is excluded.
[[nodiscard]] std::uint64_t hashFixedState(
    const GameSystem& gameSystem,
    int tick,
    std::size_t tileCorrectionCount
);

} // namespace cirvivor::game
