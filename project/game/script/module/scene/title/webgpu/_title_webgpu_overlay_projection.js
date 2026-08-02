const DEFAULT_PERSPECTIVE = 1000;
const DEFAULT_GLASS_AA_WIDTH = 1;
const IDENTITY_MATRIX = Object.freeze([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
]);

/**
 * Glass pass와 backdrop ROI planner가 동일한 사각형 투영 규칙을 공유합니다.
 * target은 최소 8개 숫자를 보관할 수 있는 caller 소유 배열이어야 합니다.
 */
export function resolveTitleWebGpuOverlayProjectedQuad(
    panel,
    x,
    y,
    width,
    height,
    target
) {
    if (!isWritableQuadTarget(target)) {
        throw new TypeError('title WebGPU projected quad target은 길이 8 이상의 배열이어야 합니다.');
    }

    const suppliedQuad = panel?.projectedQuad ?? panel?.quad;
    if (suppliedQuad !== undefined && suppliedQuad !== null) {
        if (!copyProjectedQuad(suppliedQuad, target)) {
            return false;
        }
        return isUsableQuad(target);
    }

    const matrix = isMatrix4(panel?.transformMatrix)
        ? panel.transformMatrix
        : IDENTITY_MATRIX;
    const perspective = Math.max(1, finiteOr(panel?.perspective, DEFAULT_PERSPECTIVE));
    const centerX = x + (width * 0.5);
    const centerY = y + (height * 0.5);
    const left = -width * 0.5;
    const right = width * 0.5;
    const top = -height * 0.5;
    const bottom = height * 0.5;
    for (let index = 0; index < 4; index++) {
        const localX = index === 0 || index === 3 ? left : right;
        const localY = index < 2 ? top : bottom;
        const transformedX = (matrix[0] * localX) + (matrix[4] * localY) + matrix[12];
        const transformedY = (matrix[1] * localX) + (matrix[5] * localY) + matrix[13];
        const transformedZ = (matrix[2] * localX) + (matrix[6] * localY) + matrix[14];
        const perspectiveScale = perspective / Math.max(1, perspective - transformedZ);
        target[index * 2] = centerX + (transformedX * perspectiveScale);
        target[(index * 2) + 1] = centerY + (transformedY * perspectiveScale);
    }
    return isUsableQuad(target);
}

/**
 * Glass pass와 content ROI planner가 공유하는 local→screen homography입니다.
 * 유효하지 않은 입력은 예외 대신 false로 닫아 caller가 full-screen fallback할 수 있게 합니다.
 */
export function createTitleWebGpuOverlayRectToQuadHomography(
    width,
    height,
    quad,
    target
) {
    if (!Number.isFinite(width) || width <= 0
        || !Number.isFinite(height) || height <= 0
        || !isWritableQuadTarget(quad)
        || !isWritableMatrix3Target(target)) {
        return false;
    }
    const x0 = quad[0];
    const y0 = quad[1];
    const x1 = quad[2];
    const y1 = quad[3];
    const x2 = quad[4];
    const y2 = quad[5];
    const x3 = quad[6];
    const y3 = quad[7];
    if (![x0, y0, x1, y1, x2, y2, x3, y3].every(Number.isFinite)) {
        return false;
    }
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const dy3 = y0 - y1 + y2 - y3;
    let perspectiveX = 0;
    let perspectiveY = 0;

    if (Math.abs(dx3) > 1e-10 || Math.abs(dy3) > 1e-10) {
        const denominator = (dx1 * dy2) - (dx2 * dy1);
        if (Math.abs(denominator) < 1e-10) {
            return false;
        }
        perspectiveX = ((dx3 * dy2) - (dx2 * dy3)) / denominator;
        perspectiveY = ((dx1 * dy3) - (dx3 * dy1)) / denominator;
    }

    target[0] = (x1 - x0 + (perspectiveX * x1)) / width;
    target[1] = (x3 - x0 + (perspectiveY * x3)) / height;
    target[2] = x0;
    target[3] = (y1 - y0 + (perspectiveX * y1)) / width;
    target[4] = (y3 - y0 + (perspectiveY * y3)) / height;
    target[5] = y0;
    target[6] = perspectiveX / width;
    target[7] = perspectiveY / height;
    target[8] = 1;
    return true;
}

