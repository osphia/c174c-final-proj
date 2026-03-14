import {vec3, color, Mat4, defs} from './utils.js';

class Underwater_Phong_Fog extends defs.Phong_Shader {
  constructor(num_lights = 8) { super(num_lights); }

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

export class Coral_Collection {
  constructor() {
    this.shapes = {
      cone: new defs.Closed_Cone(12, 12),
      cyl: new defs.Capped_Cylinder(12, 12),
      sphere: new defs.Subdivision_Sphere(3),
      torus: new defs.Torus(15, 15),
    };

    const shader = new Underwater_Phong_Fog(8);

    this.materials = {
      branch: { shader, ambient: 0.25, diffusivity: 0.85, specularity: 0.15, smoothness: 20, color: color(0.95, 0.55, 0.65, 1), glow: color(1.00, 0.25, 0.82, 1) },
      brain:  { shader, ambient: 0.25, diffusivity: 0.85, specularity: 0.10, smoothness: 25, color: color(0.92, 0.75, 0.45, 1), glow: color(0.30, 1.00, 0.90, 1) },
      tube:   { shader, ambient: 0.25, diffusivity: 0.85, specularity: 0.10, smoothness: 20, color: color(0.55, 0.88, 0.80, 1), glow: color(0.45, 1.00, 0.45, 1) },
      fan:    { shader, ambient: 0.25, diffusivity: 0.85, specularity: 0.10, smoothness: 20, color: color(0.85, 0.50, 0.95, 1), glow: color(0.95, 0.30, 1.00, 1) },
    };

    this.obstacles = [];
    this._init_scatter();
  }

  _init_scatter() {
    const rings = [
      { r: 10, n: 10 },
      { r: 18, n: 14 },
      { r: 26, n: 18 },
      { r: 34, n: 22 },
    ];
    const types = ['branch', 'brain', 'tube', 'fan'];
    const jitter = 2.5;

    let idx = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const theta = (i / ring.n) * 2 * Math.PI + (Math.random() - 0.5) * 0.25;
        const x = ring.r * Math.cos(theta) + (Math.random() - 0.5) * jitter;
        const z = ring.r * Math.sin(theta) + (Math.random() - 0.5) * jitter;
        const type = types[idx % types.length];
        const scale = 0.7 + 0.7 * Math.random();
        const yaw = Math.random() * 2 * Math.PI;
        const base_r = (type === 'branch') ? 1.2 : (type === 'fan') ? 1.8 : 1.5;
        const radius = base_r * scale;

        this.obstacles.push({ position: vec3(x, 0, z), radius, type, scale, yaw, glow: idx % 4 === 0 });
        idx++;
      }
    }
  }

  get_obstacles(seafloor = null) {
    return this.obstacles.map(o => {
      const x = o.position[0], z = o.position[2];
      const y = seafloor ? seafloor.get_height(x, z) : 0;
      return { position: vec3(x, y, z), radius: o.radius };
    });
  }

  get_glow_light_data(seafloor = null) {
    return this.obstacles
      .filter(o => o.glow)
      .map(o => {
        const x = o.position[0], z = o.position[2];
        const y = (seafloor ? seafloor.get_height(x, z) : 0) + 1.0 * o.scale;
        const c = this.materials[o.type].glow;
        return { position: vec3(x, y, z), color: vec3(c[0], c[1], c[2]) };
      });
  }

  set_fog(fog_color, fog_density) {
    for (const mat of Object.values(this.materials)) {
      mat.fog_color = fog_color;
      mat.fog_density = fog_density;
    }
  }

  _effective_material(type, night_blend, force_glow = false) {
    const base = this.materials[type];
    const glow_weight = force_glow ? night_blend : night_blend * 0.18;
    const glow = base.glow;
    return {
      ...base,
      ambient: base.ambient * (1 - glow_weight) + (0.92 * glow_weight),
      diffusivity: base.diffusivity * (1 - 0.55 * glow_weight),
      color: color(
        base.color[0] * (1 - glow_weight) + glow[0] * glow_weight,
        base.color[1] * (1 - glow_weight) + glow[1] * glow_weight,
        base.color[2] * (1 - glow_weight) + glow[2] * glow_weight,
        1,
      ),
      fog_color: base.fog_color,
      fog_density: base.fog_density,
    };
  }

  draw(caller, uniforms, seafloor = null, night_blend = 0) {
    for (const o of this.obstacles) {
      const x = o.position[0], z = o.position[2];
      const y = seafloor ? seafloor.get_height(x, z) : 0;
      const base = Mat4.translation(x, y, z)
        .times(Mat4.rotation(o.yaw, 0, 1, 0))
        .times(Mat4.scale(o.scale, o.scale, o.scale));

      const material = this._effective_material(o.type, night_blend, o.glow);
      if (o.type === 'branch') this._draw_branching(caller, uniforms, base, material);
      else if (o.type === 'brain') this._draw_brain(caller, uniforms, base, material);
      else if (o.type === 'tube') this._draw_tubes(caller, uniforms, base, material);
      else if (o.type === 'fan') this._draw_fan(caller, uniforms, base, material);
    }
  }

  _draw_branching(caller, uniforms, m, material) {
    let t = m;
    for (let i = 0; i < 4; i++) {
      const s = 1.0 - i * 0.12;
      const tilt = 0.15 * Math.sin(i * 2.1);
      const seg = t
        .times(Mat4.rotation(tilt, 1, 0, 0))
        .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
        .times(Mat4.scale(0.35 * s, 0.60 * s, 0.35 * s));
      this.shapes.cone.draw(caller, uniforms, seg, material);
      t = t.times(Mat4.translation(0, 0.55 * s, 0));
    }
  }

  _draw_brain(caller, uniforms, m, material) {
    const body = m.times(Mat4.scale(1.15, 0.55, 1.15));
    this.shapes.sphere.draw(caller, uniforms, body, material);
    for (let i = 0; i < 3; i++) {
      const r = 0.80 - i * 0.16;
      const ridge = m
        .times(Mat4.translation(0, 0.05 + i * 0.10, 0))
        .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
        .times(Mat4.scale(r, r, 0.22));
      this.shapes.torus.draw(caller, uniforms, ridge, material);
    }
  }

  _draw_tubes(caller, uniforms, m, material) {
    const offsets = [vec3(0, 0, 0), vec3(0.6, 0, 0.2), vec3(-0.5, 0, 0.4), vec3(0.2, 0, -0.6)];
    for (let i = 0; i < offsets.length; i++) {
      const h = 1.2 + 0.6 * Math.sin(i * 1.7);
      const r = 0.25 + 0.08 * i;
      const tube = m
        .times(Mat4.translation(offsets[i][0], h * 0.5, offsets[i][2]))
        .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
        .times(Mat4.scale(r, h, r));
      this.shapes.cyl.draw(caller, uniforms, tube, material);
    }
  }

  _draw_fan(caller, uniforms, m, material) {
    const stalk = m
      .times(Mat4.translation(0, 0.6, 0))
      .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(0.12, 1.2, 0.12));
    this.shapes.cyl.draw(caller, uniforms, stalk, material);

    for (let i = 0; i < 6; i++) {
      const a = -0.75 + i * 0.30;
      const blade = m
        .times(Mat4.translation(0, 1.35, 0))
        .times(Mat4.rotation(0.9, 1, 0, 0))
        .times(Mat4.rotation(a, 0, 1, 0))
        .times(Mat4.scale(1.0, 0.02, 0.70));
      this.shapes.torus.draw(caller, uniforms, blade, material);
    }
  }
}
