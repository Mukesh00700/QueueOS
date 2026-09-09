import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The package is `"type": "commonjs"` because the NestJS API requires it, so
 * every `.js` file under it — including the ESM build — would otherwise be read
 * as CommonJS. A nested package.json flips the type for that directory only.
 *
 * Without this, bundlers parse dist/esm as a script, and Next's react-refresh
 * loader injects `import.meta` into a file webpack refuses to treat as a
 * module.
 */
const esmDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'esm');
writeFileSync(join(esmDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
