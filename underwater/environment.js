import {vec3, vec4, color, Mat4, defs} from './utils.js';

/**
 * Seafloor_Sand_Shader
 * - Phong lighting + blue underwater fog
 * - Procedural sand “texture” using world-space xz (no image assets needed)
 */
class Seafloor_Sand_Shader extends defs.Phong_Shader {
    constructor(num_lights = 8) {
        super(num_lights);
    }

    fragment_glsl_code() {
        return this.shared_glsl_code() + `
        uniform vec3 fog_color;
        uniform float fog_density;

        uniform float sand_scale;
        uniform float ripple_strength;
        uniform vec3 sand_tint;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
            vec4 base = vec4(shape_color.xyz * ambient, shape_color.w);
            base.xyz += phong_model_lights(normalize(N), vertex_worldspace);

            vec2 xz = vertex_worldspace.xz * sand_scale;
            float ripples =
                sin(xz.x * 2.2) * cos(xz.y * 1.7) +
                0.5 * sin((xz.x + xz.y) * 1.3);
            float grain = noise(xz * 2.5);

            float sand_mask = clamp(0.5 + 0.5 * ripples, 0.0, 1.0);
            sand_mask = mix(sand_mask, grain, 0.35);

            vec3 sand_color = mix(sand_tint * 0.85, sand_tint * 1.15, sand_mask);
            base.xyz = mix(base.xyz, base.xyz * sand_color, ripple_strength);

            float dist = length(camera_center - vertex_worldspace);
            float fog_factor = clamp(exp(-fog_density * dist), 0.0, 1.0);
            vec3 fogged = mix(fog_color, base.xyz, fog_factor);

            gl_FragColor = vec4(fogged, base.w);
        }`;
    }

    update_GPU(context, gpu, uniforms, model_transform, material) {
        const defaults = {
            fog_color: color(0.02, 0.18, 0.35, 1).to3(),
            fog_density: 0.02,
            sand_scale: 0.12,
            ripple_strength: 0.85,
            sand_tint: color(0.95, 0.90, 0.72, 1).to3(),
        };
        const full = Object.assign({}, defaults, material);

        super.update_GPU(context, gpu, uniforms, model_transform, full);

        if (!gpu.fog_color)       gpu.fog_color       = context.getUniformLocation(gpu.program, 'fog_color');
        if (!gpu.fog_density)     gpu.fog_density     = context.getUniformLocation(gpu.program, 'fog_density');
        if (!gpu.sand_scale)      gpu.sand_scale      = context.getUniformLocation(gpu.program, 'sand_scale');
        if (!gpu.ripple_strength) gpu.ripple_strength = context.getUniformLocation(gpu.program, 'ripple_strength');
        if (!gpu.sand_tint)       gpu.sand_tint       = context.getUniformLocation(gpu.program, 'sand_tint');

        context.uniform3fv(gpu.fog_color, full.fog_color);
        context.uniform1f(gpu.fog_density, full.fog_density);
        context.uniform1f(gpu.sand_scale, full.sand_scale);
        context.uniform1f(gpu.ripple_strength, full.ripple_strength);
        context.uniform3fv(gpu.sand_tint, full.sand_tint);
    }
}

class Underwater_Fog_Shader extends defs.Phong_Shader {
    constructor(num_lights = 8) {
        super(num_lights);
    }

    fragment_glsl_code() {
        return this.shared_glsl_code() + `
        uniform vec3 fog_color;
        uniform float fog_density;

        void main() {
            vec4 base = vec4(shape_color.xyz * ambient, shape_color.w);
            base.xyz += phong_model_lights(normalize(N), vertex_worldspace);

            float dist = length(camera_center - vertex_worldspace);
            float fog_factor = clamp(exp(-fog_density * dist), 0.0, 1.0);
            vec3 fogged = mix(fog_color, base.xyz, fog_factor);
            gl_FragColor = vec4(fogged, base.w);
        }`;
    }

    update_GPU(context, gpu, uniforms, model_transform, material) {
        const defaults = {
            fog_color: color(0.02, 0.18, 0.35, 1).to3(),
            fog_density: 0.02,
        };
        const full = Object.assign({}, defaults, material);

        super.update_GPU(context, gpu, uniforms, model_transform, full);

        if (!gpu.fog_color)   gpu.fog_color   = context.getUniformLocation(gpu.program, 'fog_color');
        if (!gpu.fog_density) gpu.fog_density = context.getUniformLocation(gpu.program, 'fog_density');
        context.uniform3fv(gpu.fog_color, full.fog_color);
        context.uniform1f(gpu.fog_density, full.fog_density);
    }
}

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
            return vec3(x, height_at(x, z), z);
        };

        const column_operation = (t, p, s) => {
            const x = (t - 0.5) * 2 * size;
            const z = (s - 0.5) * 2 * size;
            return vec3(x, height_at(x, z), z);
        };

        this.shape = new defs.Grid_Patch(
            this.grid_rows, this.grid_cols,
            row_operation, column_operation,
            [[0, this.grid_rows], [0, this.grid_cols]]
        );

        this.material = {
            shader: new Seafloor_Sand_Shader(8),
            ambient: 0.30,
            diffusivity: 0.8,
            specularity: 0.1,
            smoothness: 10,
            color: color(0.76, 0.70, 0.50, 1),
            fog_color: color(0.02, 0.18, 0.35, 1).to3(),
            fog_density: 0.02,
            sand_scale: 0.12,
            ripple_strength: 0.85,
            sand_tint: color(0.95, 0.90, 0.72, 1).to3(),
        };
    }

    draw(caller, uniforms) {
        this.shape.draw(caller, uniforms, Mat4.identity(), this.material);
    }

    get_height(x, z) {
        return this.height_at(x, z);
    }

    set_fog(fog_color, fog_density, ambient) {
        this.material.fog_color = fog_color;
        this.material.fog_density = fog_density;
        this.material.ambient = ambient;
    }
}

