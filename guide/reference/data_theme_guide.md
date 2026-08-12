# Data and Theme Boundaries

## `data/` owns declarative values

- Setting and save defaults.
- Content catalogs, gameplay balance, maps, routes, enemies, Tower/Core values.
- Theme tokens, localization packs, and resource metadata.

Implementation owners keep coercion, migration, lookup, validation, layout, animation, rendering, input mapping, protocols, pool/buffer limits, algorithms, SVG templates, and runtime state.

## Access and dependency direction

Import data directly by named export. Do not add a central string registry or `getData(key)` layer.

```text
data (serializable declarations) → module (validation, state, behavior, rendering)
```

- `data/` may compose other data files and import side-effect-free stable vocabulary/normalizers from
  `module/ingame/contract/`; it must not import mutable runtime owners, scenes, DOM, Canvas, WebGL, or save
  handlers.
- Put a shared implementation constant in a side-effect-free leaf module beside its owner, not in `data/`.
- Do not duplicate a data value as an implementation fallback.
- `project/game/script/data/README.md` is the current path-level authority.

## Themes

Theme declarations live in `data/theme/`. Runtime resolution and application live in `module/display/`.

Use `ColorSchemes` for theme-dependent colors. Renderer fallbacks and debug-only colors may stay with their implementation owner. Title data contains metadata and links; title menu actions/layout/reveal remain feature-local.
