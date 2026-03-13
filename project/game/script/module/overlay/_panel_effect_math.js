/**
 * 4x4 행렬 곱셈을 수행합니다.
 * @param {number[]} left - 왼쪽 행렬입니다.
 * @param {number[]} right - 오른쪽 행렬입니다.
 * @returns {number[]} 곱셈 결과 행렬입니다.
 */
export function multiplyMat4(left, right) {
    const result = new Array(16).fill(0);

    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let index = 0; index < 4; index++) {
                sum += left[(index * 4) + row] * right[(column * 4) + index];
            }
            result[(column * 4) + row] = sum;
        }
    }

    return result;
}

/**
 * X축 회전 행렬을 생성합니다.
 * @param {number} angle - 회전 각도(라디안)입니다.
 * @returns {number[]} 생성된 행렬입니다.
 */
export function createRotationXMatrix(angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    return [
        1, 0, 0, 0,
        0, cosine, sine, 0,
        0, -sine, cosine, 0,
        0, 0, 0, 1
    ];
}

/**
 * Y축 회전 행렬을 생성합니다.
 * @param {number} angle - 회전 각도(라디안)입니다.
 * @returns {number[]} 생성된 행렬입니다.
 */
export function createRotationYMatrix(angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    return [
        cosine, 0, -sine, 0,
        0, 1, 0, 0,
        sine, 0, cosine, 0,
        0, 0, 0, 1
    ];
}

/**
 * rotateX/rotateY를 결합한 tilt 행렬을 생성합니다.
 * @param {number} rotateX - X축 회전 각도(라디안)입니다.
 * @param {number} rotateY - Y축 회전 각도(라디안)입니다.
 * @returns {number[]} 생성된 행렬입니다.
 */
export function createTiltMatrix(rotateX, rotateY) {
    return multiplyMat4(createRotationYMatrix(rotateY), createRotationXMatrix(rotateX));
}

/**
 * 현재 값에서 목표 값으로 선형 보간합니다.
 * @param {number} current - 현재 값입니다.
 * @param {number} target - 목표 값입니다.
 * @param {number} factor - 보간 계수입니다.
 * @returns {number} 보간 결과입니다.
 */
export function lerpNumber(current, target, factor) {
    return current + ((target - current) * factor);
}

/**
 * 델타 시간 기준의 지수형 보간 계수를 계산합니다.
 * @param {number} smoothing - 0~1 범위의 기본 스무딩 값입니다.
 * @param {number} deltaSeconds - 현재 프레임 델타(초)입니다.
 * @returns {number} 보간 계수입니다.
 */
export function getDeltaLerpFactor(smoothing, deltaSeconds) {
    const clampedSmoothing = Math.max(0, Math.min(0.999, smoothing));
    const safeDelta = Math.max(0, deltaSeconds || 0);
    const frames = safeDelta * 60;
    return 1 - Math.pow(1 - clampedSmoothing, frames);
}

/**
 * 로컬 패널 좌표를 현재 tilt 행렬과 원근값으로 투영합니다.
 * @param {number} localX - 패널 중심 기준 로컬 X입니다.
 * @param {number} localY - 패널 중심 기준 로컬 Y입니다.
 * @param {number[]} transformMatrix - 적용할 4x4 행렬입니다.
 * @param {number} perspective - 원근 거리입니다.
 * @returns {{x:number, y:number, z:number}} 투영 결과입니다.
 */
export function projectPanelLocalPoint(localX, localY, transformMatrix, perspective) {
    const transformedX = (transformMatrix[0] * localX) + (transformMatrix[4] * localY);
    const transformedY = (transformMatrix[1] * localX) + (transformMatrix[5] * localY);
    const transformedZ = (transformMatrix[2] * localX) + (transformMatrix[6] * localY);
    const safePerspective = Math.max(1, perspective || 1);
    const perspectiveScale = safePerspective / Math.max(1, safePerspective - transformedZ);

    return {
        x: transformedX * perspectiveScale,
        y: transformedY * perspectiveScale,
        z: transformedZ
    };
}

/**
 * 패널 사각형의 투영된 4개 꼭짓점을 계산합니다.
 * @param {{x:number, y:number, w:number, h:number}} panelRect - 기준 패널 rect입니다.
 * @param {number[]} transformMatrix - 적용할 4x4 행렬입니다.
 * @param {number} perspective - 원근 거리입니다.
 * @returns {{x:number, y:number}[]} 좌상단부터 시계 방향 꼭짓점 배열입니다.
 */
