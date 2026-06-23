import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = Number(process.env.PORT || 8080);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectMarker = path.basename(projectRoot).toLowerCase();

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* espera activa breve */
  }
}

function getListeningPid(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of output.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const pid = Number.parseInt(line.trim().split(/\s+/).at(-1), 10);
        if (Number.isFinite(pid) && pid > 0) return pid;
      }
      return null;
    }

    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pid = Number.parseInt(output.trim().split('\n')[0], 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function getProcessCommand(pid) {
  try {
    if (process.platform === 'win32') {
      return execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\").CommandLine"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
    }
    return execSync(`ps -p ${pid} -o command=`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function isStaleNextDevServer(pid) {
  const command = getProcessCommand(pid).toLowerCase();
  if (!command) return false;

  const normalizedRoot = projectRoot.toLowerCase();
  const isThisProject =
    command.includes(normalizedRoot) || command.includes(projectMarker);

  const isNextRuntime =
    isThisProject &&
    (command.includes('node_modules\\next') ||
      command.includes('node_modules/next') ||
      command.includes('start-server.js') ||
      (command.includes('next') && command.includes('dev')));

  return isNextRuntime;
}

function stopProcess(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
      sleep(1500);
      try {
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ya terminó */
      }
    }
  } catch {
    /* proceso ya no existe */
  }
}

function ensurePortAvailable() {
  const pid = getListeningPid(PORT);
  if (!pid) return;

  if (isStaleNextDevServer(pid)) {
    console.log(
      `[dev] Puerto ${PORT} ocupado por una instancia anterior de Next.js (PID ${pid}). Reiniciando...`
    );
    stopProcess(pid);
    sleep(2000);

    const remaining = getListeningPid(PORT);
    if (remaining) {
      console.error(
        `[dev] No se pudo liberar el puerto ${PORT} (PID ${remaining}). Cierra esa terminal o proceso e inténtalo de nuevo.`
      );
      process.exit(1);
    }
    return;
  }

  console.error(
    `[dev] El puerto ${PORT} está en uso por otro proceso (PID ${pid}). Libéralo antes de ejecutar npm run dev.`
  );
  process.exit(1);
}

function startNextDev() {
  const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(nextBin)) {
    console.error('[dev] No se encontró Next.js. Ejecuta npm install primero.');
    process.exit(1);
  }

  const child = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT), '--turbopack'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
}

ensurePortAvailable();
startNextDev();
