import {vec3, color, Mat4, defs} from './utils.js';


// ── Catmull-Rom spline helpers ────────────────────────────────────────────────

function cr_pos(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return p0.times(0.5 * (-t + 2*t2 - t3))
        .plus(p1.times(0.5 * (2 - 5*t2 + 3*t3)))
        .plus(p2.times(0.5 * (t + 4*t2 - 3*t3)))
        .plus(p3.times(0.5 * (-t2 + t3)));
}

function cr_tangent(p0, p1, p2, p3, t) {
    const t2 = t * t;
    return p0.times(0.5 * (-1 + 4*t - 3*t2))
        .plus(p1.times(0.5 * (-10*t + 9*t2)))
        .plus(p2.times(0.5 * (1 + 8*t - 9*t2)))
        .plus(p3.times(0.5 * (-2*t + 3*t2)));
}

// 1D Catmull-Rom used for smooth keyframe interpolation
function cr_scalar(v0, v1, v2, v3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (
        (-v0 + 3*v1 - 3*v2 + v3) * t3 +
        (2*v0 - 5*v1 + 4*v2 - v3) * t2 +
        (-v0 + v2) * t +
        2*v1
    );
}

// Pre-compute arc-length lookup table for a closed spline loop
function build_arc_table(pts, steps = 80) {
    const n = pts.length;
    let arc = 0;
    let prev = pts[0];
    const table = [{ arc: 0, seg: 0, local_t: 0 }];

    for (let seg = 0; seg < n; seg++) {
        const p0 = pts[(seg - 1 + n) % n];
        const p1 = pts[seg];
        const p2 = pts[(seg + 1) % n];
        const p3 = pts[(seg + 2) % n];

        for (let j = 1; j <= steps; j++) {
            const local_t = j / steps;
            const pos = cr_pos(p0, p1, p2, p3, local_t);
            const dx = pos[0] - prev[0], dy = pos[1] - prev[1], dz = pos[2] - prev[2];
            arc += Math.sqrt(dx*dx + dy*dy + dz*dz);
            table.push({ arc, seg, local_t });
            prev = pos;
        }
    }

    return { table, total_length: arc };
}

// Binary search the arc table; wraps s into [0, total_length)
function arc_to_entry(arc_info, s) {
    const { table, total_length } = arc_info;
    s = ((s % total_length) + total_length) % total_length;
    let lo = 0, hi = table.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid].arc <= s) lo = mid; else hi = mid;
    }
    return table[lo];
}

function spline_sample(pts, arc_info, s) {
    const n = pts.length;
    const { seg, local_t } = arc_to_entry(arc_info, s);
    const p0 = pts[(seg - 1 + n) % n];
    const p1 = pts[seg];
    const p2 = pts[(seg + 1) % n];
    const p3 = pts[(seg + 2) % n];

    const position = cr_pos(p0, p1, p2, p3, local_t);
    let tangent = cr_tangent(p0, p1, p2, p3, local_t);
    const len = Math.sqrt(tangent[0]**2 + tangent[1]**2 + tangent[2]**2);
    tangent = len > 1e-6 ? tangent.times(1 / len) : vec3(1, 0, 0);

    return { position, tangent };
}

// Build a model transform placing an object at pos oriented along tangent
function orient_transform(pos, tangent) {
    const yaw   = Math.atan2(-tangent[0], -tangent[2]);
    const pitch = Math.asin(Math.max(-1, Math.min(1, tangent[1])));
    return Mat4.translation(pos[0], pos[1], pos[2])
        .times(Mat4.rotation(yaw,    0, 1, 0))
        .times(Mat4.rotation(-pitch, 1, 0, 0));
}


// ── Jellyfish keyframe pulsation ──────────────────────────────────────────────

