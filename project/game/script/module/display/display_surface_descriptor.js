import { getData } from 'data/data_handler.js';

const {
    WEBGL_LAYER_NAME_MAP: DISPLAY_WEBGL_LAYER_NAME_MAP,
    NATIVE_2D_SURFACE_IDS: DISPLAY_NATIVE_2D_SURFACE_IDS,
    STATIC_SURFACE_ORDER_MAP: DISPLAY_STATIC_SURFACE_ORDER_MAP
} = getData('DISPLAY_SURFACE_DATA');
const DISPLAY_NATIVE_2D_SURFACE_ID_SET = new Set(DISPLAY_NATIVE_2D_SURFACE_IDS);

/**
 * display surface descriptor를 생성합니다.
 * @param {object} options - descriptor 생성 옵션입니다.
 * @returns {object} 생성된 surface descriptor입니다.
 */
export function createDisplaySurfaceDescriptor(options) {
    const type = options?.type === 'webgl' ? 'webgl' : '2d';
    const descriptor = {
        id: options.id,
        type,
        mode: options.mode || options.defaultMode || 'batch',
        canvas: options.canvas,
        context: options.context,
        order: Number.isFinite(options.order) ? options.order : getDisplayStaticSurfaceOrder(options.id),
        dynamic: options.dynamic === true,
        persistent: options.persistent === true,
        includeInComposite: options.includeInComposite !== false,
        compositeOpacityFactor: Number.isFinite(options.compositeOpacityFactor)
            ? Math.max(0, options.compositeOpacityFactor)
            : 1
    };

    if (Number.isFinite(options.sequence)) {
        descriptor.sequence = options.sequence;
    }

    return descriptor;
}

/**
 * WebGL 렌더 별칭을 실제 surface 식별자로 변환합니다.
 * @param {string} layerName - 요청된 레이어 이름입니다.
 * @returns {string} 실제 WebGL surface 식별자입니다.
 */
export function resolveDisplayWebGLLayerName(layerName) {
    return DISPLAY_WEBGL_LAYER_NAME_MAP[layerName] || layerName;
}

/**
 * 정적 surface의 기본 표시 순서를 반환합니다.
 * @param {string} surfaceId - surface 식별자입니다.
 * @returns {number} 기본 표시 순서입니다.
 */
export function getDisplayStaticSurfaceOrder(surfaceId) {
    return DISPLAY_STATIC_SURFACE_ORDER_MAP[surfaceId] || 0;
}

/**
 * 렌더 스케일과 독립적으로 네이티브 해상도를 유지할 2D surface인지 반환합니다.
 * @param {object} descriptor - 검사할 surface descriptor입니다.
 * @returns {boolean} 네이티브 2D surface 여부입니다.
 */
export function usesNativeDisplay2DResolution(descriptor) {
    return descriptor?.type === '2d'
        && (descriptor.dynamic === true || DISPLAY_NATIVE_2D_SURFACE_ID_SET.has(descriptor.id));
}

/**
 * 순서 정렬에 사용하는 surface 그룹을 반환합니다.
 * @param {object} descriptor - 평가할 descriptor입니다.
 * @returns {number} 정렬 그룹 값입니다.
 */
export function getDisplaySurfaceSortGroup(descriptor) {
    if (descriptor.id === 'top') {
        return 2;
    }
    if (descriptor.dynamic) {
        return 1;
    }
    return 0;
}

/**
 * display surface descriptor 두 개의 표시 순서를 비교합니다.
 * @param {object} left - 왼쪽 descriptor입니다.
 * @param {object} right - 오른쪽 descriptor입니다.
 * @returns {number} 정렬 비교 결과입니다.
 */
export function compareDisplaySurfaceDescriptors(left, right) {
    const leftGroup = getDisplaySurfaceSortGroup(left);
    const rightGroup = getDisplaySurfaceSortGroup(right);
    if (leftGroup !== rightGroup) {
        return leftGroup - rightGroup;
    }

    if (left.order !== right.order) {
        return left.order - right.order;
    }

    return (left.sequence || 0) - (right.sequence || 0);
}
