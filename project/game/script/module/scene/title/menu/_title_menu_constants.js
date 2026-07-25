/** 카드·유틸리티 pane의 WebGL 상호작용 효과 상수입니다. */
export const TITLE_MENU_OVERLAY_EFFECTS = Object.freeze({
    hoverTilt: Object.freeze({
        maxAngleDeg: 6,
        smoothing: 0.18,
        perspective: 1180
    }),
    hoverSpotlight: Object.freeze({
        radius: 280,
        opacity: 0.8,
        smoothing: 0.2
    }),
    hoverBorder: Object.freeze({
        radius: 280,
        opacity: 0.75,
        width: 1.2,
        hoverWidth: 2.4,
        falloff: 80,
        smoothing: 0.2
    }),
    clickRipple: Object.freeze({
        duration: 0.8
    }),
    hoverParticle: Object.freeze({
        count: 12,
        spawnInterval: 0.08,
        driftDistance: 84,
        minDuration: 1.8,
        maxDuration: 3.2
    })
});
