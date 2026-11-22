# Meetings

Serra can keep the decisions from your team's meetings, so tickets, briefs and answers know why things are the way they are. It's off until you turn it on in **Settings › Meetings**.

## Adding a meeting

In your DM with Serra, send a **new message** starting with "remember this meeting", with one of:

- a **Granola** note link (`https://notes.granola.ai/d/…`)
- a **Google Meet** transcript Doc link (`https://docs.google.com/document/d/…`)
- a transcript file: `.txt`, `.md`, `.vtt` or `.srt`, up to 200 KB
- the transcript or summary pasted after the phrase

Serra replies in that thread, then posts a digest: the decisions waiting for you in **Knowledge › Proposals**, plus action items and open questions. Action items stay in the digest; Serra doesn't file tickets from meetings yet. The digest's thread is closed, since its action items aren't checked against the transcript: to act on one, send a new message.

Only your own messages count, and only as a new message in your DM. With capture off, a message of yours anywhere that starts with "remember this meeting" is turned away (its thread closed), so a transcript never reaches a worker by accident.

## What Serra keeps

- Decisions and undated constraints, at most 8 per meeting, as one bullet each under `## Decisions` on a page your team may read, or on one new page under `decisions/`. Never `owner/` or `people/`.
- Each bullet only after you approve it, with the quote and the turns around it in front of you.
- Pending quotes for review, up to 30 days, in the profile folder (not `knowledge/`).
- **Not the transcript.** It's read in memory, secrets are redacted before Claude sees it, and it's never written to disk.

Only team meetings for now: until workers are isolated from the profile folder, any worker could read pending quotes.

## Which provider reads it

Meetings run on **the provider your jobs use**: the T3 provider instance in Settings › Worker, or T3's default when that's empty. Settings › Meetings shows which one, and whether it's ready. Each provider uses its own connections and its own CLI in its strictest no-tools mode:

| Provider | Meetings | How the transcript is read |
|---|---|---|
| Claude | Yes | `claude -p` with no tools, no MCP servers and no saved session |
| Codex | Not yet | `codex exec` in its strictest mode: no user config, a read-only sandbox, every feature that's on turned off, and no tool host. Codex 0.171.0 still offers code-mode and sub-agent tools in that mode, and models call them, so it fails the self-test below. Serra refuses rather than run with tools |
| Cursor, Antigravity, OpenCode and other T3 providers | Not yet | Serra has no adapter for them |

If your jobs run on a provider Serra can't use for meetings, capture is refused. **Serra never moves a meeting to another provider.**

Before any transcript is sent, Serra checks the provider each time:
- it's a build Serra was tested with;
- no managed settings could add hooks or tools;
- a probe of the exact launch confirms no tools. For Claude that's zero tools and zero MCP servers; for Codex it's Codex's own "tool host disabled" notice, read before the model's turn.

Then the same no-tools self-test for every provider, once per binary:
- a synthetic transcript asks the model to read a file in its folder and one outside it, run a command, start a sub-agent and call any tool;
- a direct probe asks it plainly to call every tool it has.

It fails on any tool call, including one that failed closed, and on any trace of either file. Settings › Meetings › Check runs it and shows the result. No transcript is fetched or read through a provider that hasn't passed it.

## Sources

Serra never holds a Granola or Google key. It reads through **your job provider's own connections**:

| Source | Claude | Codex (once it passes the self-test) |
|---|---|---|
| Granola | The Granola connector (claude.ai › Settings › Connectors), or `claude mcp add granola --transport http https://mcp.granola.ai/mcp`, then `/mcp` | `codex mcp add granola --url https://mcp.granola.ai/mcp`, then `codex mcp login granola` |
| Google Meet | The Google Drive connector, signed in | A Google Drive MCP server added with `codex mcp add`. Codex's built-in apps can't be limited to one read tool, so Serra doesn't use them |
| File or paste | Nothing | Nothing |

Granola transcripts need a Business or Enterprise plan. Meet saves transcripts to Drive on Workspace Business Standard and above, when transcription is on. Settings › Meetings › Sources › **Check** shows whether each works now and what to do if not.

To read a meeting, the provider's CLI gets exactly one read tool (Granola's `get_meeting_transcript`, or Drive's `read_file_content`):
- with exactly Serra's arguments;
- with every built-in tool off and every other MCP server off;
- with the meeting's ID as the only input.

Serra takes the transcript from the tool's result and stops the CLI. Claude Code stops before any model sees the result. The Codex fetch is built the same way (the owner's own Codex servers, every other server off), but it only runs once Codex passes the self-test.

## How it's read

Serra's checks narrow what reaches you:
- each quote must be in the transcript;
- links must appear in it;
- lines addressed to Serra are never evidence;
- sensitive topics are dropped;
- targets must be team pages.

They can't prove a decision is right or final. **Your review is the real check.**

## Forget meeting

Settings › Meetings › **Forget** removes everything a meeting added:
- its page lines, from pages, the approved copy and every backup (a rule it replaced is current again);
- the folders workers read (threads that read it start fresh on their next message);
- a `decisions/` page it created, once nothing else is on it (also one an earlier forgotten meeting created);
- its pending quotes;
- its digest message.

It can't reach your upload in Slack, the copy your provider processed, or T3 threads that already read it.
