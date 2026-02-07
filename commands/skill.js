import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getSkillsDir() {
  return path.join(__dirname, '..', 'skills');
}

export function getAvailableSkills(skillsDir = getSkillsDir()) {
  const skills = [];

  function walk(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const contents = fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true });
        const hasFiles = contents.some((e) => e.isFile());
        if (hasFiles) {
          skills.push(skillPath);
        }
        walk(path.join(dir, entry.name), skillPath);
      }
    }
  }

  walk(skillsDir);
  return skills;
}

export function addSkill(skillName, destDir = process.cwd(), skillsDir = getSkillsDir()) {
  const srcPath = path.join(skillsDir, skillName);

  if (!fs.existsSync(srcPath)) {
    const available = getAvailableSkills(skillsDir);
    console.error(`Error: Skill '${skillName}' not found.`);
    if (available.length > 0) {
      console.error(`\nAvailable skills:\n${available.map((s) => `  ${s}`).join('\n')}`);
    }
    process.exitCode = 1;
    return;
  }

  const targetPath = path.join(destDir, '.claude', 'skills', skillName);
  fs.mkdirSync(targetPath, { recursive: true });

  copySkillDir(srcPath, targetPath, destDir);

  console.log(`\nSkill '${skillName}' added to .claude/skills/${skillName}`);
}

export function removeSkill(skillName, destDir = process.cwd()) {
  const targetPath = path.join(destDir, '.claude', 'skills', skillName);

  if (!fs.existsSync(targetPath)) {
    console.error(`Error: Skill '${skillName}' is not installed at .claude/skills/${skillName}`);
    process.exitCode = 1;
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  console.log(`Skill '${skillName}' removed from .claude/skills/${skillName}`);

  // Clean up empty parent directories up to .claude/skills
  const skillsRoot = path.join(destDir, '.claude', 'skills');
  let parent = path.dirname(targetPath);
  while (parent !== skillsRoot && parent.startsWith(skillsRoot)) {
    const entries = fs.readdirSync(parent);
    if (entries.length === 0) {
      fs.rmdirSync(parent);
      parent = path.dirname(parent);
    } else {
      break;
    }
  }
}

function copySkillDir(src, dest, rootDest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copySkillDir(srcPath, destPath, rootDest);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  Created ${path.relative(rootDest, destPath)}`);
    }
  }
}

const skillCommand = new Command('skill')
  .description('Manage Claude skills');

skillCommand
  .command('add')
  .description('Add a skill to the current project')
  .argument('<name>', 'skill name (e.g. dotnet/orleans)')
  .action(async (name) => {
    addSkill(name);
  });

skillCommand
  .command('remove')
  .description('Remove a skill from the current project')
  .argument('<name>', 'skill name (e.g. dotnet/orleans)')
  .action(async (name) => {
    removeSkill(name);
  });

skillCommand
  .command('list')
  .description('List available skills')
  .action(() => {
    const skills = getAvailableSkills();
    if (skills.length === 0) {
      console.log('No skills available.');
    } else {
      console.log('Available skills:');
      for (const skill of skills) {
        console.log(`  ${skill}`);
      }
    }
  });

export default skillCommand;
