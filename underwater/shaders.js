import {Shader, Mat4, color, defs, Matrix} from './utils.js';

export class Underwater_Shader extends defs.Phong_Shader {
    constructor(num_lights = 2) {
        super(num_lights);
    }
}
