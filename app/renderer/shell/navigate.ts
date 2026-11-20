// Follows the routes main asks the window to show (APP-24: clicking a notification opens the job or Diagnostics).
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { serra } from '../bridge.ts';
import { routeForPath } from '../routes.ts';

/** A pushed target the window can show: a known route with an optional query. Anything else is ignored. */
export const knownTarget = (target: unknown): string | null => {
  if (typeof target !== 'string') return null;
  const [path] = target.split('?');
  return path && routeForPath(path) ? target : null;
};

/** Mounted once in the shell. Renders nothing. */
export const FollowNavigation = (): null => {
  const navigate = useNavigate();
  useEffect(() => serra()?.on.navigate((target) => {
    const known = knownTarget(target);
    if (known) void navigate(known);
  }), [navigate]);
  return null;
};