export function projectPanelQuad(panelRect, transformMatrix, perspective) {
    const centerX = panelRect.x + (panelRect.w * 0.5);
    const centerY = panelRect.y + (panelRect.h * 0.5);
    const corners = [
        { x: -panelRect.w * 0.5, y: -panelRect.h * 0.5 },
        { x: panelRect.w * 0.5, y: -panelRect.h * 0.5 },
        { x: panelRect.w * 0.5, y: panelRect.h * 0.5 },
        { x: -panelRect.w * 0.5, y: panelRect.h * 0.5 }
    ];

    return corners.map((corner) => {
        const projected = projectPanelLocalPoint(corner.x, corner.y, transformMatrix, perspective);
        return {
            x: centerX + projected.x,
            y: centerY + projected.y
        };
    });
}

/**
 * 패널 내부 점인지 판별합니다.
 * @param {number} x - 검사할 X 좌표입니다.
 * @param {number} y - 검사할 Y 좌표입니다.
 * @param {{x:number, y:number}[]} quad - 좌상단부터 시계 방향 꼭짓점입니다.
 * @returns {boolean} 포함 여부입니다.
 */
export function isPointInsideQuad(x, y, quad) {
    if (!Array.isArray(quad) || quad.length !== 4) {
        return false;
    }

    let hasPositive = false;
    let hasNegative = false;
    for (let index = 0; index < quad.length; index++) {
        const current = quad[index];
        const next = quad[(index + 1) % quad.length];
        const cross = ((next.x - current.x) * (y - current.y)) - ((next.y - current.y) * (x - current.x));

        if (cross > 0) {
            hasPositive = true;
        } else if (cross < 0) {
            hasNegative = true;
        }

        if (hasPositive && hasNegative) {
            return false;
        }
    }

    return true;
}

/**
 * 둥근 사각형 내부 점인지 판별합니다.
 * @param {number} x - 로컬 X 좌표입니다.
 * @param {number} y - 로컬 Y 좌표입니다.
 * @param {number} width - 패널 너비입니다.
 * @param {number} height - 패널 높이입니다.
 * @param {number} radius - 둥근 모서리 반경입니다.
 * @returns {boolean} 포함 여부입니다.
 */
export function isPointInsideRoundedRect(x, y, width, height, radius) {
    if (x < 0 || y < 0 || x > width || y > height) {
        return false;
    }

    const clampedRadius = Math.max(0, Math.min(radius, Math.min(width, height) * 0.5));
    if (clampedRadius <= 0) {
        return true;
    }

    const left = clampedRadius;
    const right = width - clampedRadius;
    const top = clampedRadius;
    const bottom = height - clampedRadius;

    if ((x >= left && x <= right) || (y >= top && y <= bottom)) {
        return true;
    }

    const cornerX = x < left ? left : right;
    const cornerY = y < top ? top : bottom;
    const dx = x - cornerX;
    const dy = y - cornerY;
    return (dx * dx) + (dy * dy) <= clampedRadius * clampedRadius;
}

/**
 * 3x3 행렬을 역행렬로 변환합니다.
 * @param {number[]} matrix - 역행렬을 계산할 3x3 행렬입니다.
 * @returns {number[]|null} 계산된 역행렬입니다.
 */
export function invertMat3(matrix) {
    const determinant =
        (matrix[0] * ((matrix[4] * matrix[8]) - (matrix[5] * matrix[7])))
        - (matrix[1] * ((matrix[3] * matrix[8]) - (matrix[5] * matrix[6])))
        + (matrix[2] * ((matrix[3] * matrix[7]) - (matrix[4] * matrix[6])));

    if (Math.abs(determinant) < 1e-8) {
        return null;
    }

    const inverseDeterminant = 1 / determinant;

    return [
        ((matrix[4] * matrix[8]) - (matrix[5] * matrix[7])) * inverseDeterminant,
        ((matrix[2] * matrix[7]) - (matrix[1] * matrix[8])) * inverseDeterminant,
        ((matrix[1] * matrix[5]) - (matrix[2] * matrix[4])) * inverseDeterminant,
        ((matrix[5] * matrix[6]) - (matrix[3] * matrix[8])) * inverseDeterminant,
        ((matrix[0] * matrix[8]) - (matrix[2] * matrix[6])) * inverseDeterminant,
        ((matrix[2] * matrix[3]) - (matrix[0] * matrix[5])) * inverseDeterminant,
        ((matrix[3] * matrix[7]) - (matrix[4] * matrix[6])) * inverseDeterminant,
        ((matrix[1] * matrix[6]) - (matrix[0] * matrix[7])) * inverseDeterminant,
        ((matrix[0] * matrix[4]) - (matrix[1] * matrix[3])) * inverseDeterminant
    ];
}

