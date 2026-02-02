import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO = 'jsedlak/agent-tasking';
const EXCLUDE_FILES = ['README.md'];

export async function init() {
  const cwd = process.cwd();

  // Check if directory has files (other than common ones)
  const existingFiles = fs.readdirSync(cwd).filter(f =>
    !['.git', '.DS_Store', 'node_modules'].includes(f)
  );

  if (existingFiles.length > 0) {
    console.log('Warning: Current directory is not empty.');
    console.log('Files found:', existingFiles.join(', '));
    console.log('');
  }

  console.log('Downloading template from', REPO, '...');

  try {
    // Use degit to clone without git history
    execSync(`npx --yes degit ${REPO} . --force`, {
      stdio: 'inherit',
      cwd
    });

    // Remove excluded files
    for (const file of EXCLUDE_FILES) {
      const filePath = path.join(cwd, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Removed ${file}`);
      }
    }

    console.log('');
    console.log('Done! Template initialized successfully.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Review the files added to your project');
    console.log('  2. Install dependencies if needed');

  } catch (error) {
    if (error.message.includes('degit')) {
      console.error('Failed to download template. Make sure you have internet access.');
    }
    throw error;
  }
}
