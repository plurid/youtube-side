import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distributionDirectory = path.join(packageRoot, 'distribution');
const sourceManifest = JSON.parse(
    await readFile(path.join(packageRoot, 'source', 'manifest.json'), 'utf8'),
);
const manifest = JSON.parse(
    await readFile(path.join(distributionDirectory, 'manifest.json'), 'utf8'),
);

const expectedFiles = new Set([
    'LICENSE',
    'assets/icons/icon.png',
    'assets/icons/icon16.png',
    'assets/icons/icon32.png',
    'assets/icons/icon48.png',
    'assets/icons/icon128.png',
    'contentscript.js',
    'manifest.json',
    'popup.html',
    'popup.js',
]);

const listFiles = async (directory, prefix = '') => {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFiles(path.join(directory, entry.name), relativePath)));
        } else {
            files.push(relativePath);
        }
    }
    return files.sort();
};

const actualFiles = await listFiles(distributionDirectory);
const unexpectedFiles = actualFiles.filter((file) => !expectedFiles.has(file));
const missingFiles = [...expectedFiles].filter((file) => !actualFiles.includes(file));
if (unexpectedFiles.length > 0 || missingFiles.length > 0) {
    throw new Error(
        `Invalid package contents. Unexpected: ${unexpectedFiles.join(', ') || 'none'}; missing: ${missingFiles.join(', ') || 'none'}`,
    );
}

// the manifest version is the Chrome Web Store lineage and is decoupled
// from the npm package version; the store requires it to strictly increase
if (!/^\d+(\.\d+){1,3}$/.test(manifest.version)) {
    throw new Error(`Manifest version ${manifest.version} is not a valid Chrome version`);
}
if (manifest.version !== sourceManifest.version) {
    throw new Error(
        `Built manifest version ${manifest.version} does not match source manifest version ${sourceManifest.version}`,
    );
}

const assertBundleSize = async (filename, rawLimit, gzipLimit) => {
    const contents = await readFile(path.join(distributionDirectory, filename));
    const gzipSize = gzipSync(contents, { level: 9 }).byteLength;
    if (contents.byteLength > rawLimit || gzipSize > gzipLimit) {
        throw new Error(
            `${filename} exceeds its budget: ${contents.byteLength}/${rawLimit} raw, ${gzipSize}/${gzipLimit} gzip`,
        );
    }
};

await assertBundleSize('contentscript.js', 25_000, 8_000);
await assertBundleSize('popup.js', 450_000, 140_000);

const archivePath = path.join(
    packageRoot,
    'distribution-zip',
    `youtube-side-v${manifest.version}.zip`,
);
const archiveSize = (await stat(archivePath)).size;
if (archiveSize > 220_000) {
    throw new Error(`Archive exceeds its 220000 byte budget: ${archiveSize}`);
}

console.info(`Verified production package ${manifest.version} (${archiveSize} bytes)`);
