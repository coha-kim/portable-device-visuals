// v13: keep intensity and duration independent for the deformable membrane.
import { PalmInteraction as PreviousInteraction } from './interaction-v11.mjs';
export { VectorMotionReader } from './interaction-v11.mjs';
export class PalmInteraction extends PreviousInteraction {
 get deformation(){return this.intensity;}
}
