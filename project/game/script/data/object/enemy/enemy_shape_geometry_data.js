const FULL_CIRCLE_RADIANS = Math.PI * 2;
const UPRIGHT_POLYGON_ANGLE_OFFSET = -Math.PI / 2;

export const ENEMY_SHAPE_PATH_KIND = Object.freeze({
    POLYGON: 'polygon',
    RECT: 'rect',
    COMPOUND: 'compound'
});

/** legacy 적 SVG가 정사각형 atlas cell 안에서 차지하는 비율입니다. */
export const ENEMY_SVG_DRAW_SIZE_RATIO = 0.90;

/** 적 타입별 legacy 렌더 너비/높이 종횡비입니다. */
export const ENEMY_ASPECT_RATIO = Object.freeze({
    square: 1.0,
    triangle: 1.0,
    arrow: 0.96,
    hexa: 1.0,
    penta: 1.0,
    rhom: 0.81,
    octa: 1.0,
    gen: 1.05
});

/** 적 타입별 legacy 렌더 높이 배율입니다. */
export const ENEMY_HEIGHT_SCALE = Object.freeze({
    square: 1.0,
    triangle: 1.0,
    arrow: 0.9,
    hexa: 1.0,
    penta: 1.0,
    rhom: 1.0,
    octa: 1.0,
    gen: 1.0
});

const freezePoint = (x, y) => Object.freeze({ x, y });

const createPolygonPath = (points) => Object.freeze({
    kind: ENEMY_SHAPE_PATH_KIND.POLYGON,
    points: Object.freeze(points.map(({ x, y }) => freezePoint(x, y)))
});

const createRegularPolygonPath = (
    sides,
    radius,
    rotation = UPRIGHT_POLYGON_ANGLE_OFFSET
) => {
    const points = [];
    const step = FULL_CIRCLE_RADIANS / sides;
    for (let index = 0; index < sides; index++) {
        const angle = rotation + (index * step);
        points.push(freezePoint(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
        ));
    }
    return createPolygonPath(points);
};

const createRectPath = (x, y, width, height) => Object.freeze({
    kind: ENEMY_SHAPE_PATH_KIND.RECT,
    x,
    y,
    width,
    height
});

const createCompoundPath = (paths, fillRule = 'nonzero') => Object.freeze({
    kind: ENEMY_SHAPE_PATH_KIND.COMPOUND,
    paths: Object.freeze(paths),
    fillRule
});

const createShapeGeometry = (paths) => Object.freeze({
    paths: Object.freeze(paths)
});

/**
 * legacy Canvas/WebGL atlas와 GPU analytic mask가 함께 사용하는 원시 path 권위입니다.
 * 좌표계는 SVG/Canvas와 동일하게 +X가 오른쪽, +Y가 아래쪽입니다.
 */
export const ENEMY_SHAPE_GEOMETRY = Object.freeze({
    square: createShapeGeometry([
        createRectPath(-0.42, -0.42, 0.84, 0.84)
    ]),
    triangle: createShapeGeometry([
        createPolygonPath([
            freezePoint(0.0, -0.5333),
            freezePoint(0.462, 0.2667),
            freezePoint(-0.462, 0.2667)
        ])
    ]),
    arrow: createShapeGeometry([
        createPolygonPath([
            freezePoint(0.0, -0.5767),
            freezePoint(0.46, 0.3733),
            freezePoint(0.0, 0.2033),
            freezePoint(-0.46, 0.3733)
        ])
    ]),
    hexa: createShapeGeometry([
        createRegularPolygonPath(6, 0.47)
    ]),
    penta: createShapeGeometry([
        createRegularPolygonPath(5, 0.48)
    ]),
    rhom: createShapeGeometry([
        createPolygonPath([
            freezePoint(0.0, -0.50),
            freezePoint(0.34, 0.0),
            freezePoint(0.0, 0.50),
            freezePoint(-0.34, 0.0)
        ])
    ]),
    octa: createShapeGeometry([
        createRegularPolygonPath(8, 0.47, Math.PI / 8)
    ]),
    gen: createShapeGeometry([
        createCompoundPath([
            createRectPath(-0.30, -0.30, 0.60, 0.60),
            createRectPath(-0.22, -0.22, 0.44, 0.44)
        ], 'evenodd'),
        createRectPath(-0.44, -0.44, 0.10, 0.10),
        createRectPath(0.34, -0.44, 0.10, 0.10),
        createRectPath(0.34, 0.34, 0.10, 0.10),
        createRectPath(-0.44, 0.34, 0.10, 0.10)
    ])
});

