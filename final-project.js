import {tiny, defs} from './examples/common.js';
import {Underwater_Camera, Seafloor, Sea_Plants, Lighting_Controller, Coral_Collection,
        Bubble_System, Plankton_System,
        Jellyfish_School, Sea_Turtle, Manta_Ray,
        Fish_Manager} from './underwater/index.js';

const {vec3, vec4, Mat4, Component} = tiny;

export class Final_Project extends Component {
    init() {
        this.night_mode = false;

        this.seafloor = new Seafloor();
        this.corals = new Coral_Collection();
        this.obstacles = this.corals.get_obstacles(this.seafloor);
        this.plants = new Sea_Plants(this.obstacles);
        this.lighting = new Lighting_Controller();

        this.bubbles  = new Bubble_System();
        this.plankton = new Plankton_System();
        this.fish_manager = new Fish_Manager(this.obstacles);
        this.jellyfish = new Jellyfish_School();
        this.turtle    = new Sea_Turtle();
        this.manta     = new Manta_Ray();
    }

    render_controls() {
        this.key_triggered_button('Night Mode', ['l'], () => this.night_mode = !this.night_mode);
        this.key_triggered_button('Unfollow', ['Escape'], () => {
            const cam = this.animated_children.find(c => c instanceof Underwater_Camera);
            if (cam) cam.follow_target = null;
        });
    }

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

            const cam2world = this.uniforms.camera_transform;
            const rd4 = cam2world.times(vec4(rv[0], rv[1], rv[2], 0));
            const ray_dir = vec3(rd4[0], rd4[1], rd4[2]);
            const ro4 = cam2world.times(vec4(0, 0, 0, 1));
            const ray_origin = vec3(ro4[0], ro4[1], ro4[2]);

            const all_fish = this.fish_manager.get_all_fish();
            let best_t = Infinity;
            let best_fish = null;
            for (const f of all_fish) {
                const t = this._ray_sphere(ray_origin, ray_dir, f.position, f.size * 1.5);
                if (t < best_t) {
                    best_t = t;
                    best_fish = f;
                }
            }
            controls.follow_target = best_fish;
        });
    }

    _apply_environment_state(dt) {
        const blend = this.lighting.update(dt, this.night_mode);
        const fog_color = this.lighting.current_fog_color();
        const fog_density = this.lighting.current_fog_density();
        const ambient = this.lighting.current_ambient();

        this.seafloor.set_fog(fog_color, fog_density, ambient);
        this.corals.set_fog(fog_color, fog_density);
        this.plants.set_fog(fog_color, fog_density);

        const jelly_positions = this.jellyfish.get_positions();
        const coral_lights = this.corals.get_glow_light_data(this.seafloor);
        this.uniforms.lights = this.lighting.build_lights(jelly_positions, coral_lights);
        return blend;
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

        const dt = Math.min(this.uniforms.animation_delta_time / 1000, 0.05);
        const t  = this.uniforms.animation_time / 1000;
        const night_blend = this._apply_environment_state(dt);

        this.seafloor.draw(caller, this.uniforms);
        this.corals.draw(caller, this.uniforms, this.seafloor, night_blend);
        this.plants.draw(caller, this.uniforms, this.seafloor, t, night_blend);

        const fish_positions = this.fish_manager.get_all_fish().map(f => f.position);
        this.bubbles.update(dt, fish_positions);
        this.bubbles.draw(caller, this.uniforms);
        this.plankton.update(dt);
        this.plankton.draw(caller, this.uniforms, night_blend);

        const following = caller.controls && caller.controls.follow_target;
        const cam_pos = (!following && caller.controls) ? caller.controls.position : null;
        this.fish_manager.update(dt, cam_pos);
        this.fish_manager.draw(caller, this.uniforms);

        this.jellyfish.update(dt, t);
        this.jellyfish.draw(caller, this.uniforms, t, night_blend);

        this.turtle.update(dt);
        this.turtle.draw(caller, this.uniforms, t);

        this.manta.update(dt);
        this.manta.draw(caller, this.uniforms, t);
    }
}
