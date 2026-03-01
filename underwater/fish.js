import {vec3, vec4, color, Mat4, defs} from './utils.js';

// Fog constants — match the rest of the scene (coral.js / environment.js)
const FOG_COLOR   = color(0.02, 0.18, 0.35, 1).to3();
const FOG_DENSITY = 0.02;

// ─────────────────────────────────────────────────────────────────────────────
//  Shader: Phong + exponential distance fog
//  (mirrors Underwater_Phong_Fog in coral.js)
// ─────────────────────────────────────────────────────────────────────────────
class Fish_Phong_Fog extends defs.Phong_Shader {
    constructor(num_lights = 2) { super(num_lights); }

    fragment_glsl_code() {
        return this.shared_glsl_code() + `
            uniform vec3  fog_color;
            uniform float fog_density;

            void main() {
                vec4 base = vec4(shape_color.xyz * ambient, shape_color.w);
                base.xyz += phong_model_lights(normalize(N), vertex_worldspace);

                float dist       = length(camera_center - vertex_worldspace);
                float fog_factor = clamp(exp(-fog_density * dist), 0.0, 1.0);
                gl_FragColor     = vec4(mix(fog_color, base.xyz, fog_factor), base.w);
            }`;
    }

    update_GPU(context, gpu, uniforms, model_transform, material) {
        const defaults = { fog_color: FOG_COLOR, fog_density: FOG_DENSITY };
        const full     = Object.assign({}, defaults, material);
        super.update_GPU(context, gpu, uniforms, model_transform, full);

        if (!gpu.fog_color)   gpu.fog_color   = context.getUniformLocation(gpu.program, 'fog_color');
        if (!gpu.fog_density) gpu.fog_density = context.getUniformLocation(gpu.program, 'fog_density');
        context.uniform3fv(gpu.fog_color,   full.fog_color);
        context.uniform1f (gpu.fog_density, full.fog_density);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fish — single articulated fish with boid steering
// ─────────────────────────────────────────────────────────────────────────────
class Fish {
    /**
     * @param {object}  cfg
     * @param {Vector3} cfg.position   world-space starting position
     * @param {number}  cfg.heading    initial yaw angle (radians; 0 = facing +Z)
     * @param {Vector4} cfg.fish_color RGBA color used when drawing
     * @param {number}  cfg.size       uniform scale factor
     */
    constructor({ position, heading = 0, fish_color, size = 1 }) {
        this.position   = position.copy();
        this.heading    = heading;
        this.pitch      = 0;
        this.fish_color = fish_color;
        this.size       = size;

        // Start with forward velocity so the school moves immediately
        const spd     = 2 + Math.random() * 2;
        this.velocity = vec3(Math.sin(heading) * spd, 0, Math.cos(heading) * spd);

        // Swimming animation state
        this.swim_time  = Math.random() * Math.PI * 2; // stagger phases across fish
        this.swim_freq  = 2.2 + Math.random() * 0.6;   // tail oscillation speed (rad/s)
        this.phase_step = Math.PI / 3;                  // phase delay per tail segment
        this.tail_amp   = 0.38;                         // tail bend amplitude (rad)
        this.fin_amp    = 0.22;                         // pectoral fin amplitude (rad)

        // Boid dynamics
        this.max_speed = 5 + Math.random() * 2;
        this.max_force = 4;
    }

    // ── Reynolds boid forces ─────────────────────────────────────────────────

    /** Steer away from fish that are too close. */
    _separation(neighbors) {
        const RADIUS = 2.8;
        let sx = 0, sy = 0, sz = 0;
        for (const n of neighbors) {
            if (n === this) continue;
            const dx = this.position[0] - n.position[0];
            const dy = this.position[1] - n.position[1];
            const dz = this.position[2] - n.position[2];
            const dist2 = dx*dx + dy*dy + dz*dz;
            if (dist2 > 1e-6 && dist2 < RADIUS * RADIUS) {
                const inv = 1.0 / dist2; // magnitude ∝ 1/dist²
                sx += dx * inv;
                sy += dy * inv;
                sz += dz * inv;
            }
        }
        return vec3(sx, sy, sz);
    }

    /** Match average velocity direction of nearby fish. */
    _alignment(neighbors) {
        const RADIUS = 8.0;
        let ax = 0, ay = 0, az = 0, count = 0;
        for (const n of neighbors) {
            if (n === this) continue;
            const dx = this.position[0] - n.position[0];
            const dy = this.position[1] - n.position[1];
            const dz = this.position[2] - n.position[2];
            if (dx*dx + dy*dy + dz*dz < RADIUS * RADIUS) {
                ax += n.velocity[0];
                ay += n.velocity[1];
                az += n.velocity[2];
                count++;
            }
        }
        if (count === 0) return vec3(0, 0, 0);
        const len = Math.sqrt(ax*ax + ay*ay + az*az);
        if (len < 1e-4) return vec3(0, 0, 0);
        return vec3(ax / len, ay / len, az / len);
    }

    /** Steer toward the center of mass of nearby fish. */
    _cohesion(neighbors) {
        const RADIUS = 15.0;
        let cx = 0, cy = 0, cz = 0, count = 0;
        for (const n of neighbors) {
            if (n === this) continue;
            const dx = this.position[0] - n.position[0];
            const dy = this.position[1] - n.position[1];
            const dz = this.position[2] - n.position[2];
            if (dx*dx + dy*dy + dz*dz < RADIUS * RADIUS) {
                cx += n.position[0];
                cy += n.position[1];
                cz += n.position[2];
                count++;
            }
        }
        if (count === 0) return vec3(0, 0, 0);
        cx /= count; cy /= count; cz /= count;
        const dx = cx - this.position[0];
        const dy = cy - this.position[1];
        const dz = cz - this.position[2];
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (len < 1e-4) return vec3(0, 0, 0);
        return vec3(dx / len, dy / len, dz / len);
    }

    /**
     * Repel from coral obstacles and the player camera.
     * @param {Array<{position:Vector3, radius:number}>} obstacles
     * @param {Vector3|null} camera_pos
     */
    _avoid_obstacles(obstacles, camera_pos) {
        const BUFFER = 5.0;
        let ox = 0, oy = 0, oz = 0;

        const repel = (px, py, pz, obj_radius) => {
            const dx  = this.position[0] - px;
            const dy  = this.position[1] - py;
            const dz  = this.position[2] - pz;
            const raw = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const pen = raw - obj_radius; // distance inside buffer zone
            if (pen < BUFFER && raw > 1e-4) {
                const strength = BUFFER / Math.max(pen, 0.1);
                ox += (dx / raw) * strength;
                oy += (dy / raw) * strength;
                oz += (dz / raw) * strength;
            }
        };

        for (const obs of obstacles) repel(obs.position[0], obs.position[1], obs.position[2], obs.radius);
        if (camera_pos) repel(camera_pos[0], camera_pos[1], camera_pos[2], 2.0);

        return vec3(ox, oy, oz);
    }

    /**
     * Gently push fish back toward play area.
     * @param {{min:Vector3, max:Vector3}} bounds
     */
    _boundary_steer(bounds) {
        const MARGIN = 8;
        const { min, max } = bounds;
        let sx = 0, sy = 0, sz = 0;
        if (this.position[0] < min[0] + MARGIN) sx += 1;
        if (this.position[0] > max[0] - MARGIN) sx -= 1;
        if (this.position[1] < min[1] + MARGIN) sy += 1;
        if (this.position[1] > max[1] - MARGIN) sy -= 1;
        if (this.position[2] < min[2] + MARGIN) sz += 1;
        if (this.position[2] > max[2] - MARGIN) sz -= 1;
        return vec3(sx, sy, sz);
    }

    // ── Physics integration ──────────────────────────────────────────────────

    /**
     * @param {number}    dt            seconds since last frame (capped upstream)
     * @param {Fish[]}    neighbors     fish in the same school
     * @param {Array}     obstacles     coral obstacle list
     * @param {Vector3}   camera_pos    player position (dynamic obstacle)
     * @param {{min,max}} play_bounds   world-space swim volume
     */
    update(dt, neighbors, obstacles, camera_pos, play_bounds) {
        this.swim_time += dt;

        // Steering forces (Reynolds' rules + extensions)
        const sep = this._separation(neighbors);
        const aln = this._alignment(neighbors);
        const coh = this._cohesion(neighbors);
        const obs = this._avoid_obstacles(obstacles, camera_pos);
        const bnd = this._boundary_steer(play_bounds);

        // Weighted sum of accelerations
        let ax = sep[0]*1.5 + aln[0]*1.0 + coh[0]*0.8 + obs[0]*2.5 + bnd[0]*2.0;
        let ay = sep[1]*1.5 + aln[1]*1.0 + coh[1]*0.8 + obs[1]*2.5 + bnd[1]*2.0;
        let az = sep[2]*1.5 + aln[2]*1.0 + coh[2]*0.8 + obs[2]*2.5 + bnd[2]*2.0;

        // Clamp total acceleration magnitude
        const a_len = Math.sqrt(ax*ax + ay*ay + az*az);
        if (a_len > this.max_force) {
            const inv = this.max_force / a_len;
            ax *= inv; ay *= inv; az *= inv;
        }

        // Integrate velocity
        let vx = this.velocity[0] + ax * dt;
        let vy = this.velocity[1] + ay * dt;
        let vz = this.velocity[2] + az * dt;

        // Clamp speed
        const v_len = Math.sqrt(vx*vx + vy*vy + vz*vz);
        if (v_len > this.max_speed) {
            const inv = this.max_speed / v_len;
            vx *= inv; vy *= inv; vz *= inv;
        }

        this.velocity = vec3(vx, vy, vz);

        // Integrate position
        this.position = vec3(
            this.position[0] + vx * dt,
            this.position[1] + vy * dt,
            this.position[2] + vz * dt,
        );

        // Update orientation from velocity
        const xz_spd = Math.sqrt(vx*vx + vz*vz);
        if (xz_spd > 0.5) this.heading = Math.atan2(vx, vz);
        if (v_len  > 0.5) this.pitch   = Math.atan2(-vy, xz_spd);
    }

    // ── Articulated drawing (forward kinematics) ─────────────────────────────

    /**
     * Draw the fish as a 7-part hierarchy using forward kinematics.
     *
     * Local-space convention: fish faces +Z, tail extends in −Z, Y is up.
     * Each tail joint applies:
     *   T(0, 0, −joint_offset) · Ry(A·sin(ωt + i·φ))
     * creating a travelling sine wave from body to tail fin.
     *
     * @param {WebGL_Manager} caller
     * @param {object}        uniforms
     * @param {Shape}         shape     shared Subdivision_Sphere(3)
     * @param {object}        material  base material (color overridden per fish)
     */
    draw(caller, uniforms, shape, material) {
        const t  = this.swim_time;
        const s  = this.size;
        const f  = this.swim_freq;
        const ph = this.phase_step;
        const ta = this.tail_amp;
        const fa = this.fin_amp;

        // Override color per fish while keeping all other material properties
        const mat = Object.assign({}, material, { color: this.fish_color });

        // World transform: translate → yaw (heading) → pitch
        const base = Mat4.translation(this.position[0], this.position[1], this.position[2])
            .times(Mat4.rotation(this.heading, 0, 1, 0))
            .times(Mat4.rotation(this.pitch,   1, 0, 0));

        // ── BODY (ellipsoid: long along Z, narrow in X/Y) ─────────────────
        shape.draw(caller, uniforms,
            base.times(Mat4.scale(s * 0.50, s * 0.28, s * 0.80)),
            mat);

        // ── TAIL SEGMENT 1 ────────────────────────────────────────────────
        // Joint at the rear of the body (−Z side)
        const wave1     = Math.sin(t * f + 0 * ph) * ta;
        const seg1_root = base
            .times(Mat4.translation(0, 0, -s * 0.80))  // move to rear body joint
            .times(Mat4.rotation(wave1, 0, 1, 0));      // bend around Y

        shape.draw(caller, uniforms,
            seg1_root
                .times(Mat4.translation(0, 0, -s * 0.25)) // draw at segment midpoint
                .times(Mat4.scale(s * 0.30, s * 0.24, s * 0.45)),
            mat);

        // ── TAIL SEGMENT 2 ────────────────────────────────────────────────
        // Joint at the far end of segment 1
        const wave2     = Math.sin(t * f + 1 * ph) * ta;
        const seg2_root = seg1_root
            .times(Mat4.translation(0, 0, -s * 0.50))
            .times(Mat4.rotation(wave2, 0, 1, 0));

        shape.draw(caller, uniforms,
            seg2_root
                .times(Mat4.translation(0, 0, -s * 0.18))
                .times(Mat4.scale(s * 0.22, s * 0.18, s * 0.32)),
            mat);

        // ── TAIL FIN (wide in X, thin in Y — flattened) ───────────────────
        const wave3    = Math.sin(t * f + 2 * ph) * ta;
        const fin_root = seg2_root
            .times(Mat4.translation(0, 0, -s * 0.36))
            .times(Mat4.rotation(wave3, 0, 1, 0));

        shape.draw(caller, uniforms,
            fin_root
                .times(Mat4.translation(0, 0, -s * 0.10))
                .times(Mat4.scale(s * 0.42, s * 0.06, s * 0.18)),
            mat);

        // ── LEFT PECTORAL FIN ─────────────────────────────────────────────
        const fin_wave = Math.sin(t * f * 0.8 + Math.PI) * fa;

        shape.draw(caller, uniforms,
            base
                .times(Mat4.translation(-s * 0.50, -s * 0.10, 0))
                .times(Mat4.rotation(-fin_wave, 0, 0, 1))  // flap up/down around Z
                .times(Mat4.scale(s * 0.45, s * 0.07, s * 0.32)),
            mat);

        // ── RIGHT PECTORAL FIN ────────────────────────────────────────────
        shape.draw(caller, uniforms,
            base
                .times(Mat4.translation( s * 0.50, -s * 0.10, 0))
                .times(Mat4.rotation( fin_wave, 0, 0, 1))
                .times(Mat4.scale(s * 0.45, s * 0.07, s * 0.32)),
            mat);

        // ── DORSAL FIN (top of body, thin in X, tall in Y) ────────────────
        shape.draw(caller, uniforms,
            base
                .times(Mat4.translation(0, s * 0.32, -s * 0.15))
                .times(Mat4.rotation(Math.sin(t * f * 0.7) * 0.10, 0, 0, 1))
                .times(Mat4.scale(s * 0.06, s * 0.38, s * 0.28)),
            mat);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fish_School — a group of fish that flock together
// ─────────────────────────────────────────────────────────────────────────────
class Fish_School {
    /**
     * @param {object}  cfg
     * @param {number}  cfg.count       number of fish
     * @param {Vector3} cfg.center      center of spawn region
     * @param {Vector4} cfg.fish_color  RGBA color for all fish in this school
     * @param {number}  cfg.size        body scale
     * @param {number}  cfg.heading     initial facing angle (radians)
     */
    constructor({ count, center, fish_color, size, heading }) {
        this.fish = [];
        const SPREAD = 6;
        for (let i = 0; i < count; i++) {
            const pos = vec3(
                center[0] + (Math.random() - 0.5) * SPREAD,
                center[1] + (Math.random() - 0.5) * SPREAD * 0.4,
                center[2] + (Math.random() - 0.5) * SPREAD,
            );
            this.fish.push(new Fish({
                position:   pos,
                heading:    heading + (Math.random() - 0.5) * 0.8,
                fish_color,
                size,
            }));
        }
    }

    update(dt, obstacles, camera_pos, play_bounds) {
        // Each fish uses the same-school list as its neighbor set
        for (const f of this.fish)
            f.update(dt, this.fish, obstacles, camera_pos, play_bounds);
    }

    draw(caller, uniforms, shape, material) {
        for (const f of this.fish)
            f.draw(caller, uniforms, shape, material);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fish_Manager — public API; owns all schools
// ─────────────────────────────────────────────────────────────────────────────
export class Fish_Manager {
    /**
     * @param {Array<{position:Vector3, radius:number}>} obstacles
     *   Coral obstacle list from Coral_Collection.get_obstacles()
     */
    constructor(obstacles = []) {
        this.obstacles = obstacles;

        // One Subdivision_Sphere used for every body part of every fish.
        // Subdivisions=3 gives smooth appearance without too many triangles.
        this.shape = new defs.Subdivision_Sphere(3);

        const shader   = new Fish_Phong_Fog(2);
        const base_mat = {
            shader,
            ambient:     0.30,
            diffusivity: 0.90,
            specularity: 0.40,
            smoothness:  30,
            fog_color:   FOG_COLOR,
            fog_density: FOG_DENSITY,
        };

        // Play-volume: fish gently steer back when within MARGIN of these bounds
        this.play_bounds = {
            min: vec3(-44,  3, -44),
            max: vec3( 44, 28,  44),
        };

        // Three schools with different colors, sizes, and starting locations
        this.schools = [
            {
                // Orange school — mid-reef, heading +Z
                school:   new Fish_School({ count: 10, center: vec3(-15, 6, -10),
                                            fish_color: color(1.00, 0.50, 0.20, 1),
                                            size: 0.80, heading: 0 }),
                material: Object.assign({}, base_mat, { color: color(1.00, 0.50, 0.20, 1) }),
            },
            {
                // Cyan school — right reef, heading −Z
                school:   new Fish_School({ count: 12, center: vec3( 15, 7, -15),
                                            fish_color: color(0.30, 0.85, 1.00, 1),
                                            size: 0.60, heading: Math.PI }),
                material: Object.assign({}, base_mat, { color: color(0.30, 0.85, 1.00, 1) }),
            },
            {
                // Yellow school — deeper water, heading +X
                school:   new Fish_School({ count:  8, center: vec3(  0, 9, -25),
                                            fish_color: color(0.95, 0.90, 0.20, 1),
                                            size: 1.10, heading: Math.PI / 2 }),
                material: Object.assign({}, base_mat, { color: color(0.95, 0.90, 0.20, 1) }),
            },
        ];
    }

    /**
     * Advance simulation one timestep.
     * @param {number}  dt         seconds (caller should cap at ~0.05)
     * @param {Vector3} camera_pos player position for avoidance
     */
    update(dt, camera_pos) {
        for (const { school } of this.schools)
            school.update(dt, this.obstacles, camera_pos, this.play_bounds);
    }

    /** Render all fish. */
    draw(caller, uniforms) {
        for (const { school, material } of this.schools)
            school.draw(caller, uniforms, this.shape, material);
    }

    /** Return flat array of all fish objects (each has .position, .size, .heading). */
    get_all_fish() {
        const result = [];
        for (const { school } of this.schools)
            for (const f of school.fish)
                result.push(f);
        return result;
    }
}