export class Sea_Plants {
    constructor(coral_obstacles = []) {
        this.shapes = {
            kelp_seg: new defs.Capped_Cylinder(8, 8),
            anemone_stalk: new defs.Capped_Cylinder(8, 8),
            cube: new defs.Cube(),
        };

        const shader = new Underwater_Fog_Shader(8);
        this.materials = {
            kelp: {
                shader,
                ambient: 0.24,
                diffusivity: 0.75,
                specularity: 0.08,
                smoothness: 10,
                color: color(0.23, 0.55, 0.28, 1),
                fog_color: color(0.02, 0.18, 0.35, 1).to3(),
                fog_density: 0.02,
            },
            kelp_glow: {
                shader,
                ambient: 0.78,
                diffusivity: 0.35,
                specularity: 0.12,
                smoothness: 15,
                color: color(0.30, 0.95, 0.72, 1),
                fog_color: color(0.01, 0.02, 0.08, 1).to3(),
                fog_density: 0.035,
            },
            anemone: {
                shader,
                ambient: 0.28,
                diffusivity: 0.7,
                specularity: 0.12,
                smoothness: 12,
                color: color(0.82, 0.55, 0.76, 1),
                fog_color: color(0.02, 0.18, 0.35, 1).to3(),
                fog_density: 0.02,
            },
            anemone_glow: {
                shader,
                ambient: 0.86,
                diffusivity: 0.28,
                specularity: 0.18,
                smoothness: 18,
                color: color(0.98, 0.30, 0.90, 1),
                fog_color: color(0.01, 0.02, 0.08, 1).to3(),
                fog_density: 0.035,
            },
        };

        this.plants = [];
        this._scatter_from_corals(coral_obstacles);
    }

    _scatter_from_corals(coral_obstacles) {
        let plant_id = 0;
        for (const coral of coral_obstacles) {
            const coral_pos = coral.position;
            const count = 1 + Math.floor(Math.random() * 3);
            for (let i = 0; i < count; i++) {
                const angle = Math.random() * 2 * Math.PI;
                const dist = coral.radius + 1.0 + Math.random() * 2.8;
                const x = coral_pos[0] + Math.cos(angle) * dist;
                const z = coral_pos[2] + Math.sin(angle) * dist;

                const type = (Math.random() < 0.65) ? 'kelp' : 'anemone';
                const scale = 0.75 + Math.random() * 0.9;
                const yaw = Math.random() * 2 * Math.PI;
                const sway_freq = 0.8 + Math.random() * 0.8;
                const sway_amplitude = 0.14 + Math.random() * 0.14;
                const segment_count = 5 + Math.floor(Math.random() * 4);
                this.plants.push({
                    id: plant_id++,
                    x,
                    z,
                    type,
                    scale,
                    yaw,
                    sway_freq,
                    sway_amplitude,
                    segment_count,
                    cluster_count: 6 + Math.floor(Math.random() * 4),
                });
            }
        }
    }

    set_fog(fog_color, fog_density) {
        for (const mat of Object.values(this.materials)) {
            mat.fog_color = fog_color;
            mat.fog_density = fog_density;
        }
    }

    draw(caller, uniforms, seafloor, t, night_blend = 0) {
        for (const plant of this.plants) {
            const y = seafloor ? seafloor.get_height(plant.x, plant.z) : 0;
            const base = Mat4.translation(plant.x, y, plant.z)
                .times(Mat4.rotation(plant.yaw, 0, 1, 0))
                .times(Mat4.scale(plant.scale, plant.scale, plant.scale));

            if (plant.type === 'kelp') this._draw_kelp(caller, uniforms, base, t, plant, night_blend);
            else this._draw_anemone(caller, uniforms, base, t, plant, night_blend);
        }
    }

    _blend_material(day_mat, glow_mat, night_blend) {
        const c0 = day_mat.color, c1 = glow_mat.color;
        return {
            ...day_mat,
            ambient: day_mat.ambient * (1 - night_blend) + glow_mat.ambient * night_blend,
            diffusivity: day_mat.diffusivity * (1 - 0.45 * night_blend),
            color: color(
                c0[0] * (1 - night_blend) + c1[0] * night_blend,
                c0[1] * (1 - night_blend) + c1[1] * night_blend,
                c0[2] * (1 - night_blend) + c1[2] * night_blend,
                1,
            ),
            fog_color: day_mat.fog_color,
            fog_density: day_mat.fog_density,
        };
    }

