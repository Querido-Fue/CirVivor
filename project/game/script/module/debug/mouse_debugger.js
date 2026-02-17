import { ColorSchemes } from 'display/theme_handler.js';
import { render, getWW } from 'display/_display_system.js';
import { getMouseInput } from 'input/_input_system.js';


export class MouseDebugger {
    constructor() {
    }

    /**
     * 마우스 디버거 업데이트
     */
    update() {
    }

    /**
     * 마우스 정보를 화면에 그립니다.
     */
    draw() {
        const x = getMouseInput("x");
        const y = getMouseInput("y");
        const lineHeight = 20;
        const startX = x + 50;
        const startY = y + 50;

        const lines = [
            `${x.toFixed(2)}, ${y.toFixed(2)}`,
            `left: ${getMouseInput("leftClicked")}, ${getMouseInput("leftClicking")}`,
            `right: ${getMouseInput("rightClicked")}, ${getMouseInput("rightClicking")}`,
            `focus: ${getMouseInput("focusList")}`
        ];

        const WW = getWW();

        const fontSize = WW * 0.008;

        lines.forEach((text, i) => {
            render('top', {
                shape: 'text',
                text: text,
                x: startX,
                y: startY + (i * lineHeight),
                font: `300 ${fontSize}px 'Pretendard Variable'`,
                fill: ColorSchemes.Debug.Fill,
                align: 'left',
                baseline: 'middle'
            });
        });
    }
}