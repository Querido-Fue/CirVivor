export const Easing = {
    //from https://easings.net/
    linear: p => p,

    // Quad
    easeIn: p => p * p,
    easeOut: p => p * (2 - p),
    easeInOut: p => p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p,

    // Sine
    easeInSine: p => 1 - Math.cos((p * Math.PI) / 2),
    easeOutSine: p => Math.sin((p * Math.PI) / 2),
    easeInOutSine: p => -(Math.cos(Math.PI * p) - 1) / 2,

    // Cubic
    easeInCubic: p => p * p * p,
    easeOutCubic: p => (--p) * p * p + 1,
    easeInOutCubic: p => p < 0.5 ? 4 * p * p * p : (p - 1) * (2 * p - 2) * (2 * p - 2) + 1,

    // Quart
    easeInQuart: p => p * p * p * p,
    easeOutQuart: p => 1 - (--p) * p * p * p,
    easeInOutQuart: p => p < 0.5 ? 8 * p * p * p * p : 1 - 8 * (--p) * p * p * p,

    // Quint
    easeInQuint: p => p * p * p * p * p,
    easeOutQuint: p => 1 + (--p) * p * p * p * p,
    easeInOutQuint: p => p < 0.5 ? 16 * p * p * p * p * p : 1 + 16 * (--p) * p * p * p * p,

    // Expo
    easeInExpo: p => p === 0 ? 0 : Math.pow(2, 10 * p - 10),
    easeOutExpo: p => p === 1 ? 1 : 1 - Math.pow(2, -10 * p),
    easeInOutExpo: p => p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2,

    // Circ
    easeInCirc: p => 1 - Math.sqrt(1 - p * p),
    easeOutCirc: p => Math.sqrt(1 - (--p) * p),
    easeInOutCirc: p => p < 0.5 ? (1 - Math.sqrt(1 - 4 * p * p)) / 2 : (Math.sqrt(1 - 4 * (p -= 1) * p) + 1) / 2,

    // Bounce
    easeInBounce: p => 1 - Easing.easeOutBounce(1 - p),
    easeOutBounce: p => {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (p < 1 / d1) {
            return n1 * p * p;
        } else if (p < 2 / d1) {
            return n1 * (p -= 1.5 / d1) * p + 0.75;
        } else if (p < 2.5 / d1) {
            return n1 * (p -= 2.25 / d1) * p + 0.9375;
        } else {
            return n1 * (p -= 2.625 / d1) * p + 0.984375;
        }
    },
    easeInOutBounce: p => p < 0.5 ? (1 - Easing.easeOutBounce(1 - 2 * p)) / 2 : (1 + Easing.easeOutBounce(2 * p - 1)) / 2,

    // Back (오버플로우 타입)
    easeInBack: (p, s = 1.70158) => p * p * ((s + 1) * p - s),
    easeOutBack: (p, s = 1.70158) => --p * p * ((s + 1) * p + s) + 1,
    easeInOutBack: (p, s = 1.70158) => {
        if ((p *= 2) < 1) return 0.5 * (p * p * (((s *= 1.525) + 1) * p - s));
        return 0.5 * ((p -= 2) * p * (((s *= 1.525) + 1) * p + s) + 2);
    },

    // Elastic (오버플로우 타입)
    easeInElastic: p => {
        if (p === 0) return 0; if (p === 1) return 1;
        return -Math.pow(2, 10 * p - 10) * Math.sin((p * 10 - 10.75) * (2 * Math.PI) / 3);
    },
    easeOutElastic: p => {
        if (p === 0) return 0; if (p === 1) return 1;
        return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
    },
    easeInOutElastic: p => {
        if (p === 0) return 0; if (p === 1) return 1;
        const c5 = (2 * Math.PI) / 4.5;
        if (p < 0.5) return -(Math.pow(2, 20 * p - 10) * Math.sin((20 * p - 11.125) * c5)) / 2;
        return (Math.pow(2, -20 * p + 10) * Math.sin((20 * p - 11.125) * c5)) / 2 + 1;
    }
};
