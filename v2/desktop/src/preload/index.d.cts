export function createPreloadApi(renderer: { invoke(channel: string): Promise<unknown> }): Readonly<{
  getStatus(): Promise<unknown>;
  openDashboard(): Promise<unknown>;
}>;
