import { Command } from 'commander';

const initCommand = new Command('init')
  .description('Initialize a new project with the template')
  .action(async () => {
    const { init } = await import('../src/init.js');
    await init();
  });

export default initCommand;
