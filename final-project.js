import {tiny, defs} from './examples/common.js';
import {Underwater_Camera, Seafloor, Coral_Collection, Underwater_Shader, Bubble_System, Plankton_System} from './underwater/index.js';

// Pull these names into this module's scope for convenience:
const {vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component} = tiny;

export class Final_Project extends Component {
    init() {
        // Environment
        this.seafloor = new Seafloor();
        this.bubbles = new Bubble_System(this.seafloor);
        this.plankton = new Plankton_System();
        this.corals = new Coral_Collection();

        // Shared obstacle list for P2 (boid avoidance)
        this.obstacles = this.corals.get_obstacles(this.seafloor);
    }

    render_animation(caller) {
        if (!caller.controls) {
            this.animated_children.push(
                caller.controls = new Underwater_Camera({uniforms: this.uniforms})
            );
            caller.controls.add_mouse_controls(caller.canvas);

            // Optional: keep the camera above the seafloor (1m clearance)
            caller.controls.seafloor_height_fn = (x, z) => this.seafloor.get_height(x, z);
        }
        this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, caller.width / caller.height, 1, 200);

        // Daytime lighting: 1–2 directional lights (w=0) + ambient via materials
        const sun_dir_1 = vec4(-0.2, 1.0, -0.1, 0);
        const sun_dir_2 = vec4(0.3, 0.8, 0.2, 0);
        this.uniforms.lights = [
            defs.Phong_Shader.light_source(sun_dir_1, color(0.95, 0.98, 1.00, 1), 1e8),
            defs.Phong_Shader.light_source(sun_dir_2, color(0.35, 0.55, 0.85, 1), 1e8),
        ];

        // Draw environment
        this.seafloor.draw(caller, this.uniforms);

        // Particles
        const dt = this.uniforms.animation_delta_time / 1000;
        this.bubbles.update(dt);
        this.bubbles.draw(caller, this.uniforms);
        this.plankton.update(dt);
        this.plankton.draw(caller, this.uniforms);

        // Placeholder shapes
        this.shapes.sphere.draw(caller, this.uniforms, Mat4.translation(-2, 3, 0), this.materials.plastic);
        this.shapes.cube.draw(caller, this.uniforms, Mat4.translation(2, 3, 0), this.materials.plastic);
        this.corals.draw(caller, this.uniforms, this.seafloor);
    }
}