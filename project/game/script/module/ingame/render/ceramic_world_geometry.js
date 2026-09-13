import { CERAMIC_WORLD_VISUAL as theme, CERAMIC_MATERIAL_COLORS as colors } from 'data/theme/ceramic_world_visual_data.js';
/** Setup-only geometry from the real TileMap. Nine floats per vertex. */
export function buildCeramicGeometry(tileMap) {
    const vertices = [];
    const tri = (a, b, c, normal, color) => {
        for (const p of [a, b, c]) vertices.push(...p, ...normal, ...color);
    };
    const quad = (a, b, c, d, normal, color) => {
        tri(a, b, c, normal, color); tri(a, c, d, normal, color);
    };
    function box(x, y, z, w, h, depth, color, bevel = 0) {
        const x0 = x-w/2, x1=x+w/2, y0=y-h/2, y1=y+h/2;
        const z0=z-depth, zb=z-bevel;
        quad([x0+bevel,y0+bevel,z],[x1-bevel,y0+bevel,z],[x1-bevel,y1-bevel,z],[x0+bevel,y1-bevel,z],[0,0,1],color);
        const bottom=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]];
        const edge=[[x0,y0,zb],[x1,y0,zb],[x1,y1,zb],[x0,y1,zb]];
        const top=[[x0+bevel,y0+bevel,z],[x1-bevel,y0+bevel,z],[x1-bevel,y1-bevel,z],[x0+bevel,y1-bevel,z]];
        const normals=[[0,-1,0],[1,0,0],[0,1,0],[-1,0,0]];
        for(let i=0;i<4;i++) {
            const j=(i+1)%4;
            quad(bottom[i],bottom[j],edge[j],edge[i],normals[i],color);
            if(bevel>0) quad(edge[i],edge[j],top[j],top[i],normals[i].map((n,k)=>k===2?Math.SQRT1_2:n*Math.SQRT1_2),color);
        }
    }
    const grid=tileMap.getNavigationGrid();
    for(let row=0;row<grid.rows;row++) for(let col=0;col<grid.cols;col++) {
        if(grid.blocked[row*grid.cols+col]) continue;
        const x=(col+0.5)*grid.cellSize, y=(row+0.5)*grid.cellSize;
        const tone=((row*17+col*31)%9)/180;
        box(x,y,-0.02,grid.cellSize*(1-theme.tileGap),grid.cellSize*(1-theme.tileGap),theme.tileDepth,theme.tileColor.map(v=>v+tone),theme.bevel);
        // Continuous dark trim beneath the ceramic tiles.
        box(x,y,-0.72,grid.cellSize,grid.cellSize,0.26,theme.trimColor);
    }
    const core=tileMap.getCorePosition();
    box(core.x,core.y,0.25,1.65,1.65,0.30,colors.coreBase,0.12);
    box(core.x,core.y,0.50,1.15,1.15,0.30,colors.corePedestal,0.10);
    box(core.x,core.y,1.95,0.82,0.82,1.5,colors.coreCrystal,0.17);
    box(core.x,core.y,1.05,1.1,1.1,0.15,colors.coreBand,0.04);
    for(const route of tileMap.getSpawnRoutes()) {
        const gate=route.entryPoint;
        const vertical=Math.abs(route.waypoints?.[1]?.y-gate.y)>Math.abs(route.waypoints?.[1]?.x-gate.x);
        const halfWidth=Math.max(1.3,((tileMap.pathWidthTiles??3)*grid.cellSize-0.5)/2);
        for(const side of [-1,1]) {
            const x=gate.x+(vertical?side*halfWidth:0),y=gate.y+(vertical?0:side*halfWidth);
            box(x,y,2.2,vertical?0.5:0.8,vertical?0.8:0.5,2.2,colors.gatePillar,0.09);
            box(x-(vertical?0:0.42),y-(vertical?0.42:0),1.8,vertical?0.23:0.04,vertical?0.04:0.23,1.6,colors.gateLamp);
        }
        box(gate.x,gate.y,2.55,vertical?halfWidth*2+0.5:0.8,vertical?0.8:halfWidth*2+0.5,0.45,colors.gateLintel,0.10);
    }
    return new Float32Array(vertices);
}

