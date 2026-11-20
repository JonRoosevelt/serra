import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

export const processAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
};

/** Profile and Slack identity locks prevent two new daemons from consuming the same work. */
export const acquireLock = (path: string): (() => void) => {
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid lock ${path}. Inspect it before removing it.`);
    if (processAlive(pid)) throw new Error(`Already running as PID ${pid}: ${path}`);
    unlinkSync(path);
  }
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, String(process.pid)); } finally { closeSync(fd); }
  return () => {
    if (existsSync(path) && readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path);
  };
};
