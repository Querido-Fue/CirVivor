import { LightTheme, DarkTheme } from 'data/global/color_schemes.js';
import { setBackgroundColor } from 'display/_display_system.js';
import { cssToRgb } from 'util/color_util.js';
const fs = require('fs');
const path = require('path');

export let ColorSchemes = {};

let themeHandlerInstance = null;

export class ThemeHandler {
    constructor() {
        themeHandlerInstance = this;

        // 초기 테마 설정을 동기적으로 로드
        let isDarkMode = true;
        try {
            const dataDir = path.join(process.cwd(), 'save');
            const settingsPath = path.join(dataDir, 'settings.json');
            if (fs.existsSync(settingsPath)) {
                const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                if (data.darkMode !== undefined) {
                    isDarkMode = data.darkMode;
                }
            }
        } catch (e) {
            console.error("ThemeHandler failed to load initial settings:", e);
        }

        this.setTheme(isDarkMode, false); // 생성 시점에는 ColorSchemes만 업데이트하고 화면 갱신은 안 함 (WebGL 미초기화)
    }

    init() {
        this.updateBackgroundColor();
    }

    setTheme(isDarkMode, updateDisplay = true) {
        this.currentTheme = isDarkMode ? 'dark' : 'light';
        if (isDarkMode) {
            Object.assign(ColorSchemes, DarkTheme);
        } else {
            Object.assign(ColorSchemes, LightTheme);
        }

        if (updateDisplay) {
            this.updateBackgroundColor();
        }
    }

    updateBackgroundColor() {
        if (ColorSchemes.Background) {
            const rgb = cssToRgb(ColorSchemes.Background);
            setBackgroundColor(rgb.r / 255, rgb.g / 255, rgb.b / 255);
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
