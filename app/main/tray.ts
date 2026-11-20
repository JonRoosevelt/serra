// The menubar item (APP-11): the brand status icon, the bot's state and job counts, Open Serra and Restart bot.
// What it shows comes from `tray.logic.ts`; this file only draws it with Electron.
import { join } from 'node:path';
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { trayController, type TrayIcon, type TrayStatusFeed, type TrayView } from './tray.logic.ts';

/** Menubar icons are 18 points; the 2× copy keeps them sharp on Retina screens. */
const SIZE = 18;
const ICONS: readonly TrayIcon[] = ['up', 'needs-you', 'down'];

const loadIcon = (iconsDir: string, icon: TrayIcon, size: number): NativeImage => {
  const path = join(iconsDir, `serra-status-${icon}.png`);
  const source = nativeImage.createFromPath(path);
  if (source.isEmpty()) throw new Error(`Missing menubar icon ${path}`);
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    image.addRepresentation({ scaleFactor, buffer: source.resize({ width: size * scaleFactor, height: size * scaleFactor, quality: 'best' }).toPNG() });
  }
  return image;
};

export interface SerraTrayOptions {
  /** `assets/brand`, where the status icons are. */
  iconsDir: string;
  status: TrayStatusFeed;
  profileSelected(): boolean;
  restart(): Promise<void>;
  /** Shows the main window, creating it when it was closed. */
  openWindow(): void;
}

export interface SerraTray {
  /** Draws again after something outside the status feed changed (the profile). */
  refresh(): void;
  destroy(): void;
}

export const createTray = ({ iconsDir, status, profileSelected, restart, openWindow }: SerraTrayOptions): SerraTray => {
  const icons = Object.fromEntries(ICONS.map((icon) => [icon, loadIcon(iconsDir, icon, SIZE)])) as Record<TrayIcon, NativeImage>;
  const small = Object.fromEntries(ICONS.map((icon) => [icon, loadIcon(iconsDir, icon, 14)])) as Record<TrayIcon, NativeImage>;
  const tray = new Tray(icons.down);
  tray.setIgnoreDoubleClickEvents(true);

  let controller: ReturnType<typeof trayController> | null = null;
  const render = (view: TrayView): void => {
    tray.setImage(icons[view.icon]);
    tray.setToolTip(view.tooltip);
    const template: MenuItemConstructorOptions[] = [
      { label: view.headline, icon: small[view.icon], enabled: false },
      ...view.details.map((detail): MenuItemConstructorOptions => ({ label: detail.label, enabled: false })),
      { type: 'separator' },
      { label: 'Open Serra', click: () => openWindow() },
      { label: view.restart.label, enabled: view.restart.enabled, click: () => { void controller?.restart(); } },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };
  controller = trayController({ status, profileSelected, restart, render });
  return {
    refresh: () => controller?.refresh(),
    destroy: () => { controller?.stop(); tray.destroy(); },
  };
};
