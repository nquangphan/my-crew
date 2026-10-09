import type {
  CheckResult,
  DoctorOptions,
  InstallCrewMacResult,
  SetupOptions,
  SetupReport,
  StatusConfig,
  StatusRepo,
  WorkflowReport,
} from '@crew/mac';

/** Các thao tác của `@crew/mac` chạy trong utilityProcess. Hàm thư viện không nhận `ctx` qua IPC. */
export interface OpsApi {
  doctor(opts: DoctorOptions): Promise<CheckResult[]>;
  setup(opts: SetupOptions): Promise<SetupReport>;
  configureStatus(url: string, companyId: string): StatusConfig;
  setStatusSecret(secret: string): Promise<void>;
  addStatusRepo(projectId: string, path: string): void;
  removeStatusRepo(projectId: string): void;
  listStatusRepos(): StatusRepo[];
  installCrewMacFrom(srcDir: string): Promise<InstallCrewMacResult>;
  sendStatus(): Promise<void>;
  workflowCheck(input: { root: string; pluginDir: string }): Promise<WorkflowReport>;
}

export type OpsName = keyof OpsApi;

export interface OpsBridge {
  call<K extends OpsName>(op: K, ...args: Parameters<OpsApi[K]>): Promise<Awaited<ReturnType<OpsApi[K]>>>;
}

/** Thông điệp Main → utility. */
export interface OpsRequest {
  id: number;
  op: string;
  args: unknown[];
}

/** Thông điệp utility → Main. */
export type OpsResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string } };

/** Phần của `UtilityProcess` mà cầu nối dùng (để test bằng EventEmitter giả). */
export interface UtilityLike {
  postMessage(message: OpsRequest): void;
  on(event: 'message', listener: (message: OpsResponse) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

const CRASHED = 'Tiến trình phụ dừng bất thường';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Gọi `@crew/mac` trong utilityProcess, một lời gọi một `id`. Utility chết giữa chừng thì mọi lời gọi đang chờ
 * bị reject và lần gọi sau tự `fork` lại. Không ghi tham số vào log: `setStatusSecret` mang secret.
 */
export class UtilityOpsBridge implements OpsBridge {
  private child: UtilityLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly fork: () => UtilityLike) {}

  call<K extends OpsName>(op: K, ...args: Parameters<OpsApi[K]>): Promise<Awaited<ReturnType<OpsApi[K]>>> {
    return new Promise((resolve, reject) => {
      const child = this.ensureChild();
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      child.postMessage({ id, op, args });
    });
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    this.rejectAll(new Error(CRASHED));
    child?.kill();
  }

  private ensureChild(): UtilityLike {
    if (this.child) return this.child;
    const child = this.fork();
    this.child = child;
    child.on('message', (message) => {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.result);
        return;
      }
      const error = new Error(message.error.message);
      error.name = message.error.name;
      waiter.reject(error);
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      this.rejectAll(new Error(CRASHED));
    });
    return child;
  }

  private rejectAll(error: Error): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const waiter of waiting) waiter.reject(error);
  }
}
