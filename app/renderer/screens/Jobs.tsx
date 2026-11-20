// The Jobs screen (APP-12): Needs you, Running and Done today, with links out to Slack, T3 and the PR, a channel
// filter and worktree cleanup behind a dry run. It reads the profile's files through the bridge, so it works with the
// daemon stopped, and reloads on every daemon event. No conversation view: that is read in T3.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  CircleCheck, CircleX, CirclePause, ChevronDown, GitBranch, GitPullRequest, Hash, Layers, LoaderCircle, Radio,
  Plus, RefreshCw, TriangleAlert,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import type { CleanupVerdict, JobGroup } from '../../../src/contracts.ts';
import { serra } from '../bridge.ts';
import { routeForPath } from '../routes.ts';
import { useBotStatus } from '../shell/live.ts';
import { Button, Dialog, Page, cx, useToast } from '../ui/index.ts';
import { registerActions } from '../commands/registry.ts';
import {
  ageLabel, channelChoices, CLEANUP_PARAM, cleanupView, cleanupWorktreesAction, EMPTY_TEXT, filterJobs, groupJobs, ICON_LABELS,
  linkButtons, rowDetail, rowIcon, rowParts, verdictLabel, type JobRow, type LinkKind, type RowIcon,
} from './jobs.logic.ts';

const unregister = registerActions([cleanupWorktreesAction]);
import.meta.hot?.dispose(unregister);

/** The current time, ticking so age labels stay right without a reload. */
const useNow = (everyMs: number): Date => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
};

type Load = { state: 'loading' } | { state: 'ready'; rows: JobRow[] } | { state: 'error'; message: string };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The job list, reloaded on daemon events, status changes and window focus. Keeps showing the last list on a failed reload. */
const useJobs = (statusState: string | undefined): { load: Load; reload: () => void } => {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const live = useRef(true);
  const reload = useCallback(() => {
    const bridge = serra();
    if (!bridge) { setLoad({ state: 'error', message: 'Open this screen in the Serra app to see jobs.' }); return; }
    bridge.jobs.list().then(
      (rows) => { if (live.current) setLoad({ state: 'ready', rows }); },
      (error: unknown) => { if (live.current) setLoad((seen) => (seen.state === 'ready' ? seen : { state: 'error', message: message(error) })); },
    );
  }, []);
  useEffect(() => {
    live.current = true;
    reload();
    const bridge = serra();
    // Events come in bursts (a reply is several), so one reload covers each burst.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = (): void => { clearTimeout(timer); timer = setTimeout(reload, 250); };
    const off = bridge?.on.event(soon) ?? (() => {});
    // Slack names main looked up after the last list (APP-29).
    const offNames = bridge?.on.jobs(soon) ?? (() => {});
    window.addEventListener('focus', soon);
    return () => { live.current = false; clearTimeout(timer); off(); offNames(); window.removeEventListener('focus', soon); };
  }, [reload, statusState]);
  return { load, reload };
};

const ROW_ICONS: Record<RowIcon, ReactNode> = {
  'needs-you': <TriangleAlert size={20} className="text-warn" />,
  failed: <CircleX size={20} className="text-down" />,
  running: <LoaderCircle size={20} className="animate-spin text-accent" />,
  paused: <CirclePause size={20} className="text-muted" />,
  done: <CircleCheck size={20} className="text-up" />,
};

const LINK_ICONS: Record<LinkKind, ReactNode> = {
  slack: <Hash size={14} />,
  t3: <Layers size={14} />,
  pr: <GitPullRequest size={14} />,
};

const open = (url: string, onError: (text: string) => void): void => {
  const bridge = serra();
  if (!bridge) return;
  bridge.app.openExternal(url).catch((error: unknown) => onError(message(error)));
};