    _draw_kelp(caller, uniforms, base, t, plant, night_blend) {
        const mat = this._blend_material(this.materials.kelp, this.materials.kelp_glow, night_blend * 0.55);
        const segment_height = 0.82;
        let parent = base;

        for (let s = 0; s < plant.segment_count; s++) {
            const sway = Math.sin(t * plant.sway_freq + s * 0.5 + plant.id) * plant.sway_amplitude;
            const segment_transform = parent
                .times(Mat4.translation(0, segment_height, 0))
                .times(Mat4.rotation(sway, 0, 0, 1));

            const blade = segment_transform
                .times(Mat4.translation(0, segment_height * 0.5, 0))
                .times(Mat4.scale(0.16, segment_height * 0.55, 0.06));
            this.shapes.kelp_seg.draw(caller, uniforms, blade, mat);

            parent = segment_transform;
        }
    }

    _draw_anemone(caller, uniforms, base, t, plant, night_blend) {
        const stalk_mat = this._blend_material(this.materials.kelp, this.materials.kelp_glow, night_blend * 0.25);
        const tip_mat = this._blend_material(this.materials.anemone, this.materials.anemone_glow, night_blend);

        const stalk = base
            .times(Mat4.translation(0, 0.35, 0))
            .times(Mat4.scale(0.16, 0.35, 0.16));
        this.shapes.anemone_stalk.draw(caller, uniforms, stalk, stalk_mat);

        const top = base.times(Mat4.translation(0, 0.7, 0));
        for (let i = 0; i < plant.cluster_count; i++) {
            const theta = (i / plant.cluster_count) * 2 * Math.PI;
            const radius = 0.12 + 0.08 * (i % 2);
            const wave = 0.22 * Math.sin(t * (plant.sway_freq + 0.4) + plant.id + i * 0.7);
            const tentacle = top
                .times(Mat4.rotation(theta, 0, 1, 0))
                .times(Mat4.translation(radius, 0, 0))
                .times(Mat4.rotation(0.45 + wave, 0, 0, 1))
                .times(Mat4.translation(0, 0.28, 0))
                .times(Mat4.scale(0.035, 0.28, 0.035));
            this.shapes.anemone_stalk.draw(caller, uniforms, tentacle, tip_mat);
        }
    }
}

export class Lighting_Controller {
    constructor() {
        this.night_blend = 0;
        this.transition_speed = 0.75;
        this.day_fog = color(0.02, 0.18, 0.35, 1).to3();
        this.night_fog = color(0.01, 0.02, 0.08, 1).to3();
    }

    update(dt, night_mode) {
        const target = night_mode ? 1 : 0;
        const alpha = Math.min(1, dt * this.transition_speed);
        this.night_blend += (target - this.night_blend) * alpha;
        return this.night_blend;
    }

    current_fog_color() {
        const b = this.night_blend;
        return vec3(
            this.day_fog[0] * (1 - b) + this.night_fog[0] * b,
            this.day_fog[1] * (1 - b) + this.night_fog[1] * b,
            this.day_fog[2] * (1 - b) + this.night_fog[2] * b,
        );
    }

    current_fog_density() {
        return 0.02 + 0.015 * this.night_blend;
    }

    current_ambient() {
        return 0.30 * (1 - this.night_blend) + 0.05 * this.night_blend;
    }

    build_lights(jellyfish = [], coral_lights = []) {
        const b = this.night_blend;
        const sunlight_1 = defs.Phong_Shader.light_source(vec4(-0.2, 1.0, -0.1, 0), color(0.95, 0.98, 1.00, 1), 1e8 / Math.max(0.15, 1 - 0.85 * b));
        const sunlight_2 = defs.Phong_Shader.light_source(vec4(0.3, 0.8, 0.2, 0), color(0.35, 0.55, 0.85, 1), 1e8 / Math.max(0.15, 1 - 0.85 * b));
        const lights = [sunlight_1, sunlight_2];

        if (b > 0.02) {
            for (const glow of coral_lights.slice(0, 4)) {
                lights.push(defs.Phong_Shader.light_source(
                    vec4(glow.position[0], glow.position[1], glow.position[2], 1),
                    color(glow.color[0], glow.color[1], glow.color[2], 1),
                    7 + 4 * (1 - b)
                ));
            }

            const jelly_colors = [
                color(0.30, 1.00, 0.95, 1),
                color(1.00, 0.30, 0.90, 1),
                color(0.45, 1.00, 0.45, 1),
            ];
            jellyfish.slice(0, 3).forEach((pos, i) => {
                const c = jelly_colors[i % jelly_colors.length];
                lights.push(defs.Phong_Shader.light_source(
                    vec4(pos[0], pos[1] + 0.5, pos[2], 1),
                    color(c[0], c[1], c[2], 1),
                    8
                ));
            });
        }

        return lights;
    }
}
