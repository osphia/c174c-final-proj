# CS 174C: Final Project — Interactive Underwater Environment

An interactive underwater coral reef simulation built with the [tiny-graphics](https://github.com/encyclopedia-of-code/tiny-graphics-js) WebGL library.

## Running the Project

Open `index.html` in a local web server (e.g. `python3 -m http.server` then navigate to `localhost:8000`). Opening the file directly via `file://` will block ES module imports.

## Controls

| Input | Action |
|-------|--------|
| Click canvas | Lock pointer / enter swim mode |
| W / S | Swim forward / backward |
| A / D | Strafe left / right |
| Space | Ascend |
| Z | Descend |
| Mouse | Look around |

## Implemented Features

### Environment & Lighting
- **Procedural seafloor** — sine-wave terrain mesh (60×60 grid) with a custom GLSL sand shader featuring procedural ripple and grain texture
- **Coral reef** — four coral types (branching, brain, tube, fan) scattered in concentric rings; each sits on the terrain surface
- **Underwater lighting** — two directional sun lights with exponential distance fog applied in every shader to simulate light attenuation with depth
- **Particle systems** — rising bubble columns anchored to the seafloor and drifting plankton floating in the water column

### Fish Schools (Algorithms 1 & 3)

**Algorithm 3 — Articulated Fish Model (Forward Kinematics)**

Each fish is a 7-part hierarchical figure drawn entirely from a single `Subdivision_Sphere` scaled into different shapes:

```
Body (ellipsoid)
├── Tail Segment 1  →  Tail Segment 2  →  Tail Fin (flattened)
├── Left Pectoral Fin
├── Right Pectoral Fin
└── Dorsal Fin
```

Each tail joint rotates by `θ = A · sin(ωt + i · φ)` where `i` is the segment index and `φ = π/3` is the phase delay between joints. This phase delay is what produces the S-curve travelling wave down the fish's body. Pectoral fins flap around the Z axis; the dorsal fin sways slightly.

**Algorithm 1 — Reynolds Boids Flocking**

Each fish independently applies three steering rules each frame:

- **Separation** (radius 2.8 u) — steer away from fish that are too close; force magnitude ∝ 1/dist²
- **Alignment** (radius 8 u) — match the average velocity direction of nearby schoolmates
- **Cohesion** (radius 15 u) — steer toward the center of mass of the local group

Extended with:
- **Obstacle avoidance** — repulsion from each coral's position and radius, plus the player camera as a dynamic obstacle
- **Soft boundary walls** — gentle restoring force when fish approach the edge of the play volume

Three independent schools (30 fish total):
| School | Count | Color | Size |
|--------|-------|-------|------|
| Orange | 10 | `rgb(255, 128, 51)` | 0.8 |
| Cyan | 12 | `rgb(77, 217, 255)` | 0.6 |
| Yellow | 8 | `rgb(242, 230, 51)` | 1.1 |

### Creatures & Curves (Catmull-Rom Splines)

- **Jellyfish school** — pulsing bell animation with trailing tentacles; multiple jellyfish drift along spline paths
- **Sea turtle** — follows a Catmull-Rom spline loop through the reef with smooth orientation interpolation along the tangent
- **Manta ray** — large articulated ray gliding on a wide spline circuit above the reef; wing-flap driven by forward kinematics

All creature paths use Catmull-Rom splines for C¹-continuous motion with natural acceleration and deceleration through control points.

## File Structure

```
final-project.js          # Main scene (Final_Project class)
underwater/
├── index.js              # Re-exports all underwater modules
├── camera.js             # First-person underwater camera (WASD + mouse)
├── environment.js        # Seafloor terrain + sand shader
├── coral.js              # Coral collection + Phong-fog shader
├── particles.js          # Bubble and plankton particle systems
├── creatures.js          # Jellyfish, Sea Turtle, Manta Ray + Catmull-Rom helpers
├── fish.js               # Fish model, boid flocking, Fish_Manager
├── shaders.js            # Underwater_Shader base
└── utils.js              # Re-exports from tiny-graphics
examples/
├── common.js             # tiny-graphics entry point (tiny + defs)
├── common-shapes.js      # Built-in shape primitives
└── common-shaders.js     # Phong_Shader and other base shaders
```

## Team

CS 174C — Winter 2026, UCLA
