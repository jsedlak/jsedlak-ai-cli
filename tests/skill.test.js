import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getSkillsDir,
  getAvailableSkills,
  addSkill,
  removeSkill,
  promptSkillSelection,
} from '../commands/skill.js';

describe('skill command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-skill-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getSkillsDir', () => {
    it('should return a path that exists', () => {
      expect(fs.existsSync(getSkillsDir())).toBe(true);
    });

    it('should point to the skills directory', () => {
      expect(getSkillsDir()).toContain('skills');
    });
  });

  describe('getAvailableSkills', () => {
    it('should list built-in skills', () => {
      const skills = getAvailableSkills();
      expect(skills).toContain('dotnet/orleans');
    });

    it('should list skills from a custom directory', () => {
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(path.join(skillsDir, 'lang', 'python'), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, 'lang', 'python', 'SKILL.md'), '# Python');

      const skills = getAvailableSkills(skillsDir);
      expect(skills).toContain('lang/python');
    });

    it('should not list empty directories as skills', () => {
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(path.join(skillsDir, 'empty', 'skill'), { recursive: true });

      const skills = getAvailableSkills(skillsDir);
      expect(skills).not.toContain('empty/skill');
    });
  });

  describe('addSkill', () => {
    it('should copy skill files to .claude/skills/<name>', () => {
      const skillsDir = path.join(tmpDir, 'skills');
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(path.join(skillsDir, 'dotnet', 'orleans'), { recursive: true });
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(skillsDir, 'dotnet', 'orleans', 'SKILL.md'), '# Orleans');
      fs.writeFileSync(path.join(skillsDir, 'dotnet', 'orleans', 'samples.md'), '# Samples');

      addSkill('dotnet/orleans', projectDir, skillsDir);

      expect(fs.existsSync(path.join(projectDir, '.claude', 'skills', 'dotnet', 'orleans', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, '.claude', 'skills', 'dotnet', 'orleans', 'samples.md'))).toBe(true);
      expect(fs.readFileSync(path.join(projectDir, '.claude', 'skills', 'dotnet', 'orleans', 'SKILL.md'), 'utf-8')).toBe('# Orleans');
    });

    it('should work with the built-in dotnet/orleans skill', () => {
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);

      addSkill('dotnet/orleans', projectDir);

      expect(fs.existsSync(path.join(projectDir, '.claude', 'skills', 'dotnet', 'orleans', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, '.claude', 'skills', 'dotnet', 'orleans', 'samples.md'))).toBe(true);
    });

    it('should set exitCode for a nonexistent skill', () => {
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);

      const originalExitCode = process.exitCode;
      addSkill('nonexistent/skill', projectDir);
      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });
  });

  describe('removeSkill', () => {
    it('should remove an installed skill directory', () => {
      const projectDir = path.join(tmpDir, 'project');
      const skillPath = path.join(projectDir, '.claude', 'skills', 'dotnet', 'orleans');
      fs.mkdirSync(skillPath, { recursive: true });
      fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# Orleans');

      removeSkill('dotnet/orleans', projectDir);

      expect(fs.existsSync(skillPath)).toBe(false);
    });

    it('should clean up empty parent directories', () => {
      const projectDir = path.join(tmpDir, 'project');
      const skillPath = path.join(projectDir, '.claude', 'skills', 'dotnet', 'orleans');
      fs.mkdirSync(skillPath, { recursive: true });
      fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# Orleans');

      removeSkill('dotnet/orleans', projectDir);

      // dotnet/ should be cleaned up since it's now empty
      expect(fs.existsSync(path.join(projectDir, '.claude', 'skills', 'dotnet'))).toBe(false);
      // .claude/skills should still exist
      expect(fs.existsSync(path.join(projectDir, '.claude', 'skills'))).toBe(true);
    });

    it('should not remove sibling skills when removing one', () => {
      const projectDir = path.join(tmpDir, 'project');
      const orleans = path.join(projectDir, '.claude', 'skills', 'dotnet', 'orleans');
      const aspnet = path.join(projectDir, '.claude', 'skills', 'dotnet', 'aspnet');
      fs.mkdirSync(orleans, { recursive: true });
      fs.mkdirSync(aspnet, { recursive: true });
      fs.writeFileSync(path.join(orleans, 'SKILL.md'), '# Orleans');
      fs.writeFileSync(path.join(aspnet, 'SKILL.md'), '# ASP.NET');

      removeSkill('dotnet/orleans', projectDir);

      expect(fs.existsSync(orleans)).toBe(false);
      expect(fs.existsSync(path.join(aspnet, 'SKILL.md'))).toBe(true);
    });

    it('should set exitCode for a skill that is not installed', () => {
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);

      const originalExitCode = process.exitCode;
      removeSkill('nonexistent/skill', projectDir);
      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });
  });

  describe('promptSkillSelection', () => {
    it('should return null when no skills are available', async () => {
      const emptyDir = path.join(tmpDir, 'empty-skills');
      fs.mkdirSync(emptyDir, { recursive: true });

      const result = await promptSkillSelection(emptyDir);
      expect(result).toBeNull();
    });
  });
});
