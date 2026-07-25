/**
 * The Core의 타일 기준 크기와 생존 자원 기본값입니다.
 * 크기는 렌더 픽셀이 아니라 타일 월드 단위입니다.
 * 일반 entity HP와 구분하기 위해 Integrity 명칭을 사용합니다.
 * @type {Readonly<{RADIUS_TILES:number,MAX_INTEGRITY:number}>}
 */
export const THE_CORE_DATA = Object.freeze({
    RADIUS_TILES: 0.5,
    MAX_INTEGRITY: 100
});
