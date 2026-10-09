/** `x.y.z` thuần (không prerelease, không build): updater không nhận prerelease. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parse(version: string): [number, number, number] | null {
  const match = SEMVER.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** So hai bản `x.y.z` theo số. Chuỗi khác dạng thì ném. */
export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) throw new Error(`Phiên bản không phải x.y.z: ${pa ? b : a}`);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface CandidateInput {
  current: string;
  candidate: string;
  badVersions: readonly string[];
  /** `UpdateInfo.files` của `latest-mac.yml`; có thì phải chứa zip arm64 (Squirrel.Mac cài từ zip). */
  files?: readonly { url: string }[];
}

export type CandidateVerdict = 'offer' | 'invalid' | 'not-newer' | 'bad-version' | 'no-arm64';

/** Vì sao một bản trên feed được hay không được tải. Bản trong `badVersions` (từng hỏng probation) không bao giờ tải lại. */
export function judgeCandidate(input: CandidateInput): CandidateVerdict {
  if (!parse(input.candidate) || !parse(input.current)) return 'invalid';
  if (input.badVersions.includes(input.candidate)) return 'bad-version';
  if (compareSemver(input.candidate, input.current) <= 0) return 'not-newer';
  if (input.files && !input.files.some((file) => /arm64[^/]*\.zip$/.test(file.url))) return 'no-arm64';
  return 'offer';
}

export function shouldOffer(input: CandidateInput): boolean {
  return judgeCandidate(input) === 'offer';
}
