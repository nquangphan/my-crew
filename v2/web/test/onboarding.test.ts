import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { AppRuntime } from '../src/app-runtime.ts';
import type { Machine, Project } from '../src/contracts/machines.ts';
import { createOwnerClient } from '../src/lib/api.ts';
import { PendingStore } from '../src/lib/pending-operation.ts';
import { SessionController } from '../src/lib/session.ts';
import { checkoutPathError, projectKeyError, repositoryUrlValue } from '../src/projects/setup-state.ts';
import { MemoryStorage } from './support/compose-server.ts';
import { installDom } from './support/dom.ts';

const closeDom = installDom();
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { RuntimeContext } = await import('../src/app-runtime.ts');
const { MachineOnboarding } = await import('../src/machines/onboarding.tsx');
const { ProjectSetup } = await import('../src/projects/setup.tsx');
const { machineNameError } = await import('../src/machines/onboarding-state.ts');

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});
after(() => closeDom());

const csrf = 'c'.repeat(64);
const machineA = '11111111-1111-4111-8111-111111111111';
const machineB = '22222222-2222-4222-8222-222222222222';
const revokedMachine = '33333333-3333-4333-8333-333333333333';
const projectA = '44444444-4444-4444-8444-444444444444';
const secretToken = 'machine-token-SECRET-0123456789';

type Call = { method: string; url: string; headers: Headers; body: string | null };

/** Minimal in-memory producer of the machine/project onboarding routes. */
class FakeServer {
  machines: Machine[] = [];
  projects: Project[] = [];
  calls: Call[] = [];
  /** Commit, then drop the response of the next POST /v2/machines. */
  dropNextMachineResponse = false;
  /** Next PUT binding fails with this producer error (state untouched). */
  bindError: { status: number; code: string } | null = null;
  #receipts = new Map<string, Response>();
  #next = 1;

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : null;
    const call: Call = { method, url, headers: new Headers(init.headers), body };
    this.calls.push(call);
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    const failure = (status: number, code: string) => json(status, { error: { code, message: code } });
    const path = url.split('?')[0] ?? url;
    if (path === '/v2/auth/session') return json(200, { owner: { id: 'owner' }, csrfToken: csrf });
    if (method === 'GET' && path === '/v2/machines')
      return json(200, { items: this.machines, nextCursor: null });
    if (method === 'GET' && path === '/v2/projects')
      return json(200, { items: this.projects, nextCursor: null });
    const key = call.headers.get('idempotency-key') ?? '';
    const prior = this.#receipts.get(`${method}:${path}:${key}`);
    if (prior) return prior.clone();
    const remember = (response: Response) => {
      this.#receipts.set(`${method}:${path}:${key}`, response.clone());
      return response;
    };
    if (method === 'POST' && path === '/v2/machines') {
      const input = JSON.parse(body ?? '{}') as { name: string };
      const machine: Machine = {
        id: `aaaaaaaa-0000-4000-8000-${String(this.#next++).padStart(12, '0')}`,
        name: input.name,
        revokedAt: null,
      };
      this.machines.push(machine);
      const response = remember(json(201, { machine, token: secretToken }));
      if (this.dropNextMachineResponse) {
        this.dropNextMachineResponse = false;
        throw new TypeError('fetch failed');
      }
      return response;
    }
    if (method === 'POST' && path === '/v2/projects') {
      const input = JSON.parse(body ?? '{}') as { key: string; name: string; repositoryUrl: string | null };
      if (this.projects.some((project) => project.key === input.key))
        return failure(409, 'PROJECT_KEY_CONFLICT');
      const project: Project = {
        id: `bbbbbbbb-0000-4000-8000-${String(this.#next++).padStart(12, '0')}`,
        ...input,
        machineId: null,
        checkoutPath: null,
        bindingRevision: 1,
        docsState: 'missing',
      };
      this.projects.push(project);
      return remember(json(201, project));
    }
    const bind = /^\/v2\/projects\/([^/]+)\/binding$/.exec(path);
    if (method === 'PUT' && bind) {
      if (this.bindError) {
        const error = this.bindError;
        this.bindError = null;
        return failure(error.status, error.code);
      }
      const project = this.projects.find((candidate) => candidate.id === bind[1]);
      if (!project) return failure(404, 'NOT_FOUND');
      const input = JSON.parse(body ?? '{}') as {
        machineId: string;
        checkoutPath: string;
        expectedRevision: number;
      };
      if (input.expectedRevision !== project.bindingRevision) return failure(409, 'REVISION_CONFLICT');
      project.machineId = input.machineId;
      project.checkoutPath = input.checkoutPath;
      project.bindingRevision += 1;
      return remember(json(200, project));
    }
    return failure(404, 'NOT_FOUND');
  };
}

