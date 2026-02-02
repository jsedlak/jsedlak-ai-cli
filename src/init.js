import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function init() {
  const cwd = process.cwd();
  const contentDir = path.join(__dirname, '..', 'content');

  console.log('Initializing project...');

  // Copy all contents from content/ to current directory
  copyDir(contentDir, cwd);

  console.log('');
  console.log('Done! Template files initialized.');
}

function copyDir(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  Created ${path.relative(process.cwd(), destPath)}`);
    }
  }
}
