import {defs} from './examples/common.js';

const Minimal_Webgl_Demo = defs.Minimal_Webgl_Demo;
import {Axes_Viewer, Axes_Viewer_Test_Scene, Matrix_Game}
    from "./examples/axes-viewer.js";
import {Demonstration}
    from "./examples/demonstration.js";
import {Inertia_Demo, Collision_Demo}
    from "./examples/collisions-demo.js";
import {Many_Lights_Demo}
    from "./examples/many-lights-demo.js";
import {Obj_File_Demo}
    from "./examples/obj-file-demo.js";
import {Parametric_Surfaces}
    from "./examples/parametric-surfaces.js";
import {Scene_To_Texture_Demo}
    from "./examples/scene-to-texture-demo.js";
import {Text_Demo}
    from "./examples/text-demo.js";
import {Transforms_Sandbox_Base, Transforms_Sandbox}
    from "./examples/transforms-sandbox.js";

import {Final_Project} from "./final-project.js";

Object.assign (defs,
    {Minimal_Webgl_Demo},
    {Axes_Viewer, Axes_Viewer_Test_Scene, Matrix_Game},
    {Demonstration},
    {Inertia_Demo, Collision_Demo},
    {Many_Lights_Demo},
    {Obj_File_Demo},
    {Parametric_Surfaces},
    {Scene_To_Texture_Demo},
    {Text_Demo},
    {Transforms_Sandbox_Base, Transforms_Sandbox},
    {Final_Project}
);

// ******************** SELECT THE DEMO TO DISPLAY:

const main_scene        = Final_Project;
const additional_scenes = [];

export {main_scene, additional_scenes, defs};
