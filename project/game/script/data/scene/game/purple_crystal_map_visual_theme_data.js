import {
    defineMapVisualTheme
} from '../../../module/ingame/contract/map_visual_theme_contract.js';

export const MAP_VISUAL_THEME_ID = Object.freeze({
    FLAT: 'flat.v1',
    PURPLE_CRYSTAL: 'purple-crystal.v1'
});

export const FLAT_MAP_VISUAL_THEME = defineMapVisualTheme({
    themeId: MAP_VISUAL_THEME_ID.FLAT,
    background: {
        nearColor: '#05070b',
        farColor: '#05070b',
        vignetteStrength: 0,
        parallaxStrength: 0
    },
    floor: {
        baseColor: '#1b2a3a',
        facetColorA: '#1b2a3a',
        facetColorB: '#1b2a3a',
        gridColor: '#1b2a3a',
        gridOpacity: 0,
        facetScale: 8
    },
    platform: {
        topColor: '#1b2a3a',
        sideColor: '#1b2a3a',
        sideDepthWorldUnits: 0,
        innerHighlightColor: '#1b2a3a',
        outerRimColor: '#1b2a3a',
        shadowColor: '#05070b'
    },
    ambientGeometry: {
        enabled: false,
        maximumFragmentCount: 0,
        opacity: 0,
        parallaxFactor: 0
    },
    entityGlow: {
        towerIntensity: 0,
        enemyIntensity: 0,
        rimWidthPixels: 0,
        haloWidthPixels: 0,
        minimumProjectedRadiusForHalo: 64
    },
    spawnPortal: {
        ringCount: 1,
        radiusScale: 1,
        colors: ['#1b2a3a', '#1b2a3a', '#05070b'],
        pulsePeriodSeconds: 4,
        rotationPeriodSeconds: 12
    },
    core: {
        baseRadiusScale: 1,
        ringCount: 1,
        crystalScale: 0.5,
        colors: ['#ffb52e', '#ffb52e', '#ffb52e', '#1b2a3a'],
        pulsePeriodSeconds: 4
    }
});

export const PURPLE_CRYSTAL_MAP_VISUAL_THEME = defineMapVisualTheme({
    themeId: MAP_VISUAL_THEME_ID.PURPLE_CRYSTAL,
    background: {
        nearColor: '#090613',
        farColor: '#17112d',
        vignetteStrength: 0.42,
        parallaxStrength: 0.08
    },
    floor: {
        baseColor: '#291643',
        facetColorA: '#371d58',
        facetColorB: '#211238',
        gridColor: '#7542aa',
        gridOpacity: 0.12,
        facetScale: 7
    },
    platform: {
        topColor: '#31194d',
        sideColor: '#140a21',
        sideDepthWorldUnits: 0.34,
        innerHighlightColor: '#7540a8',
        outerRimColor: '#a950ff',
        shadowColor: '#050209'
    },
    ambientGeometry: {
        enabled: true,
        maximumFragmentCount: 44,
        opacity: 0.22,
        parallaxFactor: 0.18
    },
    entityGlow: {
        towerIntensity: 0.42,
        enemyIntensity: 0.18,
        rimWidthPixels: 1.25,
        haloWidthPixels: 4.5,
        minimumProjectedRadiusForHalo: 4.5
    },
    spawnPortal: {
        ringCount: 3,
        radiusScale: 1.35,
        colors: ['#ff4fd8', '#bf42ff', '#35102f'],
        pulsePeriodSeconds: 2.4,
        rotationPeriodSeconds: 8
    },
    core: {
        baseRadiusScale: 1.25,
        ringCount: 3,
        crystalScale: 0.72,
        colors: ['#f2eaff', '#b994ff', '#ffc064', '#3b235e'],
        pulsePeriodSeconds: 3.2
    }
});

const MAP_VISUAL_THEME_CATALOG = Object.freeze({
    [MAP_VISUAL_THEME_ID.FLAT]: FLAT_MAP_VISUAL_THEME,
    [MAP_VISUAL_THEME_ID.PURPLE_CRYSTAL]: PURPLE_CRYSTAL_MAP_VISUAL_THEME
});

/** 알 수 없거나 준비되지 않은 theme ID는 기존 flat presentation으로 대체합니다. */
export function resolveMapVisualTheme(themeId) {
    const requestedId = typeof themeId === 'string' ? themeId.trim() : '';
    return Object.hasOwn(MAP_VISUAL_THEME_CATALOG, requestedId)
        ? MAP_VISUAL_THEME_CATALOG[requestedId]
        : FLAT_MAP_VISUAL_THEME;
}

export const MAP_VISUAL_THEME_DATA = Object.freeze({
    DEFAULT_THEME_ID: MAP_VISUAL_THEME_ID.FLAT,
    THEMES: Object.freeze([
        FLAT_MAP_VISUAL_THEME,
        PURPLE_CRYSTAL_MAP_VISUAL_THEME
    ])
});

