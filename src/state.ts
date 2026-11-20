import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Job } from './types.ts';

export const createStore = (file: string) => {
  const FILE = file;
  const TMP_FILE = `${file}.tmp`;

  const load = (): Record<string, Job> => {
    const raw = (() => {
      try {
        return readFileSync(FILE, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return null;
      }
    })();
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('state.json is not an object');
    // state.json is only ever written by save() below.
    return parsed as Record<string, Job>;
  };

  const jobs = load();

  const save = (): void => {
    writeFileSync(TMP_FILE, JSON.stringify(jobs, null, 2));
    renameSync(TMP_FILE, FILE);
  };

  const getJob = (key: string): Job | undefined => jobs[key];
  const allJobs = (): [string, Job][] => Object.entries(jobs);
  const putJob = (key: string, job: Job): void => {
    jobs[key] = job;
    save();
  };
  return { getJob, allJobs, putJob };
};

export const slackKey = (channel: string, threadTs: string): string => `${channel}:${threadTs}`;