// Bell keyframes: t_norm=0 relaxed, t_norm=0.4 contracted, t_norm=1 relaxed
const KF = {
    t_norm:  [0.0,  0.4,  1.0],
    scaleXZ: [1.0,  0.70, 1.0],
    scaleY:  [1.0,  1.30, 1.0],
    cycle:   2.2,  // seconds per pulsation
};

function kf_eval(channel, t_norm) {
    const n = KF.t_norm.length;
    let seg = n - 2;
    for (let i = 0; i < n - 1; i++) {
        if (t_norm <= KF.t_norm[i + 1]) { seg = i; break; }
    }
    const t0 = KF.t_norm[seg], t1 = KF.t_norm[seg + 1];
    const local_t = t0 === t1 ? 0 : (t_norm - t0) / (t1 - t0);
    const v0 = channel[((seg - 1) + n) % n];
    const v1 = channel[seg];
    const v2 = channel[(seg + 1) % n];
    const v3 = channel[(seg + 2) % n];
    return cr_scalar(v0, v1, v2, v3, local_t);
}


// ── Jellyfish ─────────────────────────────────────────────────────────────────

const N_TENTACLES = 8;
const N_SEGS      = 5;
const SEG_LEN     = 0.55;
const SEG_R       = 0.045;

class Jellyfish {
    constructor(start_pos, phase_offset = 0, bell_color = null) {
        this.position     = vec3(start_pos[0], start_pos[1], start_pos[2]);
        this.phase_offset = phase_offset;
        this.bell_color   = bell_color ?? color(0.65, 0.82, 1.0, 0.55);

        const a = Math.random() * 2 * Math.PI;
        this.drift    = vec3(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18);
        this.velocity = vec3(0, 0, 0);
        this.prev_t_norm = 0;
    }

    _phase(t) {
        return ((t + this.phase_offset) % KF.cycle) / KF.cycle;
    }

    update(dt, t) {
        if (dt <= 0 || dt > 0.1) return;

        const t_norm = this._phase(t);

        // Fire upward impulse at the contraction peak
        const PEAK = 0.4;
        const crossed = (this.prev_t_norm < PEAK && t_norm >= PEAK)
                     || (this.prev_t_norm > 0.9  && t_norm < 0.1);
        if (crossed) this.velocity = vec3(this.velocity[0], 0.65, this.velocity[2]);
        this.prev_t_norm = t_norm;

        const drag = 1.2;
        const noise = vec3(
            (Math.random() - 0.5) * 0.15,
            0,
            (Math.random() - 0.5) * 0.15,
        );
        const accel = vec3(
            this.drift[0] + noise[0] - this.velocity[0] * drag,
            -0.10                    - this.velocity[1] * drag,
            this.drift[2] + noise[2] - this.velocity[2] * drag,
        );
        this.velocity = vec3(
            this.velocity[0] + accel[0] * dt,
            this.velocity[1] + accel[1] * dt,
            this.velocity[2] + accel[2] * dt,
        );
        this.position = vec3(
            this.position[0] + this.velocity[0] * dt,
            this.position[1] + this.velocity[1] * dt,
            this.position[2] + this.velocity[2] * dt,
        );

        // Bounce between y = 2 and y = 28
        if (this.position[1] < 2) {
            this.position = vec3(this.position[0], 2, this.position[2]);
            this.velocity = vec3(this.velocity[0], Math.abs(this.velocity[1]) * 0.4, this.velocity[2]);
        }
        if (this.position[1] > 28) {
            this.position = vec3(this.position[0], 28, this.position[2]);
            this.velocity = vec3(this.velocity[0], -0.1, this.velocity[2]);
        }

        // Reverse drift at area boundary
        if (Math.abs(this.position[0]) > 38 || Math.abs(this.position[2]) > 38)
            this.drift = vec3(-this.drift[0], 0, -this.drift[2]);
    }

