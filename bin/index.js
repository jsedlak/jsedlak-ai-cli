#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import initCommand from '../commands/init.js';
import skillCommand from '../commands/skill.js';
import versionCommand from '../commands/version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('@jsedlak/ai')
  .description('CLI to scaffold agent-tasking templates')
  .version(pkg.version);

program.addCommand(initCommand);
program.addCommand(skillCommand);
program.addCommand(versionCommand);

program.parse();
