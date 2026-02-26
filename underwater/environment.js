import {vec3, color, Mat4, defs} from './utils.js';

/**
 * Seafloor_Sand_Shader
 * - Phong lighting + blue underwater fog
 * - Procedural sand “texture” using world-space xz (no image assets needed)
 */
class Seafloor_Sand_Shader extends defs.Phong_Shader {
    constructor(num_lights = 2) {
        super(num_lights);
    }

    fragment_glsl_code() {
        return this.shared_glsl_code() + `
        uniform vec3 fog_color;
        uniform float fog_density;

        uniform float sand_scale;
        uniform float ripple_strength;
        uniform vec3 sand_tint;

        // Cheap hash noise (good enough for sand variation)
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
            // --- Base Phong shading ---
            vec4 base = vec4(shape_color.xyz * ambient, shape_color.w);
            base.xyz += phong_model_lights(normalize(N), vertex_worldspace);

            // --- Procedural sand “texture” (world-space ripples + noise) ---
            vec2 xz = vertex_worldspace.xz * sand_scale;

            // long ripples + cross ripples
            float ripples =
                sin(xz.x * 2.2) * cos(xz.y * 1.7) +
                0.5 * sin((xz.x + xz.y) * 1.3);

            // add a little grain
            float grain = noise(xz * 2.5);

            float sand_mask = clamp(0.5 + 0.5 * ripples, 0.0, 1.0);
            sand_mask = mix(sand_mask, grain, 0.35);

            vec3 sand_color = mix(sand_tint * 0.85, sand_tint * 1.15, sand_mask);
            base.xyz = mix(base.xyz, base.xyz * sand_color, ripple_strength);

            // --- Underwater fog (fade to deep blue with distance) ---
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

        // Let Phong_Shader handle built-ins (lights, matrices, etc.)
        super.update_GPU(context, gpu, uniforms, model_transform, full);

        // Cache custom uniform locations (Phong_Shader won't do this for us)
        if (!gpu.fog_color)       gpu.fog_color       = context.getUniformLocation(gpu.program, "fog_color");
        if (!gpu.fog_density)     gpu.fog_density     = context.getUniformLocation(gpu.program, "fog_density");
        if (!gpu.sand_scale)      gpu.sand_scale      = context.getUniformLocation(gpu.program, "sand_scale");
        if (!gpu.ripple_strength) gpu.ripple_strength = context.getUniformLocation(gpu.program, "ripple_strength");
        if (!gpu.sand_tint)       gpu.sand_tint       = context.getUniformLocation(gpu.program, "sand_tint");

        context.uniform3fv(gpu.fog_color, full.fog_color);
        context.uniform1f(gpu.fog_density, full.fog_density);
        context.uniform1f(gpu.sand_scale, full.sand_scale);
        context.uniform1f(gpu.ripple_strength, full.ripple_strength);
        context.uniform3fv(gpu.sand_tint, full.sand_tint);
    }
}

export class Seafloor {
    constructor() {
        this.size = 100;
        this.grid_rows = 60;
        this.grid_cols = 60;

        // Undulating terrain (sin/cos “noise”)
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
            const y = height_at(x, z);
            return vec3(x, y, z);
        };

        const column_operation = (t, p, s) => {
            const x = (t - 0.5) * 2 * size;
            const z = (s - 0.5) * 2 * size;
            const y = height_at(x, z);
            return vec3(x, y, z);
        };

        this.shape = new defs.Grid_Patch(
            this.grid_rows, this.grid_cols,
            row_operation, column_operation,
            [[0, this.grid_rows], [0, this.grid_cols]]
        );

        // Material uses procedural “texture” + fog
        this.material = {
            shader: new Seafloor_Sand_Shader(2),
            ambient: 0.3,
            diffusivity: 0.8,
            specularity: 0.1,
            smoothness: 10,
            color: color(0.76, 0.70, 0.50, 1),

            // Fog tuning
            fog_color: color(0.02, 0.18, 0.35, 1).to3(),
            fog_density: 0.02,

            // Sand texture tuning
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
}
