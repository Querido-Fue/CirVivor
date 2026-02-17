export const LightTheme = {
    Background: '#cececeff',
    Cursor: {
        Fill: '#cccccc',
        Active: '#166ffb',
        White: '#ffffff'
    },
    Title: {
        Background: '#cececeff',
        TextDark: '#202020',
        Line: '#808080',
        Shadow: 'rgb(235, 235, 235)',
        Button: {
            Background: {
                Normal: 'rgba(235, 235, 235, 0)',
                Hover: 'rgba(0, 0, 0, 0)'
            },
            Text: '#000000'
        },
        Enemy: '#ff5050'
    },
    Overlay: {
        Text: {
            Section: '#888888',
            Item: '#2d2d2d',
            Control: '#888888',
            Value: '#666666'
        },
        Panel: {
            Background: '#cececeff',
            Border: '#cececeff',
            GlassBackground: 'rgba(255, 255, 255, 0.68)',
            GlassBorder: 'rgba(255, 255, 255, 0.45)',
            Divider: 'rgba(0, 0, 0, 0.1)',
            Dim: 'rgba(0, 0, 0, 0.6)'
        },
        Control: {
            Inactive: 'rgba(0, 0, 0, 0.05)',
            Hover: 'rgba(0, 0, 0, 0.1)'
        },
        Button: {
            Confirm: { Idle: '#166ffb', Hover: '#4d94ff', Text: '#ffffff' },
            Cancel: { Idle: '#ff5050', Hover: '#ff7a7a', Text: '#ffffff' },
            Option: { Active: '#166ffb', ActiveText: '#ffffff' }
        },
        Segment: {
            Background: 'rgba(0, 0, 0, 0.06)',
            Thumb: '#ffffff',
            TextActive: '#166ffb',
            TextInactive: '#666666'
        },
        Toggle: {
            Active: '#166ffb',
            Inactive: '#c4c4c4',
            Knob: '#ffffff'
        },
        Slider: {
            Track: 'rgba(0, 0, 0, 0.12)',
            ValueActive: '#166ffb',
            ValueInactive: '#888888',
            Knob: '#ffffff'
        }
    },
    Game: {
        Font: '#ffffff'
    },
    Debug: {
        Background: '#101010',
        Fill: '#101010'
    }
};

export const DarkTheme = {
    Cursor: {
        Fill: '#404040',
        Active: '#4fa3ff',
        White: '#e0e0e0'
    },
    Title: {
        Background: '#1a1a1a',
        TextDark: '#e0e0e0',
        Line: '#606060',
        Shadow: 'rgb(30, 30, 30)',
        Button: {
            Background: {
                Normal: 'rgba(30, 30, 30, 0)',
                Hover: 'rgba(255, 255, 255, 0)'
            },
            Text: '#ffffff'
        },
        Enemy: '#ff6060'
    },
    Overlay: {
        Text: {
            Section: '#808080',
            Item: '#d5d5d5',
            Control: '#808080',
            Value: '#aaaaaa'
        },
        Panel: {
            Background: '#1a1a1aff',
            Border: '#1a1a1aff',
            GlassBackground: 'rgba(10, 10, 10, 0.80)',
            GlassBorder: 'rgba(255, 255, 255, 0.08)',
            Divider: 'rgba(255, 255, 255, 0.08)',
            Dim: 'rgba(0, 0, 0, 0.6)'
        },
        Control: {
            Inactive: 'rgba(255, 255, 255, 0.06)',
            Hover: 'rgba(255, 255, 255, 0.12)'
        },
        Button: {
            Confirm: { Idle: '#166ffb', Hover: '#4d94ff', Text: '#ffffff' },
            Cancel: { Idle: '#ff5050', Hover: '#ff7a7a', Text: '#ffffff' },
            Option: { Active: '#3b82f6', ActiveText: '#ffffff' }
        },
        Segment: {
            Background: 'rgba(255, 255, 255, 0.08)',
            Thumb: '#3b82f6',
            TextActive: '#ffffff',
            TextInactive: '#707070'
        },
        Toggle: {
            Active: '#3b82f6',
            Inactive: '#4a4a4a',
            Knob: '#ffffff'
        },
        Slider: {
            Track: 'rgba(255, 255, 255, 0.15)',
            ValueActive: '#4fa3ff',
            ValueInactive: '#707070',
            Knob: '#ffffff'
        }
    },
    Game: {
        Font: '#e0e0e0'
    },
    Debug: {
        Background: '#f0f0f0',
        Fill: '#f0f0f0'
    }
};
