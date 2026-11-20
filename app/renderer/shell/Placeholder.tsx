import { Construction } from 'lucide-react';
import { routeForPath } from '../routes.ts';
import { Page } from '../ui/index.ts';

/** What a screen shows until its ticket replaces it. */
export const Placeholder = ({ path, summary }: { path: string; summary: string }) => {
  const route = routeForPath(path);
  return (
    <Page title={route?.label ?? 'Serra'} subtitle={summary}>
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted">
        <Construction size={18} aria-hidden />
        <span>This screen is not built yet{route ? ` (${route.ticket})` : ''}.</span>
      </div>
    </Page>
  );
};
