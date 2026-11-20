// The preload: exposes `window.serra` (the typed SerraBridge) to the window and nothing else.
// It runs sandboxed, so it is bundled to one CommonJS file and may only use `electron`'s renderer modules.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { createBridge, type InvokeResult } from './main/bridge.ts';

const bridge = createBridge(
  (channel, args) => ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult>,
  (channel, listener) => {
    // Pass only the payload: the IPC event object would hand the page a way to `ipcRenderer` itself.
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => { ipcRenderer.removeListener(channel, wrapped); };
  },
);

contextBridge.exposeInMainWorld('serra', bridge);