/** Glass shader가 screen→local 좌표에 사용하는 3×3 역행렬입니다. */
export function invertTitleWebGpuOverlayMatrix3(matrix, target) {
    if (!isWritableMatrix3Target(matrix) || !isWritableMatrix3Target(target)) {
        return false;
    }
    const determinant =
        (matrix[0] * ((matrix[4] * matrix[8]) - (matrix[5] * matrix[7])))
        - (matrix[1] * ((matrix[3] * matrix[8]) - (matrix[5] * matrix[6])))
        + (matrix[2] * ((matrix[3] * matrix[7]) - (matrix[4] * matrix[6])));
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) {
        return false;
    }
    const inverseDeterminant = 1 / determinant;
    target[0] = ((matrix[4] * matrix[8]) - (matrix[5] * matrix[7])) * inverseDeterminant;
    target[1] = ((matrix[2] * matrix[7]) - (matrix[1] * matrix[8])) * inverseDeterminant;
    target[2] = ((matrix[1] * matrix[5]) - (matrix[2] * matrix[4])) * inverseDeterminant;
    target[3] = ((matrix[5] * matrix[6]) - (matrix[3] * matrix[8])) * inverseDeterminant;
    target[4] = ((matrix[0] * matrix[8]) - (matrix[2] * matrix[6])) * inverseDeterminant;
    target[5] = ((matrix[2] * matrix[3]) - (matrix[0] * matrix[5])) * inverseDeterminant;
    target[6] = ((matrix[3] * matrix[7]) - (matrix[4] * matrix[6])) * inverseDeterminant;
    target[7] = ((matrix[1] * matrix[6]) - (matrix[0] * matrix[7])) * inverseDeterminant;
    target[8] = ((matrix[0] * matrix[4]) - (matrix[1] * matrix[3])) * inverseDeterminant;
    return true;
}

/**
 * Glass fragment가 영향을 줄 수 있는 local-space halo를 계산합니다.
 * recording은 shadow color 해석 권한이 없으므로 shadowVisible=true로 보수 적용할 수 있습니다.
 */
export function resolveTitleWebGpuOverlayGlassVisualHalo(
    panel,
    { shadowVisible = true, aaWidth = DEFAULT_GLASS_AA_WIDTH } = {}
) {
    const resolvedAaWidth = Math.max(0, finiteOr(aaWidth, DEFAULT_GLASS_AA_WIDTH));
    const lineWidth = Math.max(0, finiteOr(panel?.lineWidth, 1));
    const refractionStrength = Math.abs(finiteOr(panel?.refractionStrength, 0));
    const shadowRadius = Math.max(0, finiteOr(panel?.shadowRadius, 0));
    const shadowOffsetX = Math.abs(finiteOr(panel?.shadowOffsetX, 0));
    const shadowOffsetY = Math.abs(finiteOr(panel?.shadowOffsetY, 0));
    const shadowHalo = shadowVisible && shadowRadius > 0
        ? (shadowRadius * 3) + Math.max(shadowOffsetX, shadowOffsetY)
        : 0;
    return Math.max(
        resolvedAaWidth + lineWidth,
        refractionStrength + resolvedAaWidth,
        shadowHalo + resolvedAaWidth
    );
}

/**
 * local-space halo까지 투영한 실제 WebGPU scissor/content bounds입니다.
 * perspective pole을 가로지르거나 viewport 밖이면 null로 fail-closed합니다.
 */
