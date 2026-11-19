// Copy the latest ambient-device-visuals sketch (and p5) and regenerate the portable build of it.
// Usage: npm run sync-ambient [path to ambient-device-visuals]
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchSketch} from '../ambient-portable.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ambient=resolve(process.argv[2]||process.env.HARVEY_AMBIENT_DIR||resolve(root,'..','ambient-device-visuals'));
await copyFile(resolve(ambient,'sketch.js'),resolve(root,'ambient/sketch.js'));
await copyFile(resolve(ambient,'vendor/p5-2.3.1.min.js'),resolve(root,'vendor/p5-2.3.1.min.js'));
const source=await readFile(resolve(root,'ambient/sketch.js'),'utf8');
await writeFile(resolve(root,'ambient/sketch-portable.js'),patchSketch(source));
console.log(`Synced ambient sketch from ${ambient}`);
