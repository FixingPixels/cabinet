import type { Command } from "commander";
import path from "path";
import fs from "fs";
import { log, success, error, warning } from "../lib/log.js";
import { findCabinetRoot } from "../lib/paths.js";
import { ensureApp } from "../lib/app-manager.js";
import { openBrowser, npmCommand, spawnChild } from "../lib/process.js";
import {
  parsePort,
  findAvailablePort,
  updateRuntimeService,
  clearRuntimeService,
  readRuntimePorts,
  isProcessAlive,
  originResponds,
} from "../lib/ports.js";
import { VERSION } from "../version.js";

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("Start Cabinet serving the current cabinet directory")
    .option("--app-version <version>", "Override the app version to use")
    .option("--no-open", "Don't open the browser automatically")
    .action(async (opts: { appVersion?: string; open?: boolean }) => {
      try {
        await runCabinet(opts);
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
      }
    });
}

async function runCabinet(opts: { appVersion?: string; open?: boolean }): Promise<void> {
  // 1. Find cabinet root
  const cabinetDir = findCabinetRoot();
  if (!cabinetDir) {
    error('No cabinet found. Run "cabinetai create <name>" first, then cd into it.');
    return;
  }

  const version = opts.appVersion || VERSION;

  console.log(`
  ┌─────────────────────────────┐
  │                             │
  │   📦  Cabinet v${version.padEnd(13)}│
  │   AI-first startup OS       │
  │                             │
  └─────────────────────────────┘
  `);

  log(`Cabinet directory: ${cabinetDir}`);

  // 2. Ensure app is installed
  const appDir = await ensureApp(version);
  log(`App directory: ${appDir}`);

  // 3. Quick doctor: auto-install deps if missing
  if (!fs.existsSync(path.join(appDir, "node_modules", "next"))) {
    log("Installing dependencies...");
    const { spawnSync } = await import("child_process");
    const result = spawnSync(npmCommand(), ["install"], {
      cwd: appDir,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      error("Failed to install dependencies");
    }
  }

  // 4. Check for existing running server for this cabinet
  const existingPorts = readRuntimePorts(cabinetDir);
  if (existingPorts.app?.pid && isProcessAlive(existingPorts.app.pid)) {
    const origin = existingPorts.app.origin;
    if (await originResponds(origin)) {
      success(`Cabinet is already running at ${origin}`);
      if (opts.open !== false) {
        openBrowser(origin);
      }
      return;
    }
  }

  // 5. Find available ports
  const preferredAppPort = parsePort(process.env.CABINET_APP_PORT || process.env.PORT, 4000);
  const preferredDaemonPort = parsePort(process.env.CABINET_DAEMON_PORT, 4100);

  const appPort = await findAvailablePort(preferredAppPort);
  const daemonPort = await findAvailablePort(preferredDaemonPort);

  if (appPort !== preferredAppPort) {
    warning(`App port ${preferredAppPort} is busy, using ${appPort} instead.`);
  }
  if (daemonPort !== preferredDaemonPort) {
    warning(`Daemon port ${preferredDaemonPort} is busy, using ${daemonPort} instead.`);
  }

  const appOrigin = `http://127.0.0.1:${appPort}`;
  const daemonOrigin = `http://127.0.0.1:${daemonPort}`;
  const daemonWsOrigin = `ws://127.0.0.1:${daemonPort}`;

  // 6. Spawn Next.js dev server
  const nextBin = path.join(appDir, "node_modules", "next", "dist", "bin", "next");
  const appEnv = {
    ...process.env,
    CABINET_DATA_DIR: cabinetDir,
    PORT: String(appPort),
    CABINET_APP_PORT: String(appPort),
    CABINET_APP_ORIGIN: appOrigin,
    CABINET_DAEMON_PORT: String(daemonPort),
    CABINET_DAEMON_URL: daemonOrigin,
    CABINET_PUBLIC_DAEMON_ORIGIN: daemonWsOrigin,
  };

  log("Starting Next.js server...");
  const appChild = spawnChild(
    process.execPath,
    [nextBin, "dev", "-p", String(appPort)],
    {
      cwd: appDir,
      stdio: "inherit",
      env: appEnv,
    }
  );

  updateRuntimeService(cabinetDir, "app", {
    port: appPort,
    origin: appOrigin,
    pid: appChild.pid!,
    updatedAt: new Date().toISOString(),
    cabinetDir,
  });

  // 7. Spawn daemon
  const tsxCli = path.join(appDir, "node_modules", "tsx", "dist", "cli.mjs");
  const daemonScript = path.join(appDir, "server", "cabinet-daemon.ts");

  log("Starting daemon...");
  const daemonChild = spawnChild(
    process.execPath,
    [tsxCli, daemonScript],
    {
      cwd: appDir,
      stdio: "inherit",
      env: {
        ...appEnv,
        CABINET_DAEMON_PORT: String(daemonPort),
        CABINET_DAEMON_URL: daemonOrigin,
        CABINET_PUBLIC_DAEMON_ORIGIN: daemonOrigin,
      },
    }
  );

  updateRuntimeService(cabinetDir, "daemon", {
    port: daemonPort,
    origin: daemonOrigin,
    wsOrigin: daemonWsOrigin,
    pid: daemonChild.pid!,
    updatedAt: new Date().toISOString(),
    cabinetDir,
  });

  // 8. Print status
  console.log("");
  success(`Cabinet is running at ${appOrigin}`);
  console.log(`  Daemon: ${daemonOrigin}`);
  console.log(`  Data:   ${cabinetDir}`);
  console.log("");

  // 9. Open browser
  if (opts.open !== false) {
    // Give the server a moment to start before opening
    setTimeout(() => openBrowser(appOrigin), 2000);
  }

  // 10. Handle signals and cleanup
  const children = [appChild, daemonChild];

  const cleanup = () => {
    clearRuntimeService(cabinetDir, "app", appChild.pid!);
    clearRuntimeService(cabinetDir, "daemon", daemonChild.pid!);
  };

  process.on("exit", cleanup);

  process.on("SIGINT", () => {
    for (const child of children) child.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    for (const child of children) child.kill("SIGTERM");
  });

  // Wait for either child to exit
  let exited = 0;
  const onChildExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exited++;
    if (exited === 1) {
      // First child died — kill the other
      for (const child of children) {
        try {
          child.kill("SIGTERM");
        } catch {
          // Already dead
        }
      }
    }
    if (exited >= children.length) {
      cleanup();
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    }
  };

  appChild.on("exit", onChildExit);
  daemonChild.on("exit", onChildExit);
}
