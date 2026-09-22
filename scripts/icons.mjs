import sharp from 'sharp';
// Deterministic derivatives of the repo-native SVG mark; no external assets.
await Promise.all([192, 512].map(size => sharp('public/icon.svg').resize(size, size).png().toFile(`public/icon-${size}.png`)));
