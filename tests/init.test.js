import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { init, copyDir, getDefaultContentDir } from '../commands/init.js';

describe('init command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getDefaultContentDir', () => {
    it('should return a path that exists', () => {
      const contentDir = getDefaultContentDir();
      expect(fs.existsSync(contentDir)).toBe(true);
    });

    it('should point to the content directory', () => {
      const contentDir = getDefaultContentDir();
      expect(contentDir).toContain('content');
    });
  });

  describe('copyDir', () => {
    it('should copy files from source to destination', () => {
      const srcDir = path.join(tmpDir, 'src');
      const destDir = path.join(tmpDir, 'dest');
      fs.mkdirSync(srcDir);
      fs.mkdirSync(destDir);
      fs.writeFileSync(path.join(srcDir, 'test.txt'), 'hello');

      copyDir(srcDir, destDir);

      expect(fs.existsSync(path.join(destDir, 'test.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(destDir, 'test.txt'), 'utf-8')).toBe('hello');
    });

    it('should recursively copy subdirectories', () => {
      const srcDir = path.join(tmpDir, 'src');
      const destDir = path.join(tmpDir, 'dest');
      fs.mkdirSync(srcDir);
      fs.mkdirSync(destDir);
      fs.mkdirSync(path.join(srcDir, 'sub'));
      fs.writeFileSync(path.join(srcDir, 'sub', 'nested.txt'), 'nested content');

      copyDir(srcDir, destDir);

      expect(fs.existsSync(path.join(destDir, 'sub', 'nested.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(destDir, 'sub', 'nested.txt'), 'utf-8')).toBe('nested content');
    });

    it('should create destination subdirectories if they do not exist', () => {
      const srcDir = path.join(tmpDir, 'src');
      const destDir = path.join(tmpDir, 'dest');
      fs.mkdirSync(srcDir);
      fs.mkdirSync(destDir);
      fs.mkdirSync(path.join(srcDir, 'a', 'b'), { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'a', 'b', 'deep.txt'), 'deep');

      copyDir(srcDir, destDir);

      expect(fs.existsSync(path.join(destDir, 'a', 'b', 'deep.txt'))).toBe(true);
    });
  });

  describe('init', () => {
    it('should copy template content to the destination directory', async () => {
      const contentDir = getDefaultContentDir();
      await init(tmpDir, contentDir);

      // Verify .ai directory was copied
      expect(fs.existsSync(path.join(tmpDir, '.ai'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.ai', 'create-prd.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.ai', 'generate-tasks.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.ai', 'process-tasks.md'))).toBe(true);

      // Verify .claude directory was copied
      expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'orleans'))).toBe(true);
    });

    it('should copy file contents accurately', async () => {
      const contentDir = getDefaultContentDir();
      await init(tmpDir, contentDir);

      const original = fs.readFileSync(path.join(contentDir, '.ai', 'create-prd.md'), 'utf-8');
      const copied = fs.readFileSync(path.join(tmpDir, '.ai', 'create-prd.md'), 'utf-8');
      expect(copied).toBe(original);
    });

    it('should work with a custom content directory', async () => {
      const customContent = path.join(tmpDir, 'custom-content');
      const destDir = path.join(tmpDir, 'project');
      fs.mkdirSync(customContent);
      fs.mkdirSync(destDir);
      fs.writeFileSync(path.join(customContent, 'readme.md'), '# Test');

      await init(destDir, customContent);

      expect(fs.existsSync(path.join(destDir, 'readme.md'))).toBe(true);
      expect(fs.readFileSync(path.join(destDir, 'readme.md'), 'utf-8')).toBe('# Test');
    });
  });
});
