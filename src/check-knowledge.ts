import { createKnowledge, profileRoots, type KnowledgeRoot } from './knowledge.ts';
import { codeRoot, profileArgument, readProfileFile } from './config.ts';
import { join, resolve } from 'node:path';

// Without a profile, check the knowledge template that pnpm run setup copies into new profiles.
const profile = profileArgument();
const { checkKnowledge } = createKnowledge(profile ? join(resolve(profile), 'knowledge') : join(codeRoot, 'templates/knowledge'));

const list = (title: string, items: string[]): void => {
  if (items.length === 0) return;
  console.log(`\n${title}`);
  for (const item of items) console.log(`  ${item}`);
};

/** The profile's checkouts, so paths named in pages can be checked. The template names no real paths. */
const roots = ((): KnowledgeRoot[] => {
  if (!profile) return [];
  try {
    // Only profile.json: checking pages needs no tokens.
    return profileRoots(readProfileFile(resolve(profile)));
  } catch (error) {
    console.log(`Not checking code paths: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
})();

const { problems, pages, unverified, proposals, warnings } = checkKnowledge({ roots });

console.log(`${pages.length} pages, ${pages.length - unverified.length} verified by the owner.`);
list('Not verified yet:', unverified);
list('Proposals waiting for the owner:', proposals);
list('Worth a look (does not fail the check):', warnings);
list('Problems:', problems);

if (problems.length > 0) process.exit(1);
