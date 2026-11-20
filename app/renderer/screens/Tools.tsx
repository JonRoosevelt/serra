// Tools (MCP) (APP-23): read-only. The MCP servers the worker's provider will load in T3, and a warning when an
// alert trigger needs one that's missing. Servers are added in Claude or Codex, not here; the window only ever gets
// each server's name, scope, transport and host, never its command, environment or headers.
import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, FileWarning, Plug, RefreshCw, TriangleAlert } from 'lucide-react';
import type { McpOverview } from '../../../src/mcp.ts';
import { serra } from '../bridge.ts';
import { Badge, Button, cx, Page, Table, TBody, Td, Th, THead, Tr } from '../ui/index.ts';
import { driverGroups, LOAD_LABELS, providerLine, SCOPE_LABELS, transportLabel, type DriverGroup } from './tools.logic.ts';

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const Group = ({ group }: { group: DriverGroup }) => (
  <section className="flex flex-col gap-3" aria-label={`${group.title} MCP servers`} data-driver={group.driver}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold">{group.title}</h2>
      <span className="text-xs text-muted">{group.summary}</span>
    </div>
    {group.unreadable.map((path) => (
      <p key={path} className="flex items-center gap-2 text-sm text-warn">
        <FileWarning size={15} aria-hidden /> Couldn&apos;t read {path}. Servers in it aren&apos;t listed.
      </p>
    ))}
    {group.servers.length === 0
      ? <p className="rounded-lg border border-dashed border-line px-4 py-5 text-sm text-muted">No MCP servers are set up for {group.title}.</p>
      : (
        <Table>
          <THead>
            <Tr><Th>Server</Th><Th>Status</Th><Th>Scope</Th><Th>Transport</Th></Tr>
          </THead>
          <TBody>
            {group.servers.map((server) => (
              <Tr key={`${server.source}:${server.scope}:${server.name}`} data-server={server.name} data-load={server.load}>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{server.name}</span>
                    <span className="text-xs text-muted">{server.source}</span>
                    {server.note && <span className={cx('text-xs', server.load === 'unsure' ? 'text-warn' : 'text-muted')}>{server.note}</span>}
                  </div>
                </Td>
                <Td><Badge tone={LOAD_LABELS[server.load].tone}>{LOAD_LABELS[server.load].text}</Badge></Td>
                <Td className="text-muted">{SCOPE_LABELS[server.scope]}</Td>
                <Td className="text-muted">{transportLabel(server)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
  </section>
);

export const Tools = () => {
  const [overview, setOverview] = useState<McpOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const bridge = serra();
    if (!bridge) { setError('The Serra bridge is not available in this window.'); return; }
    setLoading(true);
    try { setOverview(await bridge.tools.overview()); setError(null); }
    catch (failure) { setError(errorText(failure)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Page
      title="Tools (MCP)"
      subtitle="The MCP servers the bot's worker gets in T3. Read-only: add or change servers in Claude or Codex, then reload."
      actions={(
        <Button icon={<RefreshCw size={14} aria-hidden className={cx(loading && 'animate-spin')} />} onClick={() => void load()} disabled={loading}>
          Reload
        </Button>
      )}
    >
      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-down/40 px-4 py-3 text-sm text-down">
          <CircleAlert size={16} aria-hidden />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {!overview && !error && <p className="flex items-center gap-2 text-sm text-muted"><Plug size={16} aria-hidden /> Reading the MCP configs…</p>}

      {overview && (
        <>
          <div className="flex flex-col gap-1 text-sm">
            <p>{providerLine(overview.worker)}</p>
            {overview.worker.note && <p className="text-muted">{overview.worker.note}</p>}
          </div>

          {overview.warnings.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Missing tools">
              {overview.warnings.map((warning) => (
                <li
                  key={`${warning.driver}:${warning.tool}`}
                  role="alert"
                  className="flex items-start gap-3 rounded-lg border border-warn/50 bg-warn/10 px-4 py-3 text-sm"
                  data-missing-tool={warning.tool}
                >
                  <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-warn" />
                  <span>{warning.text}</span>
                </li>
              ))}
            </ul>
          )}

          {driverGroups(overview).map((group) => <Group key={group.driver} group={group} />)}

          <p className="text-xs text-muted">
            Servers added through claude.ai connectors or plugins aren&apos;t in these files and aren&apos;t listed here.
          </p>
        </>
      )}
    </Page>
  );
};
