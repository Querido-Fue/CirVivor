import { LightTheme, DarkTheme } from 'data/global/color_schemes.js';
import { setBackgroundColor } from 'display/_display_system.js';
import { colorUtil } from 'util/color_util.js';
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

export let ColorSchemes = {};

let themeHandlerInstance = null;

export class ThemeHandler {
    constructor() {
        themeHandlerInstance = this;

        // init() 내부에서 비동기로 호출되도록 설정하되 기본값은 임시 저장
        this.currentTheme = 'dark'; // 임시 기본값
    }

    async init() {
        let isDarkMode = true;
        try {
            const dataDir = path.join(process.cwd(), 'save');
            const settingsPath = path.join(dataDir, 'settings.json');

            try {
                await fsPromises.access(settingsPath);
                const data = JSON.parse(await fsPromises.readFile(settingsPath, 'utf-8'));
                if (data.darkMode !== undefined) {
                    isDarkMode = data.darkMode;
                }
            } catch (err) {
                // 파일이 없거나 읽기 에러
            }
        } catch (e) {
            console.error("ThemeHandler failed to load initial settings:", e);
        }

        this.setTheme(isDarkMode, false); // WebGL 미초기화 상태이므로 화면 갱신은 안 함
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
            const rgb = colorUtil().cssToRgb(ColorSchemes.Background);
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
