module.exports = {
  apps: [
    {
      name: 'GSS-Front',
      exec_mode: 'cluster',
      instances: '1', // Or a number of instances
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cron_restart: '2 0 * * *',
      env_local: {
        APP_ENV: 'local', // APP_ENV=local
      },
      env_development: {
        APP_ENV: 'dev', // APP_ENV=dev
      },
      env_production: {
        APP_ENV: 'prod', // APP_ENV=prod
      },
    },
  ],
};
