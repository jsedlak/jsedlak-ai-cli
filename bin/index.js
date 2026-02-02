#!/usr/bin/env node

import { init } from '../src/init.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'init':
      await init();
      break;
    case '--version':
    case '-v':
      const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
      console.log(pkg.version);
      break;
    case '--help':
    case '-h':
    default:
      console.log(`
@jsedlak/ai - Scaffold agent-tasking templates

Usage:
  npx @jsedlak/ai init    Initialize a new project with the template
  npx @jsedlak/ai -v      Show version
  npx @jsedlak/ai -h      Show this help
`);
      break;
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
