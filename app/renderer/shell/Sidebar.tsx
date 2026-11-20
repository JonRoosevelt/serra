import type { ComponentType } from 'react';
import { NavLink } from 'react-router';
import {
  Activity, Bell, BookOpen, Box, Check, Cpu, Download, FileText, KeyRound, Layers, LoaderCircle, ScrollText,
  SquarePen, SquareTerminal, SunMoon, TriangleAlert, Users, type LucideProps,
} from 'lucide-react';
import type { BotStatus } from '../../../src/contracts.ts';
import { badgeText, badgeTone, type BadgeCounts } from '../badges.logic.ts';
import { routes, sections, type RouteId } from '../routes.ts';
import { statusHeader, statusView, type StatusTone } from '../status.logic.ts';
import { Badge, cx } from '../ui/index.ts';
import { OPEN_COMMAND_PALETTE } from './events.ts';
import downIcon from '../../../assets/brand/serra-status-down.png';
import needsYouIcon from '../../../assets/brand/serra-status-needs-you.png';
import upIcon from '../../../assets/brand/serra-status-up.png';

const icons: Record<RouteId, ComponentType<LucideProps>> = {
  'jobs-needs-you': TriangleAlert,
  // A still icon: the sidebar never animates. Spinners are for rows the daemon reports as running.
  'jobs-running': LoaderCircle,
  'jobs-done': Check,
  'new-task': SquarePen,
  proposals: FileText,
  pages: BookOpen,
  brief: ScrollText,
  'settings-bot': Activity,
  'settings-people': Users,
  'settings-repositories': Layers,
  'settings-alerts': Bell,
  'settings-worker': Cpu,
  secrets: KeyRound,
  tools: Box,
  updates: Download,
  diagnostics: SquareTerminal,
  'settings-appearance': SunMoon,
};

// Before the first status report there is no honest colour, so the icon is shown greyed out.
const statusIcons: Record<StatusTone, string> = { up: upIcon, 'needs-you': needsYouIcon, down: downIcon, unknown: downIcon };

const StatusHeader = ({ status }: { status: BotStatus | null }) => {
  const view = statusView(status);
  return (
    <div className="flex items-center gap-2.5 px-3 pt-4 pb-3" title={view.detail} data-status-tone={view.tone}>
      <img src={statusIcons[view.tone]} alt="" className={cx('size-6 rounded-md', view.tone === 'unknown' && 'opacity-40 grayscale')} />
      <span className="font-semibold" role="status" aria-label={`Serra: ${view.detail}`}>{statusHeader(view)}</span>
    </div>
  );
};

export const Sidebar = ({ status, counts }: { status: BotStatus | null; counts: BadgeCounts }) => (
  <aside data-serra-sidebar className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
    <StatusHeader status={status} />
    <nav aria-label="Screens" className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
      {sections.map((section) => {
        const items = routes.filter((route) => route.section === section.id);
        return (
          <div key={section.id} className={cx('flex flex-col gap-0.5 pt-2', section.id === 'settings' && 'mt-2 border-t border-line pt-3')}>
            {section.heading && <h2 className="px-2 pb-1 text-xs font-medium text-muted">{section.heading}</h2>}
            {items.map((route) => {
              const Icon = icons[route.id];
              const badge = 'badge' in route ? route.badge : undefined;
              const text = badge ? badgeText(counts[badge]) : null;
              return (
                <NavLink
                  key={route.id}
                  to={route.path}
                  data-route={route.id}
                  className={({ isActive }) => cx(
                    'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm',
                    'focus-visible:outline-2 focus-visible:outline-accent',
                    isActive ? 'bg-accent/15 font-medium text-ink' : 'text-ink/85 hover:bg-raised',
                  )}
                >
                  <Icon size={16} aria-hidden className="shrink-0 text-muted" />
                  <span className="flex-1 truncate">{route.label}</span>
                  {badge && text && <Badge shape="count" tone={badgeTone(badge)}>{text}</Badge>}
                </NavLink>
              );
            })}
          </div>
        );
      })}
    </nav>
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
      className="m-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
    >
      <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-xs">⌘K</kbd>
      Command palette
    </button>
  </aside>
);
