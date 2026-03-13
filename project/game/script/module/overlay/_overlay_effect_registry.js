/**
 * @typedef {object} OverlayEffectPlugin
 * @property {(session: object, options: object) => object} create - effect 상태를 생성합니다.
 */

const EFFECT_REGISTRY = new Map();

/**
 * px 문자열 또는 숫자를 실수 픽셀 값으로 정규화합니다.
 * @param {string|number|undefined|null} value - 정규화할 길이 값입니다.
 * @param {number} fallbackValue - 기본값입니다.
 * @returns {number} 정규화된 픽셀 값입니다.
 */
function parseEffectLength(value, fallbackValue) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const matched = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
        if (matched) {
            return Number.parseFloat(matched[1]);
        }
    }

    return fallbackValue;
}

/**
 * effect 숫자 옵션을 실수로 정규화합니다.
 * @param {number|string|undefined|null} value - 정규화할 값입니다.
 * @param {number} fallbackValue - 기본값입니다.
 * @returns {number} 정규화된 실수 값입니다.
 */
function parseEffectNumber(value, fallbackValue) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsedValue = Number.parseFloat(value.trim());
        if (Number.isFinite(parsedValue)) {
            return parsedValue;
        }
    }

    return fallbackValue;
}

/**
 * effect 색상 옵션을 문자열로 정규화합니다.
 * @param {string|undefined|null} value - 정규화할 색상입니다.
 * @param {string} fallbackValue - 기본값입니다.
 * @returns {string} 정규화된 색상 문자열입니다.
 */
function parseEffectColor(value, fallbackValue) {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    return fallbackValue;
}

/**
 * 오버레이 effect 플러그인을 등록합니다.
 * @param {string} effectName - effect 식별자입니다.
 * @param {OverlayEffectPlugin} plugin - 등록할 플러그인입니다.
 */
export function registerOverlayEffect(effectName, plugin) {
    if (!effectName || !plugin || typeof plugin.create !== 'function') {
        return;
    }

    EFFECT_REGISTRY.set(effectName, plugin);
}

/**
 * effect 상태 객체를 생성합니다.
 * @param {string} effectName - effect 식별자입니다.
 * @param {object} session - 연결된 overlay session입니다.
 * @param {object} options - effect 옵션입니다.
 * @returns {object|null} 생성된 effect 상태입니다.
 */
export function createOverlayEffectState(effectName, session, options) {
    const plugin = EFFECT_REGISTRY.get(effectName);
    if (!plugin) {
        return null;
    }

    return plugin.create(session, options || {});
}

registerOverlayEffect('tilt', {
    /**
     * @param {object} _session - 연결된 overlay session입니다.
     * @param {object} options - tilt effect 옵션입니다.
     * @returns {object} 향후 tilt 확장을 위한 기본 상태입니다.
     */
    create(_session, options) {
        return {
            type: 'tilt',
            options,
            update() {
            },
            getTransformMatrix() {
                return null;
            }
        };
    }
});

registerOverlayEffect('shadow', {
    /**
     * @param {object} _session - 연결된 overlay session입니다.
     * @param {object} options - shadow effect 옵션입니다.
     * @returns {object} shadow effect 상태입니다.
     */
    create(_session, options) {
        const normalizedOptions = {
            radius: Math.max(0, parseEffectLength(options.radius, 18)),
            offsetX: parseEffectLength(options.offsetX, 0),
            offsetY: parseEffectLength(options.offsetY, 8),
            color: typeof options.color === 'string' ? options.color : 'rgba(0, 0, 0, 0.32)'
        };

        return {
            type: 'shadow',
            options: normalizedOptions,
            update() {
            },
            getRenderOptions() {
                return {
                    shadowRadius: normalizedOptions.radius,
                    shadowOffsetX: normalizedOptions.offsetX,
                    shadowOffsetY: normalizedOptions.offsetY,
                    shadowColor: normalizedOptions.color
                };
            }
        };
    }
});

registerOverlayEffect('hoverTilt', {
    /**
     * @param {object} _session - 연결된 overlay session입니다.
     * @param {object} options - hover tilt effect 옵션입니다.
     * @returns {object} hover tilt effect 상태입니다.
     */
    create(_session, options) {
        return {
            type: 'hoverTilt',
            options: {
                maxAngleDeg: Math.max(0, parseEffectNumber(options.maxAngleDeg, 10)),
                smoothing: Math.max(0, Math.min(0.98, parseEffectNumber(options.smoothing, 0.18))),
                perspective: Math.max(100, parseEffectLength(options.perspective, 1000))
            },
            update() {
            }
        };
    }
});

registerOverlayEffect('hoverSpotlight', {
    /**
     * @param {object} _session - 연결된 overlay session입니다.
     * @param {object} options - hover spotlight effect 옵션입니다.
     * @returns {object} hover spotlight effect 상태입니다.
     */
    create(_session, options) {
        return {
            type: 'hoverSpotlight',
            options: {
                radius: Math.max(32, parseEffectLength(options.radius, 300)),
                opacity: Math.max(0, Math.min(1, parseEffectNumber(options.opacity, 0.8))),
                smoothing: Math.max(0, Math.min(0.98, parseEffectNumber(options.smoothing, 0.2)))
            },
            update() {
            }
        };
    }
});

registerOverlayEffect('hoverBorder', {
    /**
     * @param {object} _session - 연결된 overlay session입니다.
     * @param {object} options - hover border effect 옵션입니다.
     * @returns {object} hover border effect 상태입니다.
     */
    create(_session, options) {
        const baseWidth = Math.max(0, parseEffectNumber(options.width, 1.2));
        return {
            type: 'hoverBorder',
            options: {
                radius: Math.max(32, parseEffectLength(options.radius, 260)),
                color: parseEffectColor(options.color, '#ffffff'),
                opacity: Math.max(0, Math.min(1, parseEffectNumber(options.opacity, 0.65))),
                width: baseWidth,
                hoverWidth: Math.max(baseWidth, parseEffectNumber(options.hoverWidth, baseWidth * 2)),
                falloff: Math.max(8, parseEffectLength(options.falloff, 72)),
                smoothing: Math.max(0, Math.min(0.98, parseEffectNumber(options.smoothing, 0.2)))
            },
            update() {
            }
        };
    }
});

registerOverlayEffect('clickRipple', {
    /**
     * @param {object} _session - 연결된 overlay session입니다.
     * @param {object} options - click ripple effect 옵션입니다.
     * @returns {object} click ripple effect 상태입니다.
     */
    create(_session, options) {
        return {
            type: 'clickRipple',
            options: {
                duration: Math.max(0.1, parseEffectNumber(options.duration, 0.8))
            },
            update() {
            }
        };
    }
});

registerOverlayEffect('hoverParticle', {
    /**
     * @param {object} _session - 연결된 overlay session입니다.
     * @param {object} options - hover particle effect 옵션입니다.
     * @returns {object} hover particle effect 상태입니다.
     */
    create(_session, options) {
        return {
            type: 'hoverParticle',
            options: {
                count: Math.max(1, Math.floor(parseEffectNumber(options.count, 12))),
                spawnInterval: Math.max(0, parseEffectNumber(options.spawnInterval, 0.1)),
                driftDistance: Math.max(8, parseEffectLength(options.driftDistance, 100)),
                minDuration: Math.max(0.2, parseEffectNumber(options.minDuration, 2)),
                maxDuration: Math.max(0.2, parseEffectNumber(options.maxDuration, 4))
            },
            update() {
            }
        };
    }
});
