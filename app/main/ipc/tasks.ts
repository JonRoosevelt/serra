// New task (APP-25) and the knowledge interview (APP-26), on src/tasks.ts. Handlers only check what the window sent and call the service, which starts the
// T3 thread exactly as the daemon does for a Slack request. The profile's tokens are never read here: a task needs no
// Slack, and nothing from the config but the thread's details goes back to the window.
import { previewInterview, previewTask, startInterview, startTask, taskRequest, type TaskDeps } from '../../../src/tasks.ts';
import type { Handlers } from '../bridge.ts';
import type { HandlerContext } from './context.ts';

export const tasksHandlers = (context: HandlerContext, deps: TaskDeps = {}): Handlers<'tasks'> => {
  // One start at a time, task or interview: a double click must not start two threads.
  let starting = false;
  const once = async <T>(start: () => Promise<T>): Promise<T> => {
    if (starting) throw new Error('A task is already starting.');
    starting = true;
    try {
      return await start();
    } finally {
      starting = false;
    }
  };
  return {
    preview: (request) => previewTask(context.profileDir(), request),
    start: async (request) => {
      const text = taskRequest(request);
      return once(() => startTask(context.profileDir(), text, deps));
    },
    previewInterview: () => previewInterview(context.profileDir(), deps.now?.()),
    startInterview: () => once(() => startInterview(context.profileDir(), deps)),
  };
};
