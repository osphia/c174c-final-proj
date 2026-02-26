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
    }

    render_animation(caller) {
        // Setup -- This part sets up the scene's overall camera matrix, projection matrix, and lights:
        if (!caller.controls) {
            this.animated_children.push(caller.controls = new defs.Movement_Controls({uniforms: this.uniforms}));
            caller.controls.add_mouse_controls(caller.canvas);

            // Define the global camera and projection matrices, which are stored in shared_uniforms for all shaders:
            Shader.assign_camera(Mat4.translation(0, 0, -10), this.uniforms);
        }
        this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, caller.width / caller.height, 1, 100);

        // *** Lights: *** Values of vector or point lights.
        const t = this.t = this.uniforms.animation_time / 1000;
        const light_position = vec4(0, 5, 5, 1);
        this.uniforms.lights = [defs.Phong_Shader.light_source(light_position, color(1, 1, 1, 1), 1000)];

        // Draw placeholder shapes to verify imports work
        this.shapes.sphere.draw(caller, this.uniforms, Mat4.translation(-2, 0, 0), this.materials.plastic);
        this.shapes.cube.draw(caller, this.uniforms, Mat4.translation(2, 0, 0), this.materials.plastic);
    }
}
