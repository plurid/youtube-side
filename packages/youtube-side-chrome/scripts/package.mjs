import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ZipArchive } from 'archiver';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distributionDirectory = path.join(packageRoot, 'distribution');
const archiveDirectory = path.join(packageRoot, 'distribution-zip');

const manifest = JSON.parse(
    await readFile(path.join(distributionDirectory, 'manifest.json'), 'utf8'),
);
const archivePath = path.join(archiveDirectory, `youtube-side-v${manifest.version}.zip`);

await rm(archiveDirectory, { recursive: true, force: true });
await mkdir(archiveDirectory, { recursive: true });

const output = createWriteStream(archivePath);
const archive = new ZipArchive({ zlib: { level: 9 } });
const completed = new Promise((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
});

archive.pipe(output);
archive.directory(distributionDirectory, false);
await archive.finalize();
await completed;

console.info(`Packaged ${path.relative(packageRoot, archivePath)} (${archive.pointer()} bytes)`);