/**
 * 소스 사각형에서 목적지 사각형으로의 호모그래피를 계산합니다.
 * @param {number} width - 소스 사각형 너비입니다.
 * @param {number} height - 소스 사각형 높이입니다.
 * @param {{x:number, y:number}[]} quad - 목적지 꼭짓점 배열입니다.
 * @returns {number[]|null} 계산된 3x3 호모그래피 행렬입니다.
 */
export function createRectToQuadHomography(width, height, quad) {
    if (!Array.isArray(quad) || quad.length !== 4) {
        return null;
    }

    const sourcePoints = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height }
    ];

    const matrix = [];
    const values = [];

    for (let index = 0; index < 4; index++) {
        const source = sourcePoints[index];
        const destination = quad[index];

        matrix.push([source.x, source.y, 1, 0, 0, 0, -destination.x * source.x, -destination.x * source.y]);
        values.push(destination.x);
        matrix.push([0, 0, 0, source.x, source.y, 1, -destination.y * source.x, -destination.y * source.y]);
        values.push(destination.y);
    }

    const solved = solveLinearSystem(matrix, values);
    if (!solved) {
        return null;
    }

    return [
        solved[0], solved[1], solved[2],
        solved[3], solved[4], solved[5],
        solved[6], solved[7], 1
    ];
}

/**
 * 호모그래피 역행렬로 화면 좌표를 패널 로컬 좌표로 변환합니다.
 * @param {number} x - 화면 X 좌표입니다.
 * @param {number} y - 화면 Y 좌표입니다.
 * @param {number[]|null} inverseHomography - 패널 역호모그래피입니다.
 * @returns {{x:number, y:number}|null} 패널 로컬 좌표입니다.
 */
export function mapScreenPointToPanelLocal(x, y, inverseHomography) {
    if (!inverseHomography) {
        return null;
    }

    const denominator = (inverseHomography[6] * x) + (inverseHomography[7] * y) + inverseHomography[8];
    if (Math.abs(denominator) < 1e-8) {
        return null;
    }

    return {
        x: ((inverseHomography[0] * x) + (inverseHomography[1] * y) + inverseHomography[2]) / denominator,
        y: ((inverseHomography[3] * x) + (inverseHomography[4] * y) + inverseHomography[5]) / denominator
    };
}

/**
 * 선형 방정식 시스템을 가우스 소거법으로 풉니다.
 * @param {number[][]} matrix - 계수 행렬입니다.
 * @param {number[]} values - 상수 벡터입니다.
 * @returns {number[]|null} 해 벡터입니다.
 */
function solveLinearSystem(matrix, values) {
    const size = values.length;
    const augmented = matrix.map((row, index) => [...row, values[index]]);

    for (let pivot = 0; pivot < size; pivot++) {
        let maxRow = pivot;
        for (let row = pivot + 1; row < size; row++) {
            if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
                maxRow = row;
            }
        }

        if (Math.abs(augmented[maxRow][pivot]) < 1e-8) {
            return null;
        }

        if (maxRow !== pivot) {
            const temp = augmented[pivot];
            augmented[pivot] = augmented[maxRow];
            augmented[maxRow] = temp;
        }

        const pivotValue = augmented[pivot][pivot];
        for (let column = pivot; column <= size; column++) {
            augmented[pivot][column] /= pivotValue;
        }

        for (let row = 0; row < size; row++) {
            if (row === pivot) {
                continue;
            }

            const factor = augmented[row][pivot];
            if (factor === 0) {
                continue;
            }

            for (let column = pivot; column <= size; column++) {
                augmented[row][column] -= factor * augmented[pivot][column];
            }
        }
    }

    return augmented.map((row) => row[size]);
}
