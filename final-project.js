import {tiny, defs} from './examples/common.js';
import {Underwater_Camera, Seafloor, Coral_Collection, Underwater_Shader,
        Bubble_System, Plankton_System,
        Jellyfish_School, Sea_Turtle, Manta_Ray,
        Fish_Manager} from './underwater/index.js';

// Pull these names into this module's scope for convenience:
const {vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component} = tiny;

export class Final_Project extends Component {
    init() {
        // Environment
        this.seafloor = new Seafloor();
        this.bubbles  = new Bubble_System();
        this.plankton = new Plankton_System();
        this.corals   = new Coral_Collection();

        // Shared obstacle list for P2 (boid avoidance)
        this.obstacles = this.corals.get_obstacles(this.seafloor);

        // P2 — Fish schools (boids + articulated models)
        this.fish_manager = new Fish_Manager(this.obstacles);

        // P3 — Creatures & Curves
        this.jellyfish = new Jellyfish_School();
        this.turtle    = new Sea_Turtle();
        this.manta     = new Manta_Ray();
    }

    // Ray-sphere intersection: returns distance t, or Infinity if no hit
    _ray_sphere(origin, dir, center, radius) {
        const ocx = origin[0] - center[0];
        const ocy = origin[1] - center[1];
        const ocz = origin[2] - center[2];
        const a = dir[0]*dir[0] + dir[1]*dir[1] + dir[2]*dir[2];
        const b = 2 * (ocx*dir[0] + ocy*dir[1] + ocz*dir[2]);
        const c = ocx*ocx + ocy*ocy + ocz*ocz - radius*radius;
        const disc = b*b - 4*a*c;
        if (disc < 0) return Infinity;
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        return t > 0 ? t : Infinity;
    }

    _setup_click_follow(canvas, controls) {
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const ndcY = 1 - ((e.clientY - rect.top) / rect.height) * 2;

            const inv_proj = Mat4.inverse(this.uniforms.projection_transform);
            const clip_near = vec4(ndcX, ndcY, -1, 1);
            const view_pt = inv_proj.times(clip_near);
            const w = view_pt[3];
            const ray_view = vec3(view_pt[0]/w, view_pt[1]/w, view_pt[2]/w);
            const len = Math.sqrt(ray_view[0]**2 + ray_view[1]**2 + ray_view[2]**2);
            const rv = vec3(ray_view[0]/len, ray_view[1]/len, ray_view[2]/len);

            // Transform ray to world space using camera_transform (eye-to-world)
            const cam2world = this.uniforms.camera_transform;
            const rd4 = cam2world.times(vec4(rv[0], rv[1], rv[2], 0));
            const ray_dir = vec3(rd4[0], rd4[1], rd4[2]);
            const ro4 = cam2world.times(vec4(0, 0, 0, 1));
            const ray_origin = vec3(ro4[0], ro4[1], ro4[2]);

            const all_fish = this.fish_manager.get_all_fish();
            let best_t = Infinity;
            let best_fish = null;
            for (const f of all_fish) {
                const hit_radius = f.size * 1.5;
                const t = this._ray_sphere(ray_origin, ray_dir, f.position, hit_radius);
                if (t < best_t) {
                    best_t = t;
                    best_fish = f;
                }
            }

            controls.follow_target = best_fish;
        });
    }

    render_animation(caller) {
        if (!caller.controls) {
            this.animated_children.push(
                caller.controls = new Underwater_Camera({uniforms: this.uniforms})
            );
            caller.controls.add_mouse_controls(caller.canvas);
            caller.controls.seafloor_height_fn = (x, z) => this.seafloor.get_height(x, z);
            this._setup_click_follow(caller.canvas, caller.controls);
        }
        this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, caller.width / caller.height, 1, 200);

        // Daytime lighting: 1–2 directional lights (w=0) + ambient via materials
        const sun_dir_1 = vec4(-0.2, 1.0, -0.1, 0);
        const sun_dir_2 = vec4( 0.3, 0.8,  0.2, 0);
        this.uniforms.lights = [
            defs.Phong_Shader.light_source(sun_dir_1, color(0.95, 0.98, 1.00, 1), 1e8),
            defs.Phong_Shader.light_source(sun_dir_2, color(0.35, 0.55, 0.85, 1), 1e8),
        ];

        // Time values
        const dt = this.uniforms.animation_delta_time / 1000;
        const t  = this.uniforms.animation_time       / 1000;

        // Environment
        this.seafloor.draw(caller, this.uniforms);
        this.corals.draw(caller, this.uniforms, this.seafloor);

        // Particles — bubbles trail behind fish
        const fish_positions = this.fish_manager.get_all_fish().map(f => f.position);
        this.bubbles.update(dt, fish_positions);
        this.bubbles.draw(caller, this.uniforms);
        this.plankton.update(dt);
        this.plankton.draw(caller, this.uniforms);

        // Fish
        const following = caller.controls && caller.controls.follow_target;
        const cam_pos = (!following && caller.controls) ? caller.controls.position : null;
        this.fish_manager.update(Math.min(dt, 0.05), cam_pos);
        this.fish_manager.draw(caller, this.uniforms);

        this.jellyfish.update(dt, t);
        this.jellyfish.draw(caller, this.uniforms, t);

        this.turtle.update(dt);
        this.turtle.draw(caller, this.uniforms, t);

        this.manta.update(dt);
        this.manta.draw(caller, this.uniforms, t);
    }
}