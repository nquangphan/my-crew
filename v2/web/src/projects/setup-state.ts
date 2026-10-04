/** Input rules of project creation and binding, mirroring `v2/server/src/projects/{routes,service}.ts`. */

const keyPattern = /^[A-Z][A-Z0-9_-]{1,31}$/;
export const projectNameMax = 200;
export const repositoryUrlMax = 2048;
export const checkoutPathMax = 4096;

export function projectKeyError(key: string): string | null {
  return keyPattern.test(key)
    ? null
    : 'Mã dự án gồm 2–32 ký tự, bắt đầu bằng chữ in hoa; chỉ dùng chữ in hoa, số, “_” và “-”.';
}

export function projectNameError(name: string): string | null {
  const value = name.trim();
  if (value.length === 0) return 'Nhập tên dự án.';
  if (value.length > projectNameMax) return `Tên dự án tối đa ${projectNameMax} ký tự.`;
  return null;
}

export type RepositoryUrlResult = { ok: true; value: string | null } | { ok: false; error: string };

/** Empty means no repository; otherwise HTTPS or SSH URL without embedded credentials. */
export function repositoryUrlValue(input: string): RepositoryUrlResult {
  const value = input.trim();
  if (value === '') return { ok: true, value: null };
  const invalid: RepositoryUrlResult = {
    ok: false,
    error:
      'URL repository phải là https:// hoặc ssh://, có tên máy chủ và không chứa tài khoản hay mật khẩu.',
  };
  if (value.length > repositoryUrlMax) return invalid;
  try {
    const url = new URL(value);
    return ['https:', 'ssh:'].includes(url.protocol) && !url.username && !url.password && url.hostname
      ? { ok: true, value }
      : invalid;
  } catch {
    return invalid;
  }
}

/**
 * Absolute POSIX path on the chosen machine (macOS/Linux, starts with `/`); typed text, never an OS picker.
 * Windows drive and UNC paths are rejected here because the server validates with the POSIX rules.
 */
export function checkoutPathError(path: string): string | null {
  if (!path.startsWith('/'))
    return 'Đường dẫn phải là đường dẫn tuyệt đối kiểu macOS/Linux, bắt đầu bằng “/”. Không nhận đường dẫn tương đối, C:\\ hay UNC.';
  if (path.includes('\0')) return 'Đường dẫn không được chứa ký tự NUL.';
  if (path.length > checkoutPathMax) return `Đường dẫn tối đa ${checkoutPathMax} ký tự.`;
  return null;
}
