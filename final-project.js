import {tiny, defs} from './examples/common.js';
import {Underwater_Camera, Seafloor, Coral_Collection, Underwater_Shader} from './underwater/index.js';

// Pull these names into this module's scope for convenience:
const {vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component} = tiny;

export class Final_Project extends Component {
    init() {
        this.shapes = {
            sphere: new defs.Subdivision_Sphere(4),
            cube: new defs.Cube(),
        };

        this.materials = {
            plastic: {shader: new defs.Phong_Shader(), ambient: .2, diffusivity: 1, specularity: .5, color: color(.9, .5, .9, 1)},
        };

        this.seafloor = new Seafloor();
    }

    render_animation(caller) {
        if (!caller.controls) {
            this.animated_children.push(
                caller.controls = new Underwater_Camera({uniforms: this.uniforms})
            );
            caller.controls.add_mouse_controls(caller.canvas);
        }
        this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, caller.width / caller.height, 1, 200);

        const t = this.t = this.uniforms.animation_time / 1000;
        const light_position = vec4(0, 30, 0, 1);
        this.uniforms.lights = [defs.Phong_Shader.light_source(light_position, color(1, 1, 1, 1), 100000)];

        this.seafloor.draw(caller, this.uniforms);

        // Placeholder shapes
        this.shapes.sphere.draw(caller, this.uniforms, Mat4.translation(-2, 3, 0), this.materials.plastic);
        this.shapes.cube.draw(caller, this.uniforms, Mat4.translation(2, 3, 0), this.materials.plastic);
    }
}
