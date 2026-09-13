/** World units and normalized colors; no gameplay balance lives in this theme. */
export const CERAMIC_WORLD_VISUAL = Object.freeze({
    azimuthDegrees: -35,
    elevationDegrees: 48,
    tileColor: Object.freeze([0.80, 0.83, 0.82]),
    trimColor: Object.freeze([0.12, 0.23, 0.26]),
    tileDepth: 0.85,
    tileGap: 0.025,
    bevel: 0.065
});

/** Linear normalized material colors, independent from gameplay team or HP. */
export const CERAMIC_MATERIAL_COLORS = Object.freeze({
    square: Object.freeze([0.95,0.30,0.12]),
    triangle: Object.freeze([0.99,0.55,0.18]),
    arrow: Object.freeze([0.70,0.32,0.86]),
    penta: Object.freeze([0.90,0.39,0.62]),
    hexa: Object.freeze([0.96,0.69,0.23]),
    jorang: Object.freeze([0.54,0.73,0.28]),
    octa: Object.freeze([0.30,0.49,0.69]),
    ring: Object.freeze([0.77,0.42,0.72]),
    cork: Object.freeze([0.52,0.68,0.58]),
    tower: Object.freeze([0.12,0.65,0.75]),
    projectile: Object.freeze([1.0,0.89,0.40]),
    coreBase: Object.freeze([0.18,0.26,0.29]),
    corePedestal: Object.freeze([0.36,0.53,0.55]),
    coreCrystal: Object.freeze([0.48,0.94,0.89]),
    coreBand: Object.freeze([0.09,0.20,0.23]),
    gatePillar: Object.freeze([0.53,0.63,0.63]),
    gateLamp: Object.freeze([1.0,0.51,0.15]),
    gateLintel: Object.freeze([0.68,0.76,0.74])
});