    draw(caller, uniforms, shapes, mat_bell, mat_tentacle, t) {
        const t_norm = this._phase(t);
        const sXZ = kf_eval(KF.scaleXZ, t_norm);
        const sY  = kf_eval(KF.scaleY,  t_norm);

        const px = this.position[0], py = this.position[1], pz = this.position[2];
        const rXZ = 1.15 * sXZ;
        const rY  = 0.58 * sY;

        // Bell
        const bell_m = Mat4.translation(px, py, pz).times(Mat4.scale(rXZ, rY, rXZ));
        shapes.sphere.draw(caller, uniforms, bell_m, { ...mat_bell, color: this.bell_color });

        // Tentacles: propagating sine wave down each hierarchical chain
        const attach_y = py - rY;
        const attach_r = rXZ * 0.78;

        for (let i = 0; i < N_TENTACLES; i++) {
            const angle = (i / N_TENTACLES) * 2 * Math.PI;
            const ax = px + Math.cos(angle) * attach_r;
            const az = pz + Math.sin(angle) * attach_r;

            let seg_t = Mat4.translation(ax, attach_y, az);

            for (let s = 0; s < N_SEGS; s++) {
                const sway_xz = 0.30 * Math.sin(t * 1.5 + i * 0.78 + s * 0.62);
                const sway_yz = 0.18 * Math.cos(t * 1.875 + i * 1.1 + s * 0.5);

                seg_t = seg_t
                    .times(Mat4.rotation(sway_xz, 0, 0, 1))
                    .times(Mat4.rotation(sway_yz, 1, 0, 0));

                const half  = SEG_LEN * 0.5;
                const cyl_m = seg_t.times(Mat4.translation(0, -half, 0))
                    .times(Mat4.scale(SEG_R, half, SEG_R));
                shapes.tentacle_cyl.draw(caller, uniforms, cyl_m, mat_tentacle);

                seg_t = seg_t.times(Mat4.translation(0, -SEG_LEN, 0));
            }
        }
    }
}

export class Jellyfish_School {
    constructor() {
        this.shapes = {
            sphere:       new defs.Subdivision_Sphere(3),
            tentacle_cyl: new defs.Capped_Cylinder(6, 6),
        };

        const shader = new defs.Phong_Shader(2);
        this._mat_bell = {
            shader,
            ambient: 0.55, diffusivity: 0.35, specularity: 0.9, smoothness: 70,
            color: color(0.65, 0.82, 1.0, 0.55),
        };
        this._mat_tentacle = {
            shader,
            ambient: 0.40, diffusivity: 0.45, specularity: 0.15, smoothness: 12,
            color: color(0.80, 0.90, 1.0, 0.55),
        };

        const COLORS = [
            color(0.62, 0.82, 1.00, 0.55),
            color(0.85, 0.62, 1.00, 0.55),
            color(0.62, 1.00, 0.80, 0.55),
            color(1.00, 0.80, 0.62, 0.55),
            color(0.72, 0.95, 1.00, 0.55),
            color(1.00, 0.68, 0.85, 0.55),
        ];

        const configs = [
            { pos: vec3(  4,  9,  -6), phase: 0.00 },
            { pos: vec3( -9, 13,   4), phase: 0.72 },
            { pos: vec3( 13,  7,   9), phase: 1.35 },
            { pos: vec3( -4, 17, -11), phase: 0.43 },
            { pos: vec3(  9, 11,  16), phase: 2.10 },
            { pos: vec3(-14,  8,  -2), phase: 1.80 },
        ];

        this.jellyfish = configs.map((c, i) =>
            new Jellyfish(c.pos, c.phase, COLORS[i % COLORS.length])
        );
    }

    // For P1: jellyfish positions for night-mode point lights
    get_positions() {
        return this.jellyfish.map(j => j.position);
    }

    update(dt, t) {
        for (const j of this.jellyfish) j.update(dt, t);
    }

    draw(caller, uniforms, t) {
        for (const j of this.jellyfish)
            j.draw(caller, uniforms, this.shapes, this._mat_bell, this._mat_tentacle, t);
    }
}


