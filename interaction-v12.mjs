// v12: orientation changes passive gravity; held input still gates shaking/fade.
import { PalmInteraction as PreviousInteraction } from './interaction-v11.mjs';
export { VectorMotionReader } from './interaction-v11.mjs';
export class PalmInteraction extends PreviousInteraction {
  motion(now) {
    const input=super.motion(now),fresh=now-this.tiltAt<=800;
    return {...input,hasTilt:fresh,tiltX:fresh?this.tilt.x:0,tiltY:fresh?this.tilt.y:0};
  }
  clearTestTilt(){this.tiltAt=-Infinity;}
}
