export class Vector2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    add(v) {
        return new Vector2(this.x + v.x, this.y + v.y);
    }

    sub(v) {
        return new Vector2(this.x - v.x, this.y - v.y);
    }

    mul(num) {
        return new Vector2(this.x * num, this.y * num);
    }

    div(num) {
        if (num == 0) {
            return new Vector2(0, 0);
        } else {
            return new Vector2(this.x / num, this.y / num);
        }
    }

    reduce(v) {
        return new Vector2(Math.max(this.x - v.x, 0), Math.max(this.y - v.y, 0));
    }

    normalize() {
        let len = Math.sqrt(this.x * this.x + this.y * this.y);
        return new Vector2(this.x / len, this.y / len);
    }

    getLength() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    getLengthSquare() {
        return this.x * this.x + this.y * this.y;
    }

    addDeg(degree) {
        let deg = MathHelper.vecToDeg(this);
        deg += degree;
        return MathHelper.degToVec(deg);
    }

    clone() {
        return new Vector2(this.x, this.y);
    }
}