export function resolveTitleWebGpuOverlayProjectedScissor(
    homography,
    panelWidth,
    panelHeight,
    halo,
    targetWidth,
    targetHeight
) {
    if (!isWritableMatrix3Target(homography)
        || !Number.isFinite(panelWidth) || panelWidth <= 0
        || !Number.isFinite(panelHeight) || panelHeight <= 0
        || !Number.isFinite(halo) || halo < 0
        || !Number.isFinite(targetWidth) || targetWidth <= 0
        || !Number.isFinite(targetHeight) || targetHeight <= 0) {
        return null;
    }
    const left = -halo;
    const top = -halo;
    const right = panelWidth + halo;
    const bottom = panelHeight + halo;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let denominatorSign = 0;
    for (let index = 0; index < 4; index++) {
        const localX = index === 0 || index === 3 ? left : right;
        const localY = index < 2 ? top : bottom;
        const denominator = (homography[6] * localX)
            + (homography[7] * localY)
            + homography[8];
        if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) {
            return null;
        }
        const currentSign = Math.sign(denominator);
        if (denominatorSign !== 0 && currentSign !== denominatorSign) {
            return null;
        }
        denominatorSign = currentSign;
        const screenX = ((homography[0] * localX)
            + (homography[1] * localY)
            + homography[2]) / denominator;
        const screenY = ((homography[3] * localX)
            + (homography[4] * localY)
            + homography[5]) / denominator;
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
            return null;
        }
        minX = Math.min(minX, screenX);
        minY = Math.min(minY, screenY);
        maxX = Math.max(maxX, screenX);
        maxY = Math.max(maxY, screenY);
    }
    const x = Math.max(0, Math.floor(minX));
    const y = Math.max(0, Math.floor(minY));
    const rightEdge = Math.min(targetWidth, Math.ceil(maxX));
    const bottomEdge = Math.min(targetHeight, Math.ceil(maxY));
    const width = rightEdge - x;
    const height = bottomEdge - y;
    if (width <= 0 || height <= 0) {
        return null;
    }
    return Object.freeze({ x, y, width, height });
}

function copyProjectedQuad(source, target) {
    if ((Array.isArray(source) || ArrayBuffer.isView(source)) && source.length === 8
        && Number.isFinite(source[0])) {
        for (let index = 0; index < 8; index++) {
            if (!Number.isFinite(source[index])) {
                return false;
            }
            target[index] = source[index];
        }
        return true;
    }
    if (!Array.isArray(source) || source.length !== 4) {
        return false;
    }
    for (let index = 0; index < 4; index++) {
        const point = source[index];
        const pointX = Array.isArray(point) || ArrayBuffer.isView(point) ? point[0] : point?.x;
        const pointY = Array.isArray(point) || ArrayBuffer.isView(point) ? point[1] : point?.y;
        if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) {
            return false;
        }
        target[index * 2] = pointX;
        target[(index * 2) + 1] = pointY;
    }
    return true;
}

function isUsableQuad(quad) {
    let positive = false;
    let negative = false;
    let areaTwice = 0;
    for (let index = 0; index < 4; index++) {
        const nextIndex = (index + 1) % 4;
        const afterIndex = (index + 2) % 4;
        const x0 = quad[index * 2];
        const y0 = quad[(index * 2) + 1];
        const x1 = quad[nextIndex * 2];
        const y1 = quad[(nextIndex * 2) + 1];
        const x2 = quad[afterIndex * 2];
        const y2 = quad[(afterIndex * 2) + 1];
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) {
            return false;
        }
        areaTwice += (x0 * y1) - (y0 * x1);
        const cross = ((x1 - x0) * (y2 - y1)) - ((y1 - y0) * (x2 - x1));
        positive ||= cross > 1e-8;
        negative ||= cross < -1e-8;
        if (positive && negative) {
            return false;
        }
    }
    return Math.abs(areaTwice) > 1e-6;
}

function isWritableQuadTarget(value) {
    return (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length >= 8;
}

function isWritableMatrix3Target(value) {
    return (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length >= 9;
}

function isMatrix4(value) {
    if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 16) {
        return false;
    }
    for (let index = 0; index < 16; index++) {
        if (!Number.isFinite(value[index])) {
            return false;
        }
    }
    return true;
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}
