import { Server } from 'http';
import { prisma } from './prisma.js';
import { realtimeEngine } from './realtimeEngine.js';

export interface ShutdownLogger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface GracefulShutdownOptions {
  server?: Server | { close: (cb: (err?: Error) => void) => void } | null;
  prismaClient?: { $disconnect: () => Promise<void> } | null;
  realtimeEngineInstance?: { stop: () => void } | null;
  logger?: ShutdownLogger;
  timeoutMs?: number;
  onExit?: (code: number) => void;
}

export interface GracefulShutdownController {
  shutdown: (signal?: string) => Promise<number>;
  isShuttingDown: () => boolean;
  cleanup: () => void;
}

/**
 * Creates an idempotent, bounded graceful shutdown controller.
 */
export function createGracefulShutdownHandler(
  options: GracefulShutdownOptions = {}
): GracefulShutdownController {
  let isShuttingDown = false;
  let shutdownPromise: Promise<number> | null = null;

  const logger: ShutdownLogger = options.logger || console;
  const timeoutMs = options.timeoutMs || 5000;
  const onExit = options.onExit || ((code: number) => process.exit(code));

  const shutdown = async (signal = 'SIGTERM'): Promise<number> => {
    // 1. Deduplication guard: ignore concurrent or duplicate shutdown triggers
    if (isShuttingDown && shutdownPromise) {
      logger.warn(`[GracefulShutdown] Shutdown already in progress. Ignoring duplicate signal: ${signal}`);
      return shutdownPromise;
    }

    isShuttingDown = true;
    logger.info(`[GracefulShutdown] Received ${signal}. Initiating graceful shutdown (timeout: ${timeoutMs}ms)...`);

    shutdownPromise = (async (): Promise<number> => {
      let exitCode = 0;
      let forceTimeoutTimer: NodeJS.Timeout | null = null;

      // 2. Safety timeout: force exit if cleanup hangs
      const timeoutPromise = new Promise<void>((resolve) => {
        forceTimeoutTimer = setTimeout(() => {
          logger.error(`[GracefulShutdown] Cleanup exceeded timeout of ${timeoutMs}ms. Forcing exit.`);
          exitCode = 1;
          resolve();
        }, timeoutMs);
        forceTimeoutTimer.unref?.();
      });

      // 3. Execution steps
      const cleanupPromise = (async () => {
        // Step A: Close HTTP server (stop accepting new inbound connections)
        if (options.server && typeof options.server.close === 'function') {
          try {
            await new Promise<void>((resolveClose) => {
              options.server!.close((err) => {
                if (err) {
                  logger.warn(`[GracefulShutdown] Error or server already closed: ${err.message}`);
                } else {
                  logger.info('[GracefulShutdown] HTTP server closed successfully.');
                }
                resolveClose();
              });
            });
          } catch (err: any) {
            logger.error('[GracefulShutdown] Exception while closing HTTP server:', err?.message || err);
            exitCode = 1;
          }
        }

        // Step B: Stop realtime engine (cancel outbox poller & heartbeats)
        const engine = options.realtimeEngineInstance !== undefined ? options.realtimeEngineInstance : realtimeEngine;
        if (engine && typeof engine.stop === 'function') {
          try {
            engine.stop();
            logger.info('[GracefulShutdown] Realtime engine stopped and timers cleared.');
          } catch (err: any) {
            logger.error('[GracefulShutdown] Error stopping realtime engine:', err?.message || err);
            exitCode = 1;
          }
        }

        // Step C: Disconnect database client
        const db = options.prismaClient !== undefined ? options.prismaClient : prisma;
        if (db && typeof db.$disconnect === 'function') {
          try {
            await db.$disconnect();
            logger.info('[GracefulShutdown] Prisma database client disconnected successfully.');
          } catch (err: any) {
            logger.error('[GracefulShutdown] Error disconnecting Prisma client:', err?.message || err);
            exitCode = 1;
          }
        }
      })();

      await Promise.race([cleanupPromise, timeoutPromise]);

      if (forceTimeoutTimer) {
        clearTimeout(forceTimeoutTimer);
      }

      logger.info(`[GracefulShutdown] Cleanup completed with exit code ${exitCode}.`);

      if (typeof onExit === 'function') {
        onExit(exitCode);
      }

      return exitCode;
    })();

    return shutdownPromise;
  };

  return {
    shutdown,
    isShuttingDown: () => isShuttingDown,
    cleanup: () => {
      // No-op for direct controller
    },
  };
}

/**
 * Registers OS signal listeners (SIGTERM and SIGINT) on the Node process.
 * Returns the controller with a cleanup method to unregister listeners.
 */
export function registerGracefulShutdown(
  options: GracefulShutdownOptions = {}
): GracefulShutdownController {
  const controller = createGracefulShutdownHandler(options);

  const sigtermListener = () => {
    controller.shutdown('SIGTERM');
  };

  const sigintListener = () => {
    controller.shutdown('SIGINT');
  };

  process.on('SIGTERM', sigtermListener);
  process.on('SIGINT', sigintListener);

  return {
    ...controller,
    cleanup: () => {
      process.removeListener('SIGTERM', sigtermListener);
      process.removeListener('SIGINT', sigintListener);
    },
  };
}

