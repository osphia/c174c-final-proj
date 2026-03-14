import {vec3, vec4, color, Mat4, Shape, defs} from './utils.js';

export class Bubble_System {
    constructor() {
        this.shape = new defs.Subdivision_Sphere(2);
        this.material = {
            shader: new defs.Phong_Shader(8),
            ambient: 0.6,
            diffusivity: 0.3,
            specularity: 0.9,
            smoothness: 80,
            color: color(0.7, 0.85, 1.0, 0.5),
        };

        this.max_bubbles = 150;
        this.spawn_timer = 0;
        this.spawn_rate = 0.06;

        // Object pool: pre-allocate all bubbles
        this.bubbles = [];
        for (let i = 0; i < this.max_bubbles; i++) {
            this.bubbles.push({
                active: false,
                position: vec3(0, 0, 0),
                velocity: vec3(0, 0, 0),
                life: 0,
                max_life: 0,
                size: 0,
            });
        }
    }

    spawn_bubble(emitter_pos) {
        for (const b of this.bubbles) {
            if (!b.active) {
                b.active = true;
                b.position = vec3(
                    emitter_pos[0] + (Math.random() - 0.5) * 1.5,
                    emitter_pos[1] + Math.random() * 0.5,
                    emitter_pos[2] + (Math.random() - 0.5) * 1.5,
                );
                b.velocity = vec3(
                    (Math.random() - 0.5) * 0.3,
                    1.5 + Math.random() * 1.0,
                    (Math.random() - 0.5) * 0.3,
                );
                b.life = 0;
                b.max_life = 5 + Math.random() * 4;
                b.size = 0.05 + Math.random() * 0.08;
                return;
            }
        }
    }

    update(dt, fish_positions) {
        if (dt <= 0 || dt > 0.1) return;
        if (!fish_positions || fish_positions.length === 0) return;

        // Spawn bubbles from random fish
        this.spawn_timer -= dt;
        while (this.spawn_timer <= 0) {
            const src = fish_positions[Math.floor(Math.random() * fish_positions.length)];
            this.spawn_bubble(src);
            this.spawn_timer += this.spawn_rate;
        }

        // Update each active bubble
        const buoyancy = vec3(0, 1.8, 0);
        const drag_coeff = 1.2;

        for (const b of this.bubbles) {
            if (!b.active) continue;

            b.life += dt;
            if (b.life > b.max_life || b.position[1] > 25) {
                b.active = false;
                continue;
            }

            const drag = b.velocity.times(-drag_coeff);
            const wobble = vec3(
                (Math.random() - 0.5) * 2.0,
                0,
                (Math.random() - 0.5) * 2.0,
            );
            const accel = buoyancy.plus(drag).plus(wobble);
            b.velocity = b.velocity.plus(accel.times(dt));
            b.position = b.position.plus(b.velocity.times(dt));

            // Bubbles grow slightly as they rise
            b.size += dt * 0.005;
        }
    }

    draw(caller, uniforms) {
        for (const b of this.bubbles) {
            if (!b.active) continue;
            const transform = Mat4.translation(b.position[0], b.position[1], b.position[2])
                .times(Mat4.scale(b.size, b.size, b.size));
            this.shape.draw(caller, uniforms, transform, this.material);
        }
    }
}


export class Plankton_System {
    constructor() {
        this.shape = new defs.Subdivision_Sphere(1);
        this.material = {
            shader: new defs.Phong_Shader(8),
            ambient: 0.8,
            diffusivity: 0.2,
            specularity: 0.0,
            smoothness: 10,
            color: color(0.6, 0.75, 0.5, 0.4),
        };

        // Global slow current direction
        this.current = vec3(0.15, 0, 0.08);

        this.max_particles = 200;
        this.spawn_range = 40; // spawn within this radius of origin
        this.min_y = 1;
        this.max_y = 20;

        this.particles = [];
        for (let i = 0; i < this.max_particles; i++) {
            this.particles.push(this._new_particle());
        }
    }

    _new_particle() {
        return {
            position: vec3(
                (Math.random() - 0.5) * 2 * this.spawn_range,
                this.min_y + Math.random() * (this.max_y - this.min_y),
                (Math.random() - 0.5) * 2 * this.spawn_range,
            ),
            velocity: vec3(0, 0, 0),
            life: Math.random() * 15, // stagger initial ages
            max_life: 12 + Math.random() * 8,
            size: 0.02 + Math.random() * 0.04,
        };
    }

    update(dt) {
        if (dt <= 0 || dt > 0.1) return;

        const drag_coeff = 2.0;

        for (const p of this.particles) {
            p.life += dt;
            if (p.life > p.max_life) {
                // Respawn
                const fresh = this._new_particle();
                p.position = fresh.position;
                p.velocity = vec3(0, 0, 0);
                p.life = 0;
                p.max_life = fresh.max_life;
                p.size = fresh.size;
                continue;
            }

            // Brownian noise + slow current
            const noise = vec3(
                (Math.random() - 0.5) * 1.0,
                (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 1.0,
            );
            const drag = p.velocity.times(-drag_coeff);
            const accel = this.current.plus(noise).plus(drag);
            p.velocity = p.velocity.plus(accel.times(dt));
            p.position = p.position.plus(p.velocity.times(dt));
        }
    }

    draw(caller, uniforms, night_blend = 0) {
        const mat = {
            ...this.material,
            ambient: this.material.ambient * (1 - 0.5 * night_blend) + 0.95 * night_blend,
            diffusivity: this.material.diffusivity * (1 - 0.65 * night_blend),
            color: color(
                this.material.color[0] * (1 - night_blend) + 0.35 * night_blend,
                this.material.color[1] * (1 - night_blend) + 1.00 * night_blend,
                this.material.color[2] * (1 - night_blend) + 0.85 * night_blend,
                this.material.color[3],
            ),
        };
        for (const p of this.particles) {
            const transform = Mat4.translation(p.position[0], p.position[1], p.position[2])
                .times(Mat4.scale(p.size, p.size, p.size));
            this.shape.draw(caller, uniforms, transform, mat);
        }
    }
}