const JobRowView = ({ job, icon, now, onError, focused = false }: { job: JobRow; icon: RowIcon; now: Date; onError: (text: string) => void; focused?: boolean }) => {
  const { requester, channel, title, tooltip } = rowParts(job);
  const detail = rowDetail(job);
  return (
    <li
      data-job-key={job.key}
      aria-current={focused ? 'true' : undefined}
      className={cx('flex scroll-mt-6 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-panel px-4 py-3', focused ? 'border-accent ring-2 ring-accent/40' : 'border-line')}
    >
      <span className="shrink-0" role="img" aria-label={ICON_LABELS[icon]} title={ICON_LABELS[icon]}>{ROW_ICONS[icon]}</span>
      <div className="flex min-w-[16rem] flex-1 basis-0 flex-col gap-0.5">
        <p className="truncate text-[0.95rem]">
          <span className="font-semibold">{requester}</span>
          <span className="text-muted"> · </span>
          <span className="font-medium">{channel}</span>
          <span className="text-muted"> · </span>
          <span title={tooltip} className={job.title ? undefined : 'text-muted'}>{title}</span>
        </p>
        {detail && <p className={cx('truncate text-sm', icon === 'failed' ? 'text-down' : 'text-warn')} title={detail}>{detail}</p>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-4">
        <span className="w-10 shrink-0 text-right text-sm text-muted tabular-nums" title={new Date(job.lastActivityAt).toLocaleString()}>
          {ageLabel(job.lastActivityAt, now)}
        </span>
        <div className="flex shrink-0 gap-2">
          {linkButtons(job).map((link) => (
            <span key={link.kind} title={link.hint}>
              <Button
                size="sm"
                icon={LINK_ICONS[link.kind]}
                disabled={!link.url}
                aria-label={`${link.label}: ${link.hint}`}
                onClick={() => { if (link.url) open(link.url, onError); }}
              >
                {link.label}
              </Button>
            </span>
          ))}
        </div>
      </div>
    </li>
  );
};

type Cleanup =
  | { step: 'closed' }
  | { step: 'checking' }
  | { step: 'review'; verdicts: CleanupVerdict[] }
  | { step: 'applying'; verdicts: CleanupVerdict[] }
  | { step: 'error'; message: string };

const VerdictList = ({ verdicts, tone }: { verdicts: CleanupVerdict[]; tone: 'remove' | 'keep' }) => (
  <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-sm">
    {verdicts.map((verdict, index) => (
      <li key={`${verdict.threadId}-${index}`} className="flex flex-col rounded-md bg-raised px-3 py-1.5">
        <span className={cx('font-medium', tone === 'remove' && 'text-down')} title={verdict.path ?? undefined}>{verdictLabel(verdict)}</span>
        <span className="text-xs text-muted">{verdict.reason}</span>
      </li>
    ))}
  </ul>
);

/** Clean up worktrees: always a dry run first, and Remove only lists what that dry run allowed. */
const CleanupDialog = ({ cleanup, onClose, onApply }: { cleanup: Cleanup; onClose: () => void; onApply: () => void }) => {
  const verdicts = cleanup.step === 'review' || cleanup.step === 'applying' ? cleanup.verdicts : [];
  const view = cleanupView(verdicts, false);
  const busy = cleanup.step === 'checking' || cleanup.step === 'applying';
  return (
    <Dialog
      open={cleanup.step !== 'closed'}
      onClose={() => { if (!busy) onClose(); }}
      title="Clean up worktrees"
      description="Removes worktrees of jobs quiet for 3 days that are clean, pushed and have no open PR. This is a dry run: nothing is removed until you confirm."
      actions={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="danger"
            disabled={cleanup.step !== 'review' || view.remove.length === 0}
            onClick={onApply}
            icon={cleanup.step === 'applying' ? <LoaderCircle size={14} className="animate-spin" /> : undefined}
          >
            {view.remove.length > 0 ? `Remove ${view.remove.length}` : 'Remove'}
          </Button>
        </>
      )}
    >
      {cleanup.step === 'checking' && (
        <p className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={14} className="animate-spin" /> Checking each job's worktree…</p>
      )}
      {cleanup.step === 'error' && <p role="alert" className="text-sm text-down">{cleanup.message}</p>}
      {(cleanup.step === 'review' || cleanup.step === 'applying') && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{view.summary}</p>
          {view.remove.length > 0 && <VerdictList verdicts={view.remove} tone="remove" />}
          {view.keep.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Kept ({view.keep.length})</summary>
              <div className="mt-2"><VerdictList verdicts={view.keep} tone="keep" /></div>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
};

const ChannelFilter = ({ options, value, onChange }: { options: { value: string; label: string }[]; value: string | null; onChange: (channel: string | null) => void }) => (
  <label className="relative inline-flex items-center">
    <span className="sr-only">Channel</span>
    <Radio size={16} className="pointer-events-none absolute left-3 text-muted" aria-hidden />
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      className="h-9 appearance-none rounded-md border border-line bg-panel pr-9 pl-9 text-sm text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
    >
      <option value="">All channels</option>
      {options.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
    </select>
    <ChevronDown size={16} className="pointer-events-none absolute right-3 text-muted" aria-hidden />
  </label>
);

const PATHS: Record<JobGroup, string> = { 'needs you': '/jobs/needs-you', running: '/jobs/running', done: '/jobs/done' };

/** One screen for the three sidebar items: `group` is the one picked, scrolled to and marked current. */
export const Jobs = ({ group }: { group: JobGroup }) => {
  const status = useBotStatus();
  const navigate = useNavigate();
  const { load, reload } = useJobs(status?.state);
  const now = useNow(30_000);
  const toast = useToast();
  const [channel, setChannel] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState<Cleanup>({ step: 'closed' });
  const sectionRefs = useRef<Partial<Record<JobGroup, HTMLElement | null>>>({});
  const ready = load.state === 'ready';

  // `?job=<key>` (a clicked notification, APP-24) marks that job's row and scrolls to it instead of the section.
  const [search, setSearch] = useSearchParams();
  const focusedKey = search.get('job');
  useEffect(() => { if (focusedKey) setChannel(null); }, [focusedKey]);

  useEffect(() => {
    if (!ready) return;
    const row = focusedKey ? [...document.querySelectorAll<HTMLElement>('[data-job-key]')].find((element) => element.dataset.jobKey === focusedKey) : undefined;
    if (row) row.scrollIntoView({ block: 'start' });
    else sectionRefs.current[group]?.scrollIntoView({ block: 'start' });
  }, [group, ready, focusedKey]);

  const onLinkError = useCallback((text: string) => toast({ message: text, tone: 'error' }), [toast]);

  const startCleanup = (): void => {
    const bridge = serra();
    if (!bridge) return;
    setCleanup({ step: 'checking' });
    bridge.jobs.cleanupWorktrees({ apply: false }).then(
      (verdicts) => setCleanup((current) => (current.step === 'checking' ? { step: 'review', verdicts } : current)),
      (error: unknown) => setCleanup((current) => (current.step === 'checking' ? { step: 'error', message: message(error) } : current)),
    );
  };

  const applyCleanup = (): void => {
    const bridge = serra();
    if (!bridge || cleanup.step !== 'review') return;
    setCleanup({ step: 'applying', verdicts: cleanup.verdicts });
    bridge.jobs.cleanupWorktrees({ apply: true }).then(
      (verdicts) => {
        const view = cleanupView(verdicts, true);
        setCleanup({ step: 'closed' });
        toast({
          message: view.failed.length ? `${view.summary} ${view.failed.map((v) => `${verdictLabel(v)}: ${v.error ?? 'unknown error'}`).join('; ')}` : view.summary,
          tone: view.failed.length ? 'error' : 'success',
        });
        reload();
      },
      (error: unknown) => setCleanup({ step: 'error', message: message(error) }),
    );
  };

  // `?cleanup=1` (⌘K › Clean up worktrees) opens the same dry run as the button, once. Only the parameter
  // appearing triggers it; the dialog's own steps don't.
  const cleanupAsked = search.get(CLEANUP_PARAM) !== null;
  useEffect(() => {
    if (!cleanupAsked) return;
    setSearch((current) => { const next = new URLSearchParams(current); next.delete(CLEANUP_PARAM); return next; }, { replace: true });
    if (cleanup.step === 'closed') startCleanup();
  }, [cleanupAsked]);

  const rows = ready ? load.rows : [];
  const sections = groupJobs(filterJobs(rows, channel));

  return (
    <div data-screen-label={routeForPath(PATHS[group])?.label}>
      <Page
        title="Jobs"
        actions={(
          <>
            <ChannelFilter options={channelChoices(rows, channel)} value={channel} onChange={setChannel} />
            <Button icon={<GitBranch size={16} />} onClick={startCleanup}>Clean up worktrees</Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/jobs/new')}>New task</Button>
          </>
        )}
      >
        {status?.state === 'stopped' && (
          <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-muted">
            The bot is stopped. Jobs come from the profile's files, and nothing is running until it starts again.
          </p>
        )}
        {load.state === 'loading' && <p className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={14} className="animate-spin" /> Loading jobs…</p>}
        {load.state === 'error' && (
          <div role="alert" className="flex items-center justify-between gap-4 rounded-md border border-down/40 px-3 py-2 text-sm text-down">
            <span>{load.message}</span>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>Retry</Button>
          </div>
        )}
        {ready && sections.map((section) => (
          <section
            key={section.group}
            ref={(element) => { sectionRefs.current[section.group] = element; }}
            aria-current={section.group === group ? 'true' : undefined}
            className="flex scroll-mt-6 flex-col gap-2"
          >
            <h2 className="text-lg font-bold">{section.title} ({section.rows.length})</h2>
            {section.rows.length === 0
              ? <p className="text-sm text-muted">{EMPTY_TEXT[section.group]}</p>
              : (
                <ul className="flex flex-col gap-1.5">
                  {section.rows.map((job) => <JobRowView key={job.key} job={job} icon={rowIcon(job, status)} now={now} onError={onLinkError} focused={job.key === focusedKey} />)}
                </ul>
              )}
          </section>
        ))}
        <CleanupDialog cleanup={cleanup} onClose={() => setCleanup({ step: 'closed' })} onApply={applyCleanup} />
      </Page>
    </div>
  );
};
