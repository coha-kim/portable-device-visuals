// "Tap near the ambient" detection, ready for the hardware. Nothing here reads a radio yet: the
// browser prototype fires the tap from a button, and the ESP32 port will feed NearDetector with the
// Bluetooth signal strength (RSSI, dBm) of the ambient Pi's beacon. Kept free of browser APIs so the
// same rules can be ported to firmware as they are.
// RSSI is noisy, so a tap needs: the smoothed signal above ENTER_DBM, held for DWELL_SECONDS. It then
// fires once, and cannot fire again until the signal has dropped below EXIT_DBM (hysteresis: the user
// moved away) and COOLDOWN_SECONDS have passed. Readings older than STALE_SECONDS count as "away".
// Thresholds are starting points for roughly 5–10 cm; tune them on site with the real boards.
export const ENTER_DBM=-45,EXIT_DBM=-55,DWELL_SECONDS=.8,COOLDOWN_SECONDS=3,SMOOTH_SECONDS=.3,STALE_SECONDS=1;
export class NearDetector {
 constructor({onNear=()=>{}}={}){this.onNear=onNear;this.reset();this.lastFired=-Infinity;}
 reset(){this.level=null;this.lastReading=-Infinity;this.closeSince=null;this.armed=true;}
 // One RSSI reading (dBm) at time `now` (seconds). Returns true when this reading fires a tap.
 reading(rssi,now){
  if(!Number.isFinite(rssi)||!Number.isFinite(now))return false;
  if(now-this.lastReading>STALE_SECONDS)this.reset();
  // Exponential smoothing with a time constant, so uneven reading rates smooth alike.
  const k=this.level===null?1:1-Math.exp(-(now-this.lastReading)/SMOOTH_SECONDS);
  this.level=this.level===null?rssi:this.level+(rssi-this.level)*k;this.lastReading=now;
  if(this.level<EXIT_DBM){this.armed=true;this.closeSince=null;return false;}
  if(this.level<ENTER_DBM){this.closeSince=null;return false;}
  this.closeSince??=now;
  if(!this.armed||now-this.closeSince<DWELL_SECONDS||now-this.lastFired<COOLDOWN_SECONDS)return false;
  this.armed=false;this.lastFired=now;this.onNear();return true;
 }
 // No reading for a while (out of range, beacon off): treat as away.
 tick(now){if(now-this.lastReading>STALE_SECONDS&&this.level!==null)this.reset();}
}
