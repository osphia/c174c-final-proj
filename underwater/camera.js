import {vec, vec3, vec4, color, Mat4, Shader, Component, defs} from './utils.js';

export class Underwater_Camera extends Component {
    yaw = 0;
    pitch = 0;
    position = vec3(0, 5, 20);
    velocity = vec3(0, 0, 0);
    thrust = vec3(0, 0, 0);

    swim_speed = 8;
    drag = 3.0;
    mouse_sensitivity = 1 / 300;
    pitch_limit = Math.PI * 0.47;

    // Swim bob — gentle sinusoidal sway to simulate floating
    bob_time = 0;
    bob_y_amp = 0.06;       // vertical bob amplitude
    bob_y_freq = 0.8;       // vertical bob frequency (Hz)
    bob_roll_amp = 0.008;   // roll tilt amplitude (radians)
    bob_roll_freq = 0.5;    // roll tilt frequency (Hz)

    mouse_enabled_canvases = new Set();
    keyboard_enabled = false;
    keys_down = new Set();
    will_take_over_uniforms = true;

    init() {}

    add_mouse_controls(canvas) {
        if (this.mouse_enabled_canvases.has(canvas)) return;
        this.mouse_enabled_canvases.add(canvas);

        this.mouse = {from_center: vec(0, 0), anchor: undefined};

        const mouse_position = (e, rect = canvas.getBoundingClientRect()) =>
            vec(e.clientX - (rect.left + rect.right) / 2, e.clientY - (rect.bottom + rect.top) / 2);

        document.addEventListener("mouseup", e => { this.mouse.anchor = undefined; });
        canvas.addEventListener("mousedown", e => {
            e.preventDefault();
            this.mouse.anchor = mouse_position(e);
        });
        canvas.addEventListener("mousemove", e => {
            e.preventDefault();
            this.mouse.from_center = mouse_position(e);
        });
        canvas.addEventListener("mouseout", e => {
            if (!this.mouse.anchor) this.mouse.from_center.scale_by(0);
        });

        // Keyboard controls should not depend on the control panel existing.
        // Bind once globally so WASD / space / z always work.
        if (!this.keyboard_enabled) {
            this.keyboard_enabled = true;
            const down = (e) => {
                this.keys_down.add(e.key.toLowerCase());
            };
            const up = (e) => {
                this.keys_down.delete(e.key.toLowerCase());
            };
            document.addEventListener('keydown', down);
            document.addEventListener('keyup', up);
        }
    }

    render_controls() {
        this.control_panel.innerHTML += "Underwater Camera:<br>";
        this.key_triggered_button("Forward", ["w"], () => this.thrust[2] = 1, undefined, () => this.thrust[2] = 0);
        this.key_triggered_button("Left", ["a"], () => this.thrust[0] = -1, undefined, () => this.thrust[0] = 0);
        this.key_triggered_button("Back", ["s"], () => this.thrust[2] = -1, undefined, () => this.thrust[2] = 0);
        this.key_triggered_button("Right", ["d"], () => this.thrust[0] = 1, undefined, () => this.thrust[0] = 0);
        this.new_line();
        this.key_triggered_button("Ascend", [" "], () => this.thrust[1] = 1, undefined, () => this.thrust[1] = 0);
        this.key_triggered_button("Descend", ["z"], () => this.thrust[1] = -1, undefined, () => this.thrust[1] = 0);
        this.new_line();
        this.live_string(box => {
            box.textContent = "Pos: " +
                this.position[0].toFixed(1) + ", " +
                this.position[1].toFixed(1) + ", " +
                this.position[2].toFixed(1);
        });
    }

    get_forward() {
        return vec3(
            Math.sin(this.yaw) * Math.cos(this.pitch),
            Math.sin(this.pitch),
            -Math.cos(this.yaw) * Math.cos(this.pitch)
        );
    }

    get_right() {
        return vec3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    }

    render_animation(caller) {
        const dt = this.uniforms.animation_delta_time / 1000;
        if (dt <= 0 || dt > 0.1) return;

        // Convert current pressed keys -> thrust each frame.
        // (Keeps behavior consistent even if the controls panel isn't open.)
        const kd = this.keys_down;
        this.thrust = vec3(0, 0, 0);
        if (kd.has('w')) this.thrust[2] = 1;
        if (kd.has('s')) this.thrust[2] = -1;
        if (kd.has('a')) this.thrust[0] = -1;
        if (kd.has('d')) this.thrust[0] = 1;
        if (kd.has(' ') || kd.has('space')) this.thrust[1] = 1;
        if (kd.has('z')) this.thrust[1] = -1;

        // Mouse movement
        if (this.mouse && this.mouse.from_center) {
            const leeway = 70;
            const mx = this.mouse.from_center[0];
            const my = this.mouse.from_center[1];
            const dx = (Math.abs(mx) > leeway) ? (mx - Math.sign(mx) * leeway) : 0;
            const dy = (Math.abs(my) > leeway) ? (my - Math.sign(my) * leeway) : 0;

            this.yaw += dx * this.mouse_sensitivity * dt;
            this.pitch -= dy * this.mouse_sensitivity * dt;
            this.pitch = Math.max(-this.pitch_limit, Math.min(this.pitch_limit, this.pitch));
        }

        // Movement
        const forward = this.get_forward();
        const right = this.get_right();
        const up = vec3(0, 1, 0);

        let accel = vec3(0, 0, 0);
        accel = accel.plus(forward.times(this.thrust[2]));
        accel = accel.plus(right.times(this.thrust[0]));
        accel = accel.plus(up.times(this.thrust[1]));
        if (accel.norm() > 0.01) accel = accel.normalized();
        accel = accel.times(this.swim_speed);

        this.velocity = this.velocity.plus(
            accel.minus(this.velocity.times(this.drag)).times(dt)
        );
        this.position = this.position.plus(this.velocity.times(dt));

        if (this.seafloor_height_fn) {
            const floor_y = this.seafloor_height_fn(this.position[0], this.position[2]) + 1.0;
            if (this.position[1] < floor_y) {
                this.position = vec3(this.position[0], floor_y, this.position[2]);
                if (this.velocity[1] < 0) this.velocity = vec3(this.velocity[0], 0, this.velocity[2]);
            }
        }

        // Swim bob — subtle floating sway
        this.bob_time += dt;
        const bob_y = this.bob_y_amp * Math.sin(2 * Math.PI * this.bob_y_freq * this.bob_time);
        const bob_roll = this.bob_roll_amp * Math.sin(2 * Math.PI * this.bob_roll_freq * this.bob_time);

        const eye = this.position.plus(vec3(0, bob_y, 0));
        const target = eye.plus(forward);
        const up_tilted = vec3(Math.sin(bob_roll), Math.cos(bob_roll), 0);
        const camera_matrix = Mat4.look_at(eye, target, up_tilted);
        Shader.assign_camera(camera_matrix, this.uniforms);
    }
}