function setup(server: FakeServer) {
  const storage = new MemoryStorage();
  const session = new SessionController({ fetch: server.fetch });
  const pending = new PendingStore(storage);
  const client = createOwnerClient({
    session,
    pending,
    fetch: server.fetch,
    sleep: async () => undefined,
    maxRetries: 0,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
  const runtime = { client, session, pending } as unknown as AppRuntime;
  const mountView = (view: () => ReturnType<typeof createElement>) =>
    render(
      createElement(
        RuntimeContext.Provider,
        { value: runtime },
        createElement(QueryClientProvider, { client: queryClient }, view()),
      ),
    );
  return { storage, session, pending, client, queryClient, mountView };
}

async function ready<T extends ReturnType<typeof setup>>(env: T): Promise<T> {
  await env.session.bootstrap();
  return env;
}

const mutations = (server: FakeServer, method: string, prefix: string) =>
  server.calls.filter((call) => call.method === method && call.url.startsWith(prefix));

test('kiểm tra đầu vào khớp hợp đồng server: tên máy, mã dự án, URL repository, đường dẫn checkout', () => {
  assert.equal(machineNameError('  '), 'Nhập tên máy.');
  assert.equal(machineNameError('a'.repeat(201)), 'Tên máy tối đa 200 ký tự.');
  assert.equal(machineNameError('Mac mini'), null);
  assert.notEqual(projectKeyError('abc'), null);
  assert.notEqual(projectKeyError('A'), null);
  assert.notEqual(projectKeyError('A'.repeat(33)), null);
  assert.equal(projectKeyError('CREW_V2-1'), null);
  assert.deepEqual(repositoryUrlValue(''), { ok: true, value: null });
  assert.deepEqual(repositoryUrlValue(' https://git.example/x.git '), {
    ok: true,
    value: 'https://git.example/x.git',
  });
  assert.equal(repositoryUrlValue('https://user:pw@git.example/x.git').ok, false);
  assert.equal(repositoryUrlValue('http://git.example/x.git').ok, false);
  assert.equal(repositoryUrlValue('git@github.com:a/b.git').ok, false);
  assert.equal(checkoutPathError('relative/path'), 'Nhập đường dẫn tuyệt đối trên máy đã chọn.');
  assert.equal(checkoutPathError('/srv/work/crew'), null);
  assert.equal(checkoutPathError('/srv/\0x'), 'Đường dẫn không được chứa ký tự NUL.');
  assert.equal(checkoutPathError(`/${'a'.repeat(4096)}`), 'Đường dẫn tối đa 4096 ký tự.');
});

test('đăng ký máy: gửi một POST có khóa, token chỉ nằm trong bộ nhớ và biến mất khi đóng', async () => {
  const server = new FakeServer();
  const env = await ready(setup(server));
  env.mountView(() => createElement(MachineOnboarding));
  await screen.findByText('Chưa có máy nào được đăng ký.');

  fireEvent.change(screen.getByLabelText('Tên máy'), { target: { value: 'Mac mini phòng họp' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng ký máy' }));

  const panel = await screen.findByRole('region', { name: 'Token máy vừa đăng ký' });
  assert.ok(within(panel).getByText(secretToken));
  const posts = mutations(server, 'POST', '/v2/machines');
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.body, JSON.stringify({ name: 'Mac mini phòng họp' }));
  assert.match(posts[0]?.headers.get('idempotency-key') ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(posts[0]?.headers.get('x-csrf-token'), csrf);

  // Token is in neither tab storage, query cache nor the pending record.
  assert.equal(JSON.stringify([...env.storage.map.values()]).includes(secretToken), false);
  assert.equal(window.sessionStorage.length, 0);
  assert.equal(
    JSON.stringify(
      env.queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ).includes(secretToken),
    false,
  );
  assert.equal(env.pending.list().length, 0);
  await screen.findByText('Mac mini phòng họp');

  fireEvent.click(within(panel).getByRole('button', { name: 'Đã lưu token, đóng' }));
  assert.equal(screen.queryByText(secretToken), null);
  assert.equal(document.body.textContent?.includes(secretToken), false);
});

test('đăng ký máy mất phản hồi: gửi lại đúng khóa và nội dung cũ, không đăng ký máy thứ hai', async () => {
  const server = new FakeServer();
  server.dropNextMachineResponse = true;
  const env = await ready(setup(server));
  env.mountView(() => createElement(MachineOnboarding));
  await screen.findByText('Chưa có máy nào được đăng ký.');

  fireEvent.change(screen.getByLabelText('Tên máy'), { target: { value: 'Máy A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng ký máy' }));
  await screen.findByRole('alert');
  assert.match(screen.getByRole('alert').textContent ?? '', /Chưa xác nhận/);
  assert.equal(server.machines.length, 1);

  fireEvent.click(await screen.findByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' }));
  await screen.findByRole('region', { name: 'Token máy vừa đăng ký' });
  const posts = mutations(server, 'POST', '/v2/machines');
  assert.equal(posts.length, 2);
  assert.equal(posts[1]?.headers.get('idempotency-key'), posts[0]?.headers.get('idempotency-key'));
  assert.equal(posts[1]?.body, posts[0]?.body);
  assert.equal(server.machines.length, 1);
});

test('đăng ký máy: tên rỗng bị chặn trước khi gửi', async () => {
  const server = new FakeServer();
  const env = await ready(setup(server));
  env.mountView(() => createElement(MachineOnboarding));
  await screen.findByText('Chưa có máy nào được đăng ký.');
  fireEvent.click(screen.getByRole('button', { name: 'Đăng ký máy' }));
  assert.match((await screen.findByRole('alert')).textContent ?? '', /Nhập tên máy/);
  assert.equal(mutations(server, 'POST', '/v2/machines').length, 0);
});

test('hết phiên xóa token đang hiển thị khỏi bộ nhớ', async () => {
  const server = new FakeServer();
  const env = await ready(setup(server));
  env.mountView(() => createElement(MachineOnboarding));
  await screen.findByText('Chưa có máy nào được đăng ký.');
  fireEvent.change(screen.getByLabelText('Tên máy'), { target: { value: 'Máy B' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng ký máy' }));
  await screen.findByText(secretToken);
  act(() => env.session.expire());
  await waitFor(() => assert.equal(document.body.textContent?.includes(secretToken), false));
});

test('tạo dự án: mã trùng 409 giữ nguyên các trường; khóa mới sau khi bị từ chối', async () => {
  const server = new FakeServer();
  server.projects.push({
    id: projectA,
    key: 'CREW',
    name: 'Dự án có sẵn',
    repositoryUrl: null,
    machineId: null,
    checkoutPath: null,
    bindingRevision: 1,
    docsState: 'missing',
  });
  const env = await ready(setup(server));
  env.mountView(() => createElement(ProjectSetup));
  await screen.findByText('Dự án có sẵn');

  fireEvent.change(screen.getByLabelText('Mã dự án'), { target: { value: 'CREW' } });
  fireEvent.change(screen.getByLabelText('Tên dự án'), { target: { value: 'Dự án mới' } });
  fireEvent.change(screen.getByLabelText('URL repository (không bắt buộc)'), {
    target: { value: 'https://git.example/crew.git' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo dự án' }));
  assert.match((await screen.findByRole('alert')).textContent ?? '', /Mã dự án đã tồn tại/);
  assert.equal((screen.getByLabelText('Mã dự án') as HTMLInputElement).value, 'CREW');
  assert.equal((screen.getByLabelText('Tên dự án') as HTMLInputElement).value, 'Dự án mới');
  assert.equal(env.pending.list().length, 0);

  fireEvent.change(screen.getByLabelText('Mã dự án'), { target: { value: 'CREW2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo dự án' }));
  await screen.findByRole('region', { name: 'Gắn máy cho dự án Dự án mới' });
  const posts = mutations(server, 'POST', '/v2/projects');
  assert.equal(posts.length, 2);
  assert.notEqual(posts[1]?.headers.get('idempotency-key'), posts[0]?.headers.get('idempotency-key'));
  assert.deepEqual(JSON.parse(posts[1]?.body ?? '{}'), {
    key: 'CREW2',
    name: 'Dự án mới',
    repositoryUrl: 'https://git.example/crew.git',
  });
});

function seedBindable(server: FakeServer, overrides: Partial<Project> = {}) {
  server.machines.push(
    { id: machineA, name: 'Mac A', revokedAt: null },
    { id: machineB, name: 'Mac B', revokedAt: null },
    { id: revokedMachine, name: 'Máy cũ', revokedAt: '2026-10-01T00:00:00.000Z' },
  );
  server.projects.push({
    id: projectA,
    key: 'CREW',
    name: 'Crew',
    repositoryUrl: null,
    machineId: null,
    checkoutPath: null,
    bindingRevision: 1,
    docsState: 'missing',
    ...overrides,
  });
}

async function openBinding() {
  const section = await screen.findByRole('region', { name: 'Gắn máy cho dự án Crew' });
  return {
    section,
    machine: within(section).getByLabelText('Máy') as HTMLSelectElement,
    path: within(section).getByLabelText('Đường dẫn checkout') as HTMLInputElement,
  };
}

test('gắn máy: gửi revision thật của dự án, bỏ máy đã thu hồi, sau khi gắn hiển thị revision mới', async () => {
  const server = new FakeServer();
  seedBindable(server, { bindingRevision: 4 });
  const env = await ready(setup(server));
  env.mountView(() => createElement(ProjectSetup));
  const { section, machine, path } = await openBinding();
  assert.equal(within(machine).queryByText('Máy cũ'), null);

  fireEvent.change(machine, { target: { value: machineA } });
  fireEvent.change(path, { target: { value: '/srv/work/crew' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Gắn máy' }));
  await within(section).findByText(/Revision 5/);
  const puts = mutations(server, 'PUT', `/v2/projects/${projectA}/binding`);
  assert.equal(puts.length, 1);
  assert.deepEqual(JSON.parse(puts[0]?.body ?? '{}'), {
    machineId: machineA,
    checkoutPath: '/srv/work/crew',
    expectedRevision: 4,
  });
  assert.equal(env.pending.list().length, 0);
});

test('gắn máy: đường dẫn tương đối bị chặn, chưa có máy thì hướng dẫn đăng ký máy', async () => {
  const server = new FakeServer();
  seedBindable(server);
  const env = await ready(setup(server));
  env.mountView(() => createElement(ProjectSetup));
  const { section, machine, path } = await openBinding();
  fireEvent.change(machine, { target: { value: machineA } });
  fireEvent.change(path, { target: { value: 'relative' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Gắn máy' }));
  assert.match((await within(section).findByRole('alert')).textContent ?? '', /đường dẫn tuyệt đối/);
  assert.equal(mutations(server, 'PUT', '/v2/projects').length, 0);

  cleanup();
  const empty = new FakeServer();
  empty.projects.push({
    id: projectA,
    key: 'CREW',
    name: 'Crew',
    repositoryUrl: null,
    machineId: null,
    checkoutPath: null,
    bindingRevision: 1,
    docsState: 'missing',
  });
  const emptyEnv = await ready(setup(empty));
  emptyEnv.mountView(() => createElement(ProjectSetup));
  await screen.findByText(/Chưa có máy nào/);
});

test('hai tab: revision cũ 409 giữ đường dẫn đã nhập, tải lại revision mới và áp dụng lại bằng khóa mới', async () => {
  const server = new FakeServer();
  seedBindable(server);
  const env = await ready(setup(server));
  env.mountView(() => createElement(ProjectSetup));
  const { section, machine, path } = await openBinding();
  fireEvent.change(machine, { target: { value: machineB } });
  fireEvent.change(path, { target: { value: '/srv/tab-hai' } });

  // Another tab binds the project first, so this tab's revision 1 is stale.
  const other = server.projects[0];
  assert.ok(other);
  other.machineId = machineA;
  other.checkoutPath = '/srv/tab-mot';
  other.bindingRevision = 2;

  fireEvent.click(within(section).getByRole('button', { name: 'Gắn máy' }));
  assert.match((await within(section).findByRole('alert')).textContent ?? '', /đã được thay đổi/);
  assert.equal(path.value, '/srv/tab-hai');
  assert.equal(machine.value, machineB);
  assert.equal(env.pending.list().length, 0);
  await within(section).findByText(/Revision 2/);

  fireEvent.click(within(section).getByRole('button', { name: 'Đổi máy' }));
  await within(section).findByText(/Revision 3/);
  const puts = mutations(server, 'PUT', `/v2/projects/${projectA}/binding`);
  assert.equal(puts.length, 2);
  assert.equal(JSON.parse(puts[1]?.body ?? '{}').expectedRevision, 2);
  assert.notEqual(puts[1]?.headers.get('idempotency-key'), puts[0]?.headers.get('idempotency-key'));
  assert.equal(server.projects[0]?.checkoutPath, '/srv/tab-hai');
});

test('đổi máy khi còn tiến trình: 409 ACTIVE_EXECUTION giải thích lý do, giữ trường và không tự dừng tác vụ', async () => {
  const server = new FakeServer();
  seedBindable(server, { machineId: machineA, checkoutPath: '/srv/cu', bindingRevision: 2 });
  const env = await ready(setup(server));
  env.mountView(() => createElement(ProjectSetup));
  const { section, machine, path } = await openBinding();
  fireEvent.change(machine, { target: { value: machineB } });
  fireEvent.change(path, { target: { value: '/srv/moi' } });
  server.bindError = { status: 409, code: 'ACTIVE_EXECUTION' };
  fireEvent.click(within(section).getByRole('button', { name: 'Đổi máy' }));
  const alert = await within(section).findByRole('alert');
  assert.match(alert.textContent ?? '', /tiến trình/);
  assert.match(alert.textContent ?? '', /không tự dừng/);
  assert.equal(path.value, '/srv/moi');
  assert.equal(machine.value, machineB);
  assert.equal(server.projects[0]?.machineId, machineA);
  assert.equal(server.projects[0]?.bindingRevision, 2);
  assert.equal(server.calls.filter((call) => /\/(pause|cancel|stop|reconcile)/.test(call.url)).length, 0);
});

test('chưa có dự án: hướng dẫn tạo dự án trước', async () => {
  const server = new FakeServer();
  const env = await ready(setup(server));
  env.mountView(() => createElement(ProjectSetup));
  await screen.findByText('Chưa có dự án nào. Tạo dự án ở biểu mẫu phía trên.');
});
