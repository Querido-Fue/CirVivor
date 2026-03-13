import { OVERLAY_BUTTON_COMMON, LIGHT_TITLE_BUTTON_HOVER } from './theme_shared.js';

/**
 * 라이트 테마 오버레이 전용 색상 및 속성 정의
 */
const LIGHT_OVERLAY_THEME = Object.freeze({
    Text: Object.freeze({
        Section: '#666666',
        Item: '#2d2d2d',
        Control: '#666666',
        Value: '#4d4d4d'
    }),
    Panel: Object.freeze({
        Background: '#cececeff',
        Border: '#cececeff',
        GlassBackground: 'rgba(250, 252, 255, 0.9)',
        GlassBorder: 'rgba(255, 255, 255, 0.42)',
        GlassTint: 'rgba(255, 255, 255, 1)',
        GlassTintStrength: 0.28,
        GlassEdge: 'rgba(224, 233, 247, 1)',
        GlassEdgeStrength: 0.16,
        Divider: 'rgba(70, 70, 70, 0.08)',
        Dim: 0.5,
        Shadow: 'rgba(0, 0, 0, 0.3)'
    }),
    Control: Object.freeze({
        Inactive: 'rgba(0, 0, 0, 0.045)',
        Hover: 'rgba(0, 0, 0, 0.08)'
    }),
    Button: Object.freeze({
        ...OVERLAY_BUTTON_COMMON,
        Link: Object.freeze({
            Idle: 'rgba(0, 0, 0, 0.045)',
            Hover: 'rgba(0, 0, 0, 0.08)',
            Text: '#2d2d2d'
        }),
        Option: Object.freeze({
            Active: '#166ffb',
            ActiveText: '#ffffff'
        })
    }),
    Segment: Object.freeze({
        Background: 'rgba(0, 0, 0, 0.05)',
        Thumb: '#ffffff',
        TextActive: '#166ffb',
        TextInactive: '#666666'
    }),
    Toggle: Object.freeze({
        Active: '#166ffb',
        Inactive: 'rgba(0, 0, 0, 0.1)',
        Knob: '#ffffff',
        Shadow: 'rgba(0, 0, 0, 0.3)'
    }),
    Slider: Object.freeze({
        Track: 'rgba(0, 0, 0, 0.16)',
        ValueActive: '#166ffb',
        ValueInactive: '#888888',
        Knob: '#ffffff',
        Shadow: 'rgba(0, 0, 0, 0.3)'
    })
});

/**
 * 라이트 테마 비네팅 전용 속성 정의
 */
const LIGHT_VIGNETTE_THEME = Object.freeze({
    WORLD: Object.freeze({
        RGB: Object.freeze([0, 0, 0]),
        AlphaMultiplier: 1.4688
    })
});

/**
 * 게임 전체에 적용되는 라이트 테마 설정 모음
 */
export const LightTheme = Object.freeze({
    Background: '#cececeff',
    Cursor: Object.freeze({
        Fill: '#cccccc',
        Active: '#166ffb',
        White: '#ffffff'
    }),
    Title: Object.freeze({
        Background: '#cececeff',
        Gradient: Object.freeze({
            Colors: Object.freeze([
                '#d9d9d9',
                '#d4d4d4',
                '#cecece',
                '#c8c8c8',
                '#cfcfcf'
            ]),
            FallbackColors: Object.freeze([
                '#d9d9d9',
                '#d4d4d4',
                '#cecece',
                '#c8c8c8',
                '#cfcfcf'
            ])
        }),
        Logo: Object.freeze({
            Fill: '#202020',
            Shadow: '#cececeff'
        }),
        Loading: Object.freeze({
            Text: '#202020',
            Accent: '#166ffb',
            SkipButton: Object.freeze({
                Text: '#202020',
                Idle: 'rgba(22, 111, 251, 0.12)',
                Hover: 'rgba(22, 111, 251, 0.22)'
            }),
            Glow: Object.freeze({
                HaloStops: Object.freeze([
                    Object.freeze({ offset: 0, color: '#166ffb', alphaScale: 0, maxAlpha: 0 }),
                    Object.freeze({ offset: 0.06, color: '#84ccff', alphaScale: 0.022, maxAlpha: 0.038 }),
                    Object.freeze({ offset: 0.14, color: '#6ec2ff', alphaScale: 0.03, maxAlpha: 0.05 }),
                    Object.freeze({ offset: 0.3, color: '#54b0ff', alphaScale: 0.032, maxAlpha: 0.054 }),
                    Object.freeze({ offset: 0.5, color: '#3897ff', alphaScale: 0.024, maxAlpha: 0.04 }),
                    Object.freeze({ offset: 0.72, color: '#1f7ffb', alphaScale: 0.013, maxAlpha: 0.022 }),
                    Object.freeze({ offset: 0.9, color: '#166ffb', alphaScale: 0.004, maxAlpha: 0.008 }),
                    Object.freeze({ offset: 1, color: '#166ffb', alphaScale: 0, maxAlpha: 0 })
                ]),
                Ring: Object.freeze({
                    Color: '#66bcff',
                    ShadowColor: '#3091ff',
                    AlphaScale: 0.052,
                    AlphaMax: 0.09,
                    ShadowAlphaScale: 0.07,
                    ShadowAlphaMax: 0.12
                }),
                Surface: Object.freeze({
                    Highlight: '#d6f8ff',
                    HighlightAlpha: 0.95,
                    Shadow: '#ccf4ff',
                    ShadowAlpha: 0.45
                })
            })
        }),
        Shield: Object.freeze({
            Shadow: '#f7f9ff',
            Low: '#2f74ed',
            High: '#67aaff',
            Highlight: '#ffffff'
        }),
        Menu: Object.freeze({
            Foreground: '#202020',
            Accent: '#166ffb',
            Icon: Object.freeze({
                Fill: '#202020',
                Shadow: '#666666'
            }),
            Opacity: Object.freeze({
                UtilityText: 0.82,
                UtilityTextFocused: 1,
                UtilityBorderFallback: 0.82,
                BackfaceDivider: 0.06,
                BackfaceTagText: 1,
                PanelBackfaceFill: 0.02,
                PanelFill: 0.045,
                PanelStroke: 0.26,
                PanelTint: 0.12,
                PanelEdge: 0.3,
                UtilityPanelStroke: 0.24,
                Placeholder: 0.92,
                CardInnerLine: 0.12,
                CardInnerLineFocusDelta: 0.1,
                CardRow: 0.1
            })
        }),
        TextDark: '#202020',
        Line: '#888888',
        Shadow: 'rgb(238, 238, 238)',
        Button: Object.freeze({
            Background: Object.freeze({
                Normal: 'rgba(238, 238, 238, 0)',
                Hover: LIGHT_TITLE_BUTTON_HOVER
            }),
            Text: '#000000'
        }),
        Enemy: 'rgba(230, 90, 90, 0.85)'
    }),
    Overlay: LIGHT_OVERLAY_THEME,
    Vignette: LIGHT_VIGNETTE_THEME,
    Game: Object.freeze({
        Font: '#ffffff'
    }),
    Debug: Object.freeze({
        Background: '#101010',
        Fill: '#101010'
    })
});
