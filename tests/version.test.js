import { describe, it, expect } from 'vitest';
import { getVersion } from '../commands/version.js';

describe('version command', () => {
  it('should return the version from package.json', () => {
    const version = getVersion();
    expect(version).toBe('0.0.3');
  });

  it('should return a valid semver string', () => {
    const version = getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
