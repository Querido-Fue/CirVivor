const THEME_KEYS = new Set([
    'themeId',
    'background',
    'floor',
    'platform',
    'ambientGeometry',
    'entityGlow',
    'spawnPortal',
    'core'
]);
const BACKGROUND_KEYS = new Set([
    'nearColor',
    'farColor',
    'vignetteStrength',
    'parallaxStrength'
]);
const FLOOR_KEYS = new Set([
    'baseColor',
    'facetColorA',
    'facetColorB',
    'gridColor',
    'gridOpacity',
    'facetScale'
]);
const PLATFORM_KEYS = new Set([
    'topColor',
    'sideColor',
    'sideDepthWorldUnits',
    'innerHighlightColor',
    'outerRimColor',
    'shadowColor'
]);
const AMBIENT_GEOMETRY_KEYS = new Set([
    'enabled',
    'maximumFragmentCount',
    'opacity',
    'parallaxFactor'
]);
const ENTITY_GLOW_KEYS = new Set([
    'towerIntensity',
    'enemyIntensity',
    'rimWidthPixels',
    'haloWidthPixels',
    'minimumProjectedRadiusForHalo'
]);
const SPAWN_PORTAL_KEYS = new Set([
    'ringCount',
    'radiusScale',
    'colors',
    'pulsePeriodSeconds',
    'rotationPeriodSeconds'
]);
const CORE_KEYS = new Set([
    'baseRadiusScale',
    'ringCount',
    'crystalScale',
    'colors',
    'pulsePeriodSeconds'
]);
const CSS_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** @param {*} value @param {string} label @returns {object} */
function requireRecord(value, label) {
    if (!value
        || typeof value !== 'object'
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError(`${label}은 일반 객체여야 합니다.`);
    }
    return value;
}

/** @param {object} source @param {Set<string>} knownKeys @param {string} label */
function assertKnownKeys(source, knownKeys, label) {
    for (const key of Object.keys(source)) {
        if (!knownKeys.has(key)) {
            throw new TypeError(`${label}.${key}는 알려지지 않은 visual theme 키입니다.`);
        }
    }
}

/** @param {*} value @param {string} label @param {number} minimum @param {number} maximum */
function requireFiniteRange(value, label, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
        throw new RangeError(`${label}은 ${minimum}~${maximum} 범위의 유한수여야 합니다.`);
    }
    return number;
}

/** @param {*} value @param {string} label @param {number} minimum @param {number} maximum */
function requireIntegerRange(value, label, minimum, maximum) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw new RangeError(`${label}은 ${minimum}~${maximum} 범위의 정수여야 합니다.`);
    }
    return number;
}

/** @param {*} value @param {string} label */
function requireColor(value, label) {
    if (typeof value !== 'string' || !CSS_HEX_COLOR_PATTERN.test(value)) {
        throw new TypeError(`${label}은 #RRGGBB 또는 #RRGGBBAA 색상이어야 합니다.`);
    }
    return value.toLowerCase();
}

/** @param {*} value @param {string} label @param {number} minimumLength */
function requireColorList(value, label, minimumLength) {
    if (!Array.isArray(value)
        || value.length < minimumLength
        || value.length > 8) {
        throw new RangeError(`${label}은 ${minimumLength}~8개 색상 배열이어야 합니다.`);
    }
    return value.map((color, index) => requireColor(color, `${label}[${index}]`));
}

/** @param {*} value @returns {*} */
function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const key of Object.keys(value)) {
        deepFreeze(value[key]);
    }
    return Object.freeze(value);
}

