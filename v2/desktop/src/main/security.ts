import type { BrowserWindowConstructorOptions } from 'electron';

type Invocation = { sender: { id: number; getURL(): string }; senderFrame?: { url: string } | null };
type HostClient = { getStatus(): Promise<unknown>; openDashboard(): Promise<string> };

export function secureWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 520,
    height: 620,
    show: false,
    title: '2P Crew',
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
}

export function navigationAllowed(trustedUrl: string, target: string): boolean {
  return target === trustedUrl;
}

export function createShellHandlers(input: {
  trustedWebContentsId: number;
  trustedUrl: string;
  host: HostClient;
  openExternal(url: string): Promise<void>;
}) {
  function authorize(event: Invocation): void {
    if (
      event.sender.id !== input.trustedWebContentsId ||
      event.sender.getURL() !== input.trustedUrl ||
      event.senderFrame?.url !== input.trustedUrl
    ) {
      throw new Error('UNTRUSTED_SENDER');
    }
  }
  return {
    async getStatus(event: Invocation): Promise<unknown> {
      authorize(event);
      return input.host.getStatus();
    },
    async openDashboard(event: Invocation): Promise<void> {
      authorize(event);
      const url = new URL(await input.host.openDashboard());
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('UNTRUSTED_URL');
      await input.openExternal(url.href);
    },
  };
}
