module.exports = {
  apps: [
    {
      name: 'GSS-Front',
      exec_mode: 'cluster',
      instances: '1', // Or a number of instances
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cron_restart: '2 0 * * *',
      env: {
        PORT: 3003, // Custom port for this instance
      },
    },
  ],
};
