import { getTitleMenuIconSource } from './_title_menu_icon.js';

/**
 * 카드와 보조 메뉴에서 사용할 SVG 아이콘 경로 목록을 구성합니다.
 * @param {object[]} cards - 타이틀 메뉴 카드 목록입니다.
 * @param {object[]} secondaryMenuEntries - 하단 보조 메뉴 항목 목록입니다.
 * @returns {string[]} 중복 제거된 SVG 아이콘 경로 목록입니다.
 */
export function buildTitleMenuIconSources(cards, secondaryMenuEntries) {
    const nextSources = [];
    const iconIds = new Set([
        ...cards.map((card) => card.cardDefinition.id),
        ...secondaryMenuEntries.map((menuEntry) => menuEntry.id)
    ]);

    for (const iconId of iconIds) {
        const iconSource = getTitleMenuIconSource(iconId);
        if (!iconSource) {
            continue;
        }
        nextSources.push(iconSource);
    }

    return nextSources;
}

/**
 * 타이틀 메뉴 SVG 아이콘을 비동기로 미리 로드합니다.
 * @param {SVGDrawer} svgDrawer - SVG drawer 인스턴스입니다.
 * @param {string[]} iconSources - 로드할 SVG 아이콘 경로 목록입니다.
 */
export function preloadTitleMenuIconSources(svgDrawer, iconSources) {
    if (!svgDrawer || !Array.isArray(iconSources)) {
        return;
    }

    for (const iconSource of iconSources) {
        void svgDrawer.loadSvgFile(iconSource)
            .catch(() => {});
    }
}

/**
 * 로드된 타이틀 메뉴 SVG 아이콘 참조를 해제합니다.
 * @param {SVGDrawer} svgDrawer - SVG drawer 인스턴스입니다.
 * @param {string[]} iconSources - 해제할 SVG 아이콘 경로 목록입니다.
 */
export function releaseTitleMenuIconSources(svgDrawer, iconSources) {
    if (!svgDrawer || !Array.isArray(iconSources)) {
        return;
    }

    for (const iconSource of iconSources) {
        svgDrawer.releaseSvgFile(iconSource);
    }
}

/**
 * 현재 카드/보조 메뉴 구성에 맞춰 아이콘 목록을 갱신하고 preload를 시작합니다.
 * @param {SVGDrawer} svgDrawer - SVG drawer 인스턴스입니다.
 * @param {object[]} cards - 타이틀 메뉴 카드 목록입니다.
 * @param {object[]} secondaryMenuEntries - 하단 보조 메뉴 항목 목록입니다.
 * @returns {string[]} 갱신된 SVG 아이콘 경로 목록입니다.
 */
export function loadTitleMenuIconSources(svgDrawer, cards, secondaryMenuEntries) {
    const nextSources = buildTitleMenuIconSources(cards, secondaryMenuEntries);
    preloadTitleMenuIconSources(svgDrawer, nextSources);
    return nextSources;
}
