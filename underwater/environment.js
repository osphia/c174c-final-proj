import {vec3, vec4, color, Mat4, Shape, Shader, defs} from './utils.js';

export class Seafloor {
    constructor() {
        this.size = 100;
        this.grid_rows = 60;
        this.grid_cols = 60;

        this.height_at = (x, z) => {
            return 0.8 * Math.sin(0.3 * x) * Math.cos(0.3 * z)
                 + 0.4 * Math.sin(0.7 * x + 0.5 * z)
                 + 0.2 * Math.cos(1.1 * x) * Math.sin(0.9 * z);
        };

        const size = this.size;
        const height_at = this.height_at;

        const row_operation = (s, p) => {
            const z = (s - 0.5) * 2 * size;
            const x = -size;
            const y = height_at(x, z);
            return vec3(x, y, z);
        };

        const column_operation = (t, p, s) => {
            const x = (t - 0.5) * 2 * size;
            const z = (s - 0.5) * 2 * size;
            const y = height_at(x, z);
            return vec3(x, y, z);
        };

        this.shape = new defs.Grid_Patch(
            this.grid_rows, this.grid_cols,
            row_operation, column_operation,
            [[0, this.grid_rows], [0, this.grid_cols]]
        );

        this.material = {
            shader: new defs.Phong_Shader(),
            ambient: 0.3,
            diffusivity: 0.8,
            specularity: 0.1,
            smoothness: 10,
            color: color(0.76, 0.70, 0.50, 1),
        };
    }

    draw(caller, uniforms) {
        this.shape.draw(caller, uniforms, Mat4.identity(), this.material);
    }

    get_height(x, z) {
        return this.height_at(x, z);
    }
}
