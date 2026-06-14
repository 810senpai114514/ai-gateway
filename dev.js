const esbuild = require('esbuild');
const { spawn } = require('node:child_process');

let appProcess = null;
let restarting = false;
let restartQueued = false;
let shuttingDown = false;

function startAppProcess() {
  appProcess = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: process.env,
  });

  appProcess.on('exit', (code, signal) => {
    const expectedShutdown = shuttingDown || restarting;
    if (!expectedShutdown) {
      console.error(
        `[gateway-dev] app exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      );
    }
    appProcess = null;
  });
}

function stopAppProcess() {
  return new Promise((resolve) => {
    if (!appProcess) {
      resolve();
      return;
    }

    const proc = appProcess;
    const done = () => resolve();
    proc.once('exit', done);
    proc.kill('SIGTERM');

    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 3000);
  });
}

async function restartAppProcess() {
  if (shuttingDown) {
    return;
  }

  if (restarting) {
    restartQueued = true;
    return;
  }

  restarting = true;
  await stopAppProcess();
  if (!shuttingDown) {
    startAppProcess();
  }
  restarting = false;

  if (restartQueued) {
    restartQueued = false;
    await restartAppProcess();
  }
}

async function shutdown(context) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await stopAppProcess();
  await context.dispose();
  process.exit(0);
}

async function run() {
  const restartPlugin = {
    name: 'restart-on-build',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) {
          console.error('[gateway-dev] build failed, app restart skipped.');
          return;
        }

        await restartAppProcess();
      });
    },
  };

  const context = await esbuild.context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/index.js',
    minify: false,
    sourcemap: true,
    external: ['fastify', 'ws'],
    plugins: [restartPlugin],
  });

  await context.watch();
  console.log('[gateway-dev] watch mode started');

  process.on('SIGINT', () => {
    void shutdown(context);
  });
  process.on('SIGTERM', () => {
    void shutdown(context);
  });
}

run().catch((error) => {
  console.error('[gateway-dev] failed to start:', error);
  process.exit(1);
});
