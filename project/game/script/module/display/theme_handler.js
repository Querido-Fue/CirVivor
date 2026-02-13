import { LightTheme, DarkTheme } from '../../data/global/color_schemes.js';

export let ColorSchemes = {};

let themeHandlerInstance = null;

export class ThemeHandler {
    constructor() {
        themeHandlerInstance = this;
        this.currentTheme = 'light';
        Object.assign(ColorSchemes, LightTheme);
    }

    init() {
    }

    setTheme(isDarkMode) {
        this.currentTheme = isDarkMode ? 'dark' : 'light';
        if (isDarkMode) {
            Object.assign(ColorSchemes, DarkTheme);
        } else {
            Object.assign(ColorSchemes, LightTheme);
        }
    }

    getCurrentTheme() {
        return this.currentTheme;
    }
}

export const setTheme = (isDarkMode) => {
    if (themeHandlerInstance) {
        themeHandlerInstance.setTheme(isDarkMode);
    }
}
