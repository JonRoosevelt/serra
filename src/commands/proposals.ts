import { join } from 'node:path';
import type { Command } from '../manage.ts';
import { createProposals, type ProposalChange } from '../proposals.ts';

const USAGE = [
  'pnpm bot proposals --profile /absolute/profile                          list proposals waiting for the owner',
  'pnpm bot proposals show <proposal> --profile /absolute/profile           print the target page and the proposal',
  'pnpm bot proposals promote <proposal> --folder owner [--name page.md] [--when "..."] [--gives "..."] --profile ...',
  'pnpm bot proposals merge <proposal> --into owner/role.md --profile ...',
  'pnpm bot proposals discard <proposal> --profile ...',
  'pnpm bot proposals undo <backup-id> --profile ...',
];

const done = (change: ProposalChange): string => {
  const what = change.action === 'promote' ? `Promoted to knowledge/${change.page}`
    : change.action === 'merge' ? `Merged into knowledge/${change.page}`
    : `Discarded ${change.proposal}`;
  return `${what}.\nUndo with: pnpm bot proposals undo ${change.id} --profile ...`;
};

const command: Command = {
  summary: 'Review knowledge proposals: list, show, promote, merge, discard, undo.',
  usage: USAGE,
  async run({ args, option, profileDir, log }) {
    const service = createProposals({ knowledgeDir: join(profileDir, 'knowledge') });
    // Positional arguments are the words after `proposals` that aren't flags or flag values.
    const positional = args.slice(1).filter((arg, index, rest) => !arg.startsWith('--') && !rest[index - 1]?.startsWith('--'));
    const [action = 'list', target] = positional;
    const needTarget = (what: string): string => {
      if (!target) throw new Error(`Name the ${what}. Usage:\n${USAGE.join('\n')}`);
      return target;
    };

    switch (action) {
      case 'list': {
        const proposals = service.listProposals();
        if (proposals.length === 0) { log('No proposals waiting.'); return; }
        log(`${proposals.length} proposal${proposals.length === 1 ? '' : 's'} waiting:`);
        for (const proposal of proposals) {
          const into = proposal.target ? ` (changes ${proposal.target})` : '';
          log(`  ${proposal.path}${into}${proposal.description ? ` - ${proposal.description}` : ''}`);
        }
        return;
      }
      case 'show': {
        const diff = service.readProposal(needTarget('proposal'));
        log(diff.current === null ? '(new page)' : `--- current: knowledge/${diff.proposal.target}\n${diff.current}`);
        log(`--- proposed: knowledge/proposals/${diff.proposal.path}\n${diff.proposed}`);
        return;
      }
      case 'promote': {
        const folder = option('--folder');
        if (!folder) throw new Error('--folder is required, like --folder owner');
        const name = option('--name'); const when = option('--when'); const gives = option('--gives');
        log(done(service.promoteProposal(needTarget('proposal'), {
          folder, ...(name ? { name } : {}), ...(when ? { when } : {}), ...(gives ? { gives } : {}),
        })));
        return;
      }
      case 'merge': {
        const into = option('--into');
        if (!into) throw new Error('--into is required, like --into owner/role.md');
        log(done(service.mergeProposal(needTarget('proposal'), { into })));
        return;
      }
      case 'discard':
        log(done(service.discardProposal(needTarget('proposal'))));
        return;
      case 'undo': {
        const change = service.undoProposalChange(needTarget('backup ID'));
        log(`Undid the ${change.action} of ${change.proposal}.`);
        return;
      }
      default:
        throw new Error(`Unknown proposals action: ${action}. Usage:\n${USAGE.join('\n')}`);
    }
  },
};
export default command;