/** Stable UTF-16 FNV-1a uint32 fingerprint를 계산합니다. */
function fingerprintCanonicalTheme(theme) {
    const canonical = JSON.stringify(theme);
    let hash = 0x811c9dc5;
    for (let index = 0; index < canonical.length; index++) {
        const code = canonical.charCodeAt(index);
        hash ^= code & 0xff;
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash ^= code >>> 8;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/**
 * 선언형 인게임 visual theme를 strict validation하고 deep-frozen snapshot으로 만듭니다.
 * @param {*} source - authored visual theme입니다.
 * @returns {object} fingerprint를 포함한 불변 visual theme입니다.
 */
export function defineMapVisualTheme(source) {
    const theme = requireRecord(source, 'mapVisualTheme');
    assertKnownKeys(theme, THEME_KEYS, 'mapVisualTheme');
    if (typeof theme.themeId !== 'string'
        || theme.themeId.length > 64
        || !THEME_ID_PATTERN.test(theme.themeId)) {
        throw new TypeError('mapVisualTheme.themeId가 유효하지 않습니다.');
    }

    const background = requireRecord(theme.background, 'background');
    const floor = requireRecord(theme.floor, 'floor');
    const platform = requireRecord(theme.platform, 'platform');
    const ambientGeometry = requireRecord(
        theme.ambientGeometry,
        'ambientGeometry'
    );
    const entityGlow = requireRecord(theme.entityGlow, 'entityGlow');
    const spawnPortal = requireRecord(theme.spawnPortal, 'spawnPortal');
    const core = requireRecord(theme.core, 'core');
    assertKnownKeys(background, BACKGROUND_KEYS, 'background');
    assertKnownKeys(floor, FLOOR_KEYS, 'floor');
    assertKnownKeys(platform, PLATFORM_KEYS, 'platform');
    assertKnownKeys(
        ambientGeometry,
        AMBIENT_GEOMETRY_KEYS,
        'ambientGeometry'
    );
    assertKnownKeys(entityGlow, ENTITY_GLOW_KEYS, 'entityGlow');
    assertKnownKeys(spawnPortal, SPAWN_PORTAL_KEYS, 'spawnPortal');
    assertKnownKeys(core, CORE_KEYS, 'core');
    if (typeof ambientGeometry.enabled !== 'boolean') {
        throw new TypeError('ambientGeometry.enabled는 boolean이어야 합니다.');
    }

    const normalized = {
        themeId: theme.themeId,
        background: {
            nearColor: requireColor(background.nearColor, 'background.nearColor'),
            farColor: requireColor(background.farColor, 'background.farColor'),
            vignetteStrength: requireFiniteRange(
                background.vignetteStrength,
                'background.vignetteStrength',
                0,
                1
            ),
            parallaxStrength: requireFiniteRange(
                background.parallaxStrength,
                'background.parallaxStrength',
                0,
                1
            )
        },
        floor: {
            baseColor: requireColor(floor.baseColor, 'floor.baseColor'),
            facetColorA: requireColor(floor.facetColorA, 'floor.facetColorA'),
            facetColorB: requireColor(floor.facetColorB, 'floor.facetColorB'),
            gridColor: requireColor(floor.gridColor, 'floor.gridColor'),
            gridOpacity: requireFiniteRange(
                floor.gridOpacity,
                'floor.gridOpacity',
                0,
                1
            ),
            facetScale: requireFiniteRange(
                floor.facetScale,
                'floor.facetScale',
                1,
                64
            )
        },
        platform: {
            topColor: requireColor(platform.topColor, 'platform.topColor'),
            sideColor: requireColor(platform.sideColor, 'platform.sideColor'),
            sideDepthWorldUnits: requireFiniteRange(
                platform.sideDepthWorldUnits,
                'platform.sideDepthWorldUnits',
                0,
                2
            ),
            innerHighlightColor: requireColor(
                platform.innerHighlightColor,
                'platform.innerHighlightColor'
            ),
            outerRimColor: requireColor(
                platform.outerRimColor,
                'platform.outerRimColor'
            ),
            shadowColor: requireColor(platform.shadowColor, 'platform.shadowColor')
        },
        ambientGeometry: {
            enabled: ambientGeometry.enabled,
            maximumFragmentCount: requireIntegerRange(
                ambientGeometry.maximumFragmentCount,
                'ambientGeometry.maximumFragmentCount',
                0,
                256
            ),
            opacity: requireFiniteRange(
                ambientGeometry.opacity,
                'ambientGeometry.opacity',
                0,
                1
            ),
            parallaxFactor: requireFiniteRange(
                ambientGeometry.parallaxFactor,
                'ambientGeometry.parallaxFactor',
                0,
                1
            )
        },
        entityGlow: {
            towerIntensity: requireFiniteRange(
                entityGlow.towerIntensity,
                'entityGlow.towerIntensity',
                0,
                1
            ),
            enemyIntensity: requireFiniteRange(
                entityGlow.enemyIntensity,
                'entityGlow.enemyIntensity',
                0,
                1
            ),
            rimWidthPixels: requireFiniteRange(
                entityGlow.rimWidthPixels,
                'entityGlow.rimWidthPixels',
                0,
                8
            ),
            haloWidthPixels: requireFiniteRange(
                entityGlow.haloWidthPixels,
                'entityGlow.haloWidthPixels',
                0,
                24
            ),
            minimumProjectedRadiusForHalo: requireFiniteRange(
                entityGlow.minimumProjectedRadiusForHalo,
                'entityGlow.minimumProjectedRadiusForHalo',
                0,
                64
            )
        },
        spawnPortal: {
            ringCount: requireIntegerRange(
                spawnPortal.ringCount,
                'spawnPortal.ringCount',
                1,
                8
            ),
            radiusScale: requireFiniteRange(
                spawnPortal.radiusScale,
                'spawnPortal.radiusScale',
                0.5,
                4
            ),
            colors: requireColorList(spawnPortal.colors, 'spawnPortal.colors', 3),
            pulsePeriodSeconds: requireFiniteRange(
                spawnPortal.pulsePeriodSeconds,
                'spawnPortal.pulsePeriodSeconds',
                0.1,
                60
            ),
            rotationPeriodSeconds: requireFiniteRange(
                spawnPortal.rotationPeriodSeconds,
                'spawnPortal.rotationPeriodSeconds',
                0.1,
                120
            )
        },
        core: {
            baseRadiusScale: requireFiniteRange(
                core.baseRadiusScale,
                'core.baseRadiusScale',
                0.5,
                2
            ),
            ringCount: requireIntegerRange(core.ringCount, 'core.ringCount', 1, 8),
            crystalScale: requireFiniteRange(
                core.crystalScale,
                'core.crystalScale',
                0.1,
                1.5
            ),
            colors: requireColorList(core.colors, 'core.colors', 4),
            pulsePeriodSeconds: requireFiniteRange(
                core.pulsePeriodSeconds,
                'core.pulsePeriodSeconds',
                0.1,
                60
            )
        }
    };
    return deepFreeze({
        ...normalized,
        fingerprint: fingerprintCanonicalTheme(normalized)
    });
}

