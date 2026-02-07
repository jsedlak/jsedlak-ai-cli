import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, '..', 'bin', 'index.js');

function runCli(args = []) {
  return execFileSync('node', [binPath, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
  });
}

describe('CLI routing', () => {
  it('should show help when --help is passed', () => {
    const output = runCli(['--help']);
    expect(output).toContain('@jsedlak/ai');
    expect(output).toContain('init');
    expect(output).toContain('version');
  });

  it('should show version when --version is passed', () => {
    const output = runCli(['--version']);
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should show version when version subcommand is used', () => {
    const output = runCli(['version']);
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should show help for init subcommand', () => {
    const output = runCli(['init', '--help']);
    expect(output).toContain('Initialize a new project');
  });

  it('should show help for version subcommand', () => {
    const output = runCli(['version', '--help']);
    expect(output).toContain('Show the current version');
  });

  it('should list all available commands in help output', () => {
    const output = runCli(['--help']);
    expect(output).toContain('init');
    expect(output).toContain('version');
    expect(output).toContain('help');
  });

  it('should exit with error for unknown commands', () => {
    expect(() => runCli(['nonexistent'])).toThrow();
  });
});
