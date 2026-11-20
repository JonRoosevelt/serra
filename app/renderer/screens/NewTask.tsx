// New task (APP-25): the owner writes a request and the app starts a T3 thread for it, with the bot's brief and
// knowledge, exactly as the daemon does for a Slack request. The job then shows in Jobs. The worker's replies are read
// in T3: nobody posts them to Slack, since the task never came from there.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Eye, Layers, ListChecks, LoaderCircle, Play } from 'lucide-react';
import type { StartedTask } from '../../../src/tasks.ts';
import { serra } from '../bridge.ts';
import { Button, Page, cx, useToast } from '../ui/index.ts';
import { canStart, requestProblem, startedText, taskLink } from './newTask.logic.ts';

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type Preview = { state: 'closed' } | { state: 'loading' } | { state: 'ready'; text: string; for: string } | { state: 'error'; message: string };

export const NewTask = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<StartedTask | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: 'closed' });
  const problem = requestProblem(request);

  const openLink = (url: string): void => {
    serra()?.app.openExternal(url).catch((failure: unknown) => toast({ message: message(failure), tone: 'error' }));
  };

  const start = (): void => {
    const bridge = serra();
    if (!bridge) { setError('Open this screen in the Serra app to start a task.'); return; }
    if (!canStart(request, busy)) return;
    setBusy(true);
    setError(null);
    bridge.tasks.start(request).then(
      (task) => {
        setStarted(task);
        setRequest('');
        setPreview({ state: 'closed' });
        const link = taskLink(task);
        toast({
          message: startedText(task),
          tone: 'success',
          ...(link ? { action: { label: 'Open in T3', onClick: () => openLink(link) } } : {}),
        });
      },
      (failure: unknown) => setError(message(failure)),
    ).finally(() => setBusy(false));
  };

  const showPreview = (): void => {
    const bridge = serra();
    if (!bridge) { setPreview({ state: 'error', message: 'Open this screen in the Serra app to preview the brief.' }); return; }
    const asked = request;
    setPreview({ state: 'loading' });
    bridge.tasks.preview(asked).then(
      (text) => setPreview({ state: 'ready', text, for: asked }),
      (failure: unknown) => setPreview({ state: 'error', message: message(failure) }),
    );
  };

  const startedLink = started ? taskLink(started) : undefined;
  const stalePreview = preview.state === 'ready' && preview.for !== request;

  return (
    <Page
      title="New task"
      subtitle="Starts a T3 thread with the bot's brief and knowledge, as a chat request would, without going through chat."
      actions={<Button icon={<ListChecks size={16} />} onClick={() => navigate('/jobs/running')}>Jobs</Button>}
    >
      <section className="flex flex-col gap-2">
        <label htmlFor="new-task-request" className="text-sm font-medium">What should the bot do?</label>
        <textarea
          id="new-task-request"
          value={request}
          disabled={busy}
          onChange={(event) => { setRequest(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); start(); }
          }}
          placeholder="Update the onboarding page for the new pricing, and open a PR."
          aria-invalid={problem ? true : undefined}
          aria-describedby="new-task-note"
          className={cx(
            'min-h-[10rem] resize-y rounded-md border bg-panel px-3 py-2 text-sm leading-6 text-ink placeholder:text-muted',
            'focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-50',
            problem ? 'border-down' : 'border-line',
          )}
        />
        <p id="new-task-note" className={cx('text-xs', problem ? 'text-down' : 'text-muted')}>
          {problem ?? 'The worker gets this as the request, with you as the requester. Its replies are in the T3 thread, not in chat. ⌘↩ starts it.'}
        </p>
        {error && <p role="alert" className="text-sm text-down">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!canStart(request, busy)}
            onClick={start}
            icon={busy ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
          >
            {busy ? 'Starting…' : 'Start task'}
          </Button>
          <Button icon={<Eye size={16} />} disabled={busy || !request.trim() || problem !== null} onClick={showPreview}>
            {preview.state === 'ready' ? 'Refresh brief' : 'Show the brief'}
          </Button>
        </div>
      </section>

      {started && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3" aria-live="polite">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate text-sm font-medium">{startedText(started)}</p>
            <p className="text-xs text-muted">It is listed in Jobs while it runs, and under Done once it finishes.</p>
          </div>
          <div className="flex gap-2">
            <span title={startedLink ? 'Open the T3 thread' : "T3 didn't return a link for this thread yet"}>
              <Button size="sm" icon={<Layers size={14} />} disabled={!startedLink} onClick={() => { if (startedLink) openLink(startedLink); }}>T3</Button>
            </span>
            <Button size="sm" icon={<ListChecks size={14} />} onClick={() => navigate('/jobs/running')}>Show in Jobs</Button>
          </div>
        </section>
      )}

      {preview.state !== 'closed' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Brief the worker gets</h2>
          {preview.state === 'loading' && <p className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={14} className="animate-spin" /> Filling the brief…</p>}
          {preview.state === 'error' && <p role="alert" className="text-sm text-down">{preview.message}</p>}
          {preview.state === 'ready' && (
            <>
              {stalePreview && <p className="text-xs text-warn">The request changed since this preview. Refresh it to see the new brief.</p>}
              <pre className="max-h-[32rem] overflow-auto rounded-md border border-line bg-canvas px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-ink">{preview.text}</pre>
            </>
          )}
        </section>
      )}
    </Page>
  );
};