const squarePath = ENEMY_SHAPE_GEOMETRY.square.paths[0];
const squareMaximumX = Math.max(
    Math.abs(squarePath.x),
    Math.abs(squarePath.x + squarePath.width)
);
const squareMaximumY = Math.max(
    Math.abs(squarePath.y),
    Math.abs(squarePath.y + squarePath.height)
);

/** 기존 1타일 square 적의 원형 collider 반경입니다. */
export const LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES = Math.hypot(
    squareMaximumX,
    squareMaximumY
);

const normalizePoint = (shapeType, point, directional = false) => {
    const heightScale = ENEMY_HEIGHT_SCALE[shapeType] ?? 1;
    const aspectRatio = ENEMY_ASPECT_RATIO[shapeType] ?? 1;
    const scaleY = (ENEMY_SVG_DRAW_SIZE_RATIO * heightScale)
        / LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES;
    const scaleX = (ENEMY_SVG_DRAW_SIZE_RATIO * aspectRatio)
        / LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES;
    return freezePoint(
        point.x * scaleX,
        point.y * scaleY * (directional ? -1 : 1)
    );
};

const normalizePolygon = (shapeType, path, directional = false) => Object.freeze(
    path.points.map((point) => normalizePoint(shapeType, point, directional))
);

const normalizeRect = (shapeType, path) => {
    const minimum = normalizePoint(shapeType, freezePoint(path.x, path.y));
    const maximum = normalizePoint(
        shapeType,
        freezePoint(path.x + path.width, path.y + path.height)
    );
    return Object.freeze({
        center: freezePoint(
            (minimum.x + maximum.x) * 0.5,
            (minimum.y + maximum.y) * 0.5
        ),
        halfSize: freezePoint(
            (maximum.x - minimum.x) * 0.5,
            (maximum.y - minimum.y) * 0.5
        )
    });
};

const generatorPaths = ENEMY_SHAPE_GEOMETRY.gen.paths;
const generatorRingPaths = generatorPaths[0].paths;

/**
 * body radius를 legacy square collider 반경의 배수로 둘 때 같은 배율의 legacy
 * SVG 실루엣을 만드는 정규화 geometry입니다. 방향형 도형은 +Y가 전진 방향입니다.
 */
export const ENEMY_NORMALIZED_RENDER_GEOMETRY = Object.freeze({
    square: Object.freeze({
        box: normalizeRect('square', ENEMY_SHAPE_GEOMETRY.square.paths[0])
    }),
    triangle: Object.freeze({
        points: normalizePolygon('triangle', ENEMY_SHAPE_GEOMETRY.triangle.paths[0], true)
    }),
    arrow: Object.freeze({
        points: normalizePolygon('arrow', ENEMY_SHAPE_GEOMETRY.arrow.paths[0], true)
    }),
    penta: Object.freeze({
        points: normalizePolygon('penta', ENEMY_SHAPE_GEOMETRY.penta.paths[0])
    }),
    hexa: Object.freeze({
        points: normalizePolygon('hexa', ENEMY_SHAPE_GEOMETRY.hexa.paths[0])
    }),
    gen: Object.freeze({
        outerBox: normalizeRect('gen', generatorRingPaths[0]),
        innerBox: normalizeRect('gen', generatorRingPaths[1]),
        terminalBoxes: Object.freeze(
            generatorPaths.slice(1).map((path) => normalizeRect('gen', path))
        )
    })
});
