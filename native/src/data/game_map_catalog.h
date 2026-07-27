#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace cirvivor::data {

struct GameMapCatalogEntry final {
    std::string_view id{};
};

inline constexpr std::string_view corridor_eight_map_id = "corridor_eight_01";
inline constexpr std::array game_map_catalog{
    GameMapCatalogEntry{corridor_eight_map_id}
};
inline constexpr std::string_view default_game_map_id = game_map_catalog.front().id;
inline constexpr std::size_t maximum_game_map_id_bytes = 63U;

[[nodiscard]] constexpr bool isKnownGameMapId(
    const std::string_view mapId
) noexcept {
    for (const GameMapCatalogEntry& entry : game_map_catalog) {
        if (entry.id == mapId) {
            return true;
        }
    }
    return false;
}

static_assert(!default_game_map_id.empty());
static_assert(default_game_map_id.size() <= maximum_game_map_id_bytes);

} // namespace cirvivor::data
