// Settings › Worker › Agent backend: which agent new work runs on, T3 (the default) or an ACP agent found on this Mac,
// and that agent's model. One picker and one field. Reads files and PATH only; it applies to the next job or run, and
// a job already going stays on the backend it started on.
import { useEffect, useState } from 'react';
import type { AgentBackendView } from '../../../../src/agent/acp-agents.ts';
import { serra } from '../../bridge.ts';
import { Button, useToast } from '../../ui/index.ts';

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const AgentBackendCard = () => {
  const toast = useToast();
  const [view, setView] = useState<AgentBackendView | null>(null);
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const bridge = serra();
    if (!bridge) return;
    bridge.meetings.agentBackend().then(setView, (failure: unknown) => toast({ message: message(failure), tone: 'error' }));
  }, [toast]);
  const agent = view?.backend === 'acp' ? view.agent : null;
  useEffect(() => { setModel(agent ? view?.models[agent] ?? '' : ''); }, [agent, view]);
  if (!view) return null;
  const value = agent ? `acp:${agent}` : 't3';
  const save = async (choice: { backend: 't3' } | { backend: 'acp'; agent: string; model?: string }): Promise<void> => {
    const bridge = serra();
    if (!bridge) return;
    setSaving(true);
    try { setView(await bridge.meetings.setAgentBackend(choice)); } catch (failure) { toast({ message: message(failure), tone: 'error' }); } finally { setSaving(false); }
  };
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Agent backend</h2>
        <p className="text-sm text-muted">Runs new jobs, tasks, meetings and the weekly review.</p>
      </header>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="agent-backend">Run on</label>
          <select
            id="agent-backend"
            className="h-9 min-w-56 rounded-md border border-line-control bg-panel px-2 text-sm text-ink focus:outline-2 focus:outline-offset-1 focus:outline-focus disabled:opacity-60"
            value={value}
            disabled={saving}
            onChange={(event) => void save(event.target.value === 't3' ? { backend: 't3' } : { backend: 'acp', agent: event.target.value.slice(4) })}
          >
            <option value="t3">T3 (default)</option>
            <optgroup label="ACP agent">
              {view.agents.map((choice) => (
                <option key={choice.id} value={`acp:${choice.id}`} disabled={!choice.installed}>
                  {choice.installed ? choice.name : `${choice.name} (not installed)`}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        {agent && (
          <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void save({ backend: 'acp', agent, model }); }}>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="agent-model">Model</label>
              <input
                id="agent-model"
                className="h-9 w-48 rounded-md border border-line-control bg-panel px-2 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-focus"
                value={model}
                placeholder="Agent default"
                onChange={(event) => setModel(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={saving || model === (view.models[agent] ?? '')}>Save</Button>
          </form>
        )}
      </div>
      {agent && <p className="text-[13px] text-muted">No steering mid-turn: a message waits for the turn to end.</p>}
    </section>
  );
};
