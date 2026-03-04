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
        Background: '#1a1a1aff',
        Border: '#1a1a1aff',
        GlassBackground: 'rgba(10, 10, 10, 0.80)',
        GlassBorder: 'rgba(255, 255, 255, 0.08)',
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
 * 게임 전체에 적용되는 다크 테마 설정 모음
 */
export const DarkTheme = Object.freeze({
    Cursor: Object.freeze({
        Fill: '#404040',
        Active: '#4fa3ff',
        White: '#e0e0e0'
    }),
    Title: Object.freeze({
        Background: '#1a1a1a',
        TextDark: '#e0e0e0',
        Line: '#606060',
        Shadow: 'rgb(30, 30, 30)',
        Button: Object.freeze({
            Background: Object.freeze({
                Normal: 'rgba(30, 30, 30, 0)',
                Hover: DARK_TITLE_BUTTON_HOVER
            }),
            Text: '#ffffff'
        }),
        Enemy: '#ff6060'
    }),
    Overlay: DARK_OVERLAY_THEME,
    Game: Object.freeze({
        Font: '#e0e0e0'
    }),
    Debug: Object.freeze({
        Background: '#f0f0f0',
        Fill: '#f0f0f0'
    })
});
