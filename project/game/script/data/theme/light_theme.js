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
        GlassBackground: 'rgba(255, 255, 255, 0.68)',
        GlassBorder: 'rgba(255, 255, 255, 0.45)',
        Divider: 'rgba(0, 0, 0, 0.1)',
        Dim: 0.5,
        Shadow: 'rgba(0, 0, 0, 0.3)'
    }),
    Control: Object.freeze({
        Inactive: 'rgba(0, 0, 0, 0.05)',
        Hover: 'rgba(0, 0, 0, 0.1)'
    }),
    Button: Object.freeze({
        ...OVERLAY_BUTTON_COMMON,
        Link: Object.freeze({
            Idle: 'rgba(0, 0, 0, 0.05)',
            Hover: 'rgba(0, 0, 0, 0.1)',
            Text: '#2d2d2d'
        }),
        Option: Object.freeze({
            Active: '#166ffb',
            ActiveText: '#ffffff'
        })
    }),
    Segment: Object.freeze({
        Background: 'rgba(0, 0, 0, 0.06)',
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
        Track: 'rgba(0, 0, 0, 0.2)',
        ValueActive: '#166ffb',
        ValueInactive: '#888888',
        Knob: '#ffffff',
        Shadow: 'rgba(0, 0, 0, 0.3)'
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
        TextDark: '#202020',
        Line: '#808080',
        Shadow: 'rgb(235, 235, 235)',
        Button: Object.freeze({
            Background: Object.freeze({
                Normal: 'rgba(235, 235, 235, 0)',
                Hover: LIGHT_TITLE_BUTTON_HOVER
            }),
            Text: '#000000'
        }),
        Enemy: '#ff5050'
    }),
    Overlay: LIGHT_OVERLAY_THEME,
    Game: Object.freeze({
        Font: '#ffffff'
    }),
    Debug: Object.freeze({
        Background: '#101010',
        Fill: '#101010'
    })
});
