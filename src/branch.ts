/** Task branch names for new jobs, from the profile's `branchPattern`. */

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '') || 'task';

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * `TEAM-{DDMM}/{slug}-{stamp}` becomes `TEAM-1811/fix-the-banner-mwm5q6p3` on 18 November.
 * The pattern was checked when the profile loaded, so the result is a valid branch name.
 */
export const branchName = (pattern: string, { id, request, now = new Date() }: { id: string; request: string; now?: Date }): string => {
  const values: Record<string, string> = {
    id,
    slug: slugify(request),
    stamp: now.getTime().toString(36),
    DDMM: `${two(now.getDate())}${two(now.getMonth() + 1)}`,
    MMDD: `${two(now.getMonth() + 1)}${two(now.getDate())}`,
  };
  return pattern.replace(/\{(id|slug|stamp|DDMM|MMDD)\}/g, (_placeholder, name: string) => values[name]!);
};
