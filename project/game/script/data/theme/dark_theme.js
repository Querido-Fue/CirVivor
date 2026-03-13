import { OVERLAY_BUTTON_COMMON, DARK_TITLE_BUTTON_HOVER } from './theme_shared.js';

/**
 * 다크 테마 오버레이 전용 색상 및 속성 정의
 */
const DARK_OVERLAY_THEME = Object.freeze({
    Text: Object.freeze({
        Section: '#999999',
        Item: '#d5d5d5',
        Control: '#999999',
        Value: '#aaaaaa'
    }),
    Panel: Object.freeze({
        Background: '#05080eff',
        Border: '#0b1320ff',
        GlassBackground: 'rgba(6, 10, 18, 0.9)',
        GlassBorder: 'rgba(92, 112, 142, 0.34)',
        GlassTint: 'rgba(2, 4, 8, 1)',
        GlassTintStrength: 0.54,
        GlassEdge: 'rgba(76, 97, 130, 1)',
        GlassEdgeStrength: 0.13,
        Divider: 'rgba(255, 255, 255, 0.08)',
        Dim: 0.5
    }),
    Control: Object.freeze({
        Inactive: 'rgba(255, 255, 255, 0.06)',
        Hover: 'rgba(255, 255, 255, 0.12)'
    }),
    Button: Object.freeze({
        ...OVERLAY_BUTTON_COMMON,
        Link: Object.freeze({
            Idle: 'rgba(255, 255, 255, 0.06)',
            Hover: 'rgba(255, 255, 255, 0.12)',
            Text: '#d5d5d5'
        }),
        Option: Object.freeze({
            Active: '#3b82f6',
            ActiveText: '#ffffff'
        })
    }),
    Segment: Object.freeze({
        Background: 'rgba(255, 255, 255, 0.08)',
        Thumb: '#3b82f6',
        TextActive: '#ffffff',
        TextInactive: '#707070'
    }),
    Toggle: Object.freeze({
        Active: '#3b82f6',
        Inactive: 'rgba(255, 255, 255, 0.12)',
        Knob: '#ffffff',
        Shadow: 'rgba(0, 0, 0, 0.3)'
    }),
    Slider: Object.freeze({
        Track: 'rgba(255, 255, 255, 0.12)',
        ValueActive: '#4fa3ff',
        ValueInactive: '#707070',
        Knob: '#ffffff',
        Shadow: 'rgba(0, 0, 0, 0.3)'
    })
});

/**
 * 다크 테마 비네팅 전용 속성 정의
 */
const DARK_VIGNETTE_THEME = Object.freeze({
    WORLD: Object.freeze({
        RGB: Object.freeze([0, 0, 0]),
        AlphaMultiplier: 0.4416
    })
});

/**
 * 게임 전체에 적용되는 다크 테마 설정 모음
 */
export const DarkTheme = Object.freeze({
    Cursor: Object.freeze({
        Fill: '#404040',
        Active: '#4fa3ff',
        White: '#e0e0e0'
    }),
    Title: Object.freeze({
        Background: '#05030a',
        Gradient: Object.freeze({
            Colors: Object.freeze([
                '#210733',
                '#13051f',
                '#090310',
                '#2a0627',
                '#040208'
            ]),
            FallbackColors: Object.freeze([
                '#1a2027',
                '#13181f',
                '#0e131a',
                '#0a0f15',
                '#06090e'
            ])
        }),
        Logo: Object.freeze({
            Fill: '#e0e0e0',
            Shadow: '#05030a'
        }),
        Loading: Object.freeze({
            Text: '#e0e0e0',
            Accent: '#166ffb',
            SkipButton: Object.freeze({
                Text: '#e0e0e0',
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
            Shadow: '#140a28',
            Low: '#9d6dff',
            High: '#83c9ff',
            Highlight: '#f1fdff'
        }),
        Menu: Object.freeze({
            Foreground: '#ffffff',
            Accent: '#166ffb',
            Icon: Object.freeze({
                Fill: '#ffffff',
                Shadow: '#1a1a1a'
            }),
            Opacity: Object.freeze({
                UtilityText: 0.82,
                UtilityTextFocused: 1,
                UtilityBorderFallback: 0.82,
                BackfaceDivider: 0.06,
                BackfaceTagText: 1,
                PanelBackfaceFill: 0.02,
                PanelFill: 0.048,
                PanelStroke: 0.26,
                PanelTint: 0.13,
                PanelEdge: 0.3,
                UtilityPanelStroke: 0.24,
                Placeholder: 0.92,
                CardInnerLine: 0.12,
                CardInnerLineFocusDelta: 0.1,
                CardRow: 0.1
            })
        }),
        TextDark: '#e0e0e0',
        Line: '#686174',
        Shadow: 'rgb(20, 10, 28)',
        Button: Object.freeze({
            Background: Object.freeze({
                Normal: 'rgba(20, 10, 28, 0)',
                Hover: DARK_TITLE_BUTTON_HOVER
            }),
            Text: '#ffffff'
        }),
        Enemy: 'rgba(240, 230, 255, 0.5)'
    }),
    Overlay: DARK_OVERLAY_THEME,
    Vignette: DARK_VIGNETTE_THEME,
    Game: Object.freeze({
        Font: '#e0e0e0'
    }),
    Debug: Object.freeze({
        Background: '#f0f0f0',
        Fill: '#f0f0f0'
    })
});