// ── Sea Turtle ────────────────────────────────────────────────────────────────

const TURTLE_PATH = [
    vec3(  0, 5,  22),
    vec3( 18, 4,  14),
    vec3( 26, 6,   2),
    vec3( 22, 5, -14),
    vec3(  6, 7, -22),
    vec3(-14, 4, -18),
    vec3(-24, 6,  -4),
    vec3(-18, 5,  16),
    vec3( -6, 4,  24),
];

export class Sea_Turtle {
    constructor() {
        this.shapes = {
            body:    new defs.Subdivision_Sphere(3),
            flipper: new defs.Subdivision_Sphere(2),
            head:    new defs.Subdivision_Sphere(2),
        };

        const shader = new defs.Phong_Shader(2);
        this.materials = {
            shell: { shader, ambient: 0.30, diffusivity: 0.80, specularity: 0.25, smoothness: 30, color: color(0.28, 0.42, 0.22, 1) },
            skin:  { shader, ambient: 0.30, diffusivity: 0.80, specularity: 0.10, smoothness: 15, color: color(0.35, 0.52, 0.30, 1) },
        };

        this._arc_info = build_arc_table(TURTLE_PATH, 100);
        this._dist = 0;
    }

    update(dt) {
        if (dt <= 0 || dt > 0.1) return;
        this._dist += 5.0 * dt;
    }

    draw(caller, uniforms, t) {
        const { position: pos, tangent } = spline_sample(TURTLE_PATH, this._arc_info, this._dist);
        const base = orient_transform(pos, tangent);

        this.shapes.body.draw(caller, uniforms,
            base.times(Mat4.scale(0.85, 0.40, 1.30)), this.materials.shell);

        this.shapes.head.draw(caller, uniforms,
            base.times(Mat4.translation(0, 0.05, -1.35)).times(Mat4.scale(0.38, 0.32, 0.40)),
            this.materials.skin);

        // Front flippers lead, rear flippers trail by half a cycle
        const stroke      = Math.sin(t * 0.9 * 2 * Math.PI) * 0.40;
        const stroke_rear = Math.sin(t * 0.9 * 2 * Math.PI + Math.PI) * 0.28;

        this.shapes.flipper.draw(caller, uniforms,
            base.times(Mat4.translation(-0.82, 0, -0.55))
                .times(Mat4.rotation(-stroke, 0, 0, 1))
                .times(Mat4.rotation(0.30, 0, 1, 0))
                .times(Mat4.scale(0.22, 0.06, 0.58)),
            this.materials.skin);

        this.shapes.flipper.draw(caller, uniforms,
            base.times(Mat4.translation(0.82, 0, -0.55))
                .times(Mat4.rotation(stroke, 0, 0, 1))
                .times(Mat4.rotation(-0.30, 0, 1, 0))
                .times(Mat4.scale(0.22, 0.06, 0.58)),
            this.materials.skin);

        this.shapes.flipper.draw(caller, uniforms,
            base.times(Mat4.translation(-0.65, 0, 0.70))
                .times(Mat4.rotation(-stroke_rear, 0, 0, 1))
                .times(Mat4.rotation(0.15, 0, 1, 0))
                .times(Mat4.scale(0.16, 0.05, 0.44)),
            this.materials.skin);

        this.shapes.flipper.draw(caller, uniforms,
            base.times(Mat4.translation(0.65, 0, 0.70))
                .times(Mat4.rotation(stroke_rear, 0, 0, 1))
                .times(Mat4.rotation(-0.15, 0, 1, 0))
                .times(Mat4.scale(0.16, 0.05, 0.44)),
            this.materials.skin);
    }
}


// ── Manta Ray ─────────────────────────────────────────────────────────────────

