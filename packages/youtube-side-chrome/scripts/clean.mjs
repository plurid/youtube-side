import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectories = ['distribution', 'distribution-zip'];

for (const directory of outputDirectories) {
    const target = path.resolve(packageRoot, directory);
    if (path.dirname(target) !== packageRoot) {
        throw new Error(`Refusing to remove an unexpected path: ${target}`);
    }

    await rm(target, { recursive: true, force: true });
}
