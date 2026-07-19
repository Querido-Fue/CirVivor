import { getData } from 'data/data_handler.js';

const {
    WEBGL_RENDER_MODES: DISPLAY_WEBGL_RENDER_MODES,
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
    const compositeKind = options.compositeKind === 'solid' || options.compositeKind === 'skip'
        ? options.compositeKind
        : 'canvas';
    const descriptor = {
        id: options.id,
        type,
        mode: options.mode || options.defaultMode || DISPLAY_WEBGL_RENDER_MODES.BATCH,
        canvas: options.canvas,
        context: options.context,
        order: Number.isFinite(options.order) ? options.order : getDisplayStaticSurfaceOrder(options.id),
        dynamic: options.dynamic === true,
        persistent: options.persistent === true,
        includeInComposite: options.includeInComposite !== false,
        compositeOpacityFactor: Number.isFinite(options.compositeOpacityFactor)
            ? Math.max(0, options.compositeOpacityFactor)
            : 1,
        compositeKind,
        compositeSolidOpacity: 0,
        contentRevision: 0,
        compositeStateRevision: 0,
        drawCountThisFrame: 0,
        wasNonEmptyLastFrame: false,
        isEmpty: true,
        forceBackingReset: options.dynamic === true
    };

    descriptor.compositeSource = {
        kind: compositeKind === 'solid' ? 'dim' : 'canvas',
        canvas: descriptor.canvas,
        opacity: 0,
        revision: 0
    };
    descriptor.compositeSnapshot = {
        snapshotIdentity: `before:${descriptor.id}`,
        sourceRevision: 0,
        sources: [],
        sourceDescriptors: [],
        sourceContentRevisions: [],
        sourceCompositeRevisions: [],
        sourceOpacities: [],
        sourceKinds: []
    };

    if (Number.isFinite(options.sequence)) {
        descriptor.sequence = options.sequence;
    }

    return descriptor;
}

/**
 * WebGL 렌더 별칭을 현재 alias 맵의 프로퍼티 조회 결과로 해석합니다.
 * `layerName`은 조회 과정에서 PropertyKey로 변환되며 상속 프로퍼티도 조회에 포함됩니다.
 * 조회 결과가 truthy이면 해당 값을 반환하고, falsy이면 변환 전 원래 입력 identity를 반환합니다.
 * PropertyKey 변환 또는 프로퍼티 조회 중 발생한 예외는 그대로 동기 전파됩니다.
 *
 * @param {*} layerName - alias 조회에 사용할 입력입니다.
 * @returns {*} truthy alias 값 또는 변환 전 원래 입력입니다.
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