const MANTA_PATH = [
    vec3(  0, 16,  32),
    vec3( 28, 19,  16),
    vec3( 36, 15,  -8),
    vec3( 20, 12, -32),
    vec3( -8, 17, -36),
    vec3(-34, 20,  -8),
    vec3(-32, 14,  18),
    vec3(-12, 18,  34),
];

export class Manta_Ray {
    constructor() {
        this.shapes = {
            body:     new defs.Subdivision_Sphere(3),
            wing:     new defs.Subdivision_Sphere(2),
            head:     new defs.Subdivision_Sphere(2),
            tail_cyl: new defs.Capped_Cylinder(8, 8),
        };

        const shader = new defs.Phong_Shader(2);
        this.materials = {
            topside: { shader, ambient: 0.28, diffusivity: 0.80, specularity: 0.20, smoothness: 25, color: color(0.18, 0.18, 0.24, 1) },
            belly:   { shader, ambient: 0.45, diffusivity: 0.75, specularity: 0.10, smoothness: 15, color: color(0.75, 0.78, 0.80, 1) },
        };

        this._arc_info = build_arc_table(MANTA_PATH, 100);
        this._dist = 0;
    }

    update(dt) {
        if (dt <= 0 || dt > 0.1) return;
        this._dist += 9.0 * dt;
    }

    draw(caller, uniforms, t) {
        const { position: pos, tangent } = spline_sample(MANTA_PATH, this._arc_info, this._dist);
        const base = orient_transform(pos, tangent);

        // Body disc
        this.shapes.body.draw(caller, uniforms,
            base.times(Mat4.scale(2.8, 0.18, 1.4)), this.materials.topside);

        // Cephalic lobe
        this.shapes.head.draw(caller, uniforms,
            base.times(Mat4.translation(0, 0.05, -1.4)).times(Mat4.scale(0.55, 0.20, 0.45)),
            this.materials.belly);

        // Tail
        this.shapes.tail_cyl.draw(caller, uniforms,
            base.times(Mat4.translation(0, 0, 2.2))
                .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
                .times(Mat4.scale(0.07, 1.80, 0.07)),
            this.materials.topside);

        // Wings: two-segment hierarchical wave, tip bends more than root
        const beat = Math.sin(t * 0.55 * 2 * Math.PI) * 0.38;

        const l_pivot = base.times(Mat4.translation(-0.5, 0, 0));
        this.shapes.wing.draw(caller, uniforms,
            l_pivot.times(Mat4.rotation(-beat * 0.6, 0, 0, 1))
                   .times(Mat4.translation(-0.9, 0, 0))
                   .times(Mat4.scale(0.95, 0.12, 0.70)),
            this.materials.topside);
        this.shapes.wing.draw(caller, uniforms,
            l_pivot.times(Mat4.rotation(-beat * 0.6, 0, 0, 1))
                   .times(Mat4.translation(-1.8, 0, 0))
                   .times(Mat4.rotation(-beat * 0.4, 0, 0, 1))
                   .times(Mat4.translation(-0.8, 0, 0))
                   .times(Mat4.scale(0.80, 0.08, 0.55)),
            this.materials.topside);

        const r_pivot = base.times(Mat4.translation(0.5, 0, 0));
        this.shapes.wing.draw(caller, uniforms,
            r_pivot.times(Mat4.rotation(beat * 0.6, 0, 0, 1))
                   .times(Mat4.translation(0.9, 0, 0))
                   .times(Mat4.scale(0.95, 0.12, 0.70)),
            this.materials.topside);
        this.shapes.wing.draw(caller, uniforms,
            r_pivot.times(Mat4.rotation(beat * 0.6, 0, 0, 1))
                   .times(Mat4.translation(1.8, 0, 0))
                   .times(Mat4.rotation(beat * 0.4, 0, 0, 1))
                   .times(Mat4.translation(0.8, 0, 0))
                   .times(Mat4.scale(0.80, 0.08, 0.55)),
            this.materials.topside);
    }
}