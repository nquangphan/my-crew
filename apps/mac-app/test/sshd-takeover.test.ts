import { describe, expect, it } from 'vitest';
import { isCrewSshdListener, planListenerTakeover } from '../src/main/sshd/takeover.js';

const CFG = '/Users/u/.crew-mac/sshd/sshd_config';
const LOG = '/Users/u/.crew-mac/sshd/sshd.log';
const own = { pid: 500, comm: 'sshd', command: `/usr/sbin/sshd -D -f ${CFG} -E ${LOG}` };
/** Tiêu đề thật của listener OpenSSH trên macOS 26 (đo bằng `ps -o comm=,command=` ngày 09/10/2026). */
const ownRetitled = {
  pid: 500,
  comm: 'sshd: /usr/sbin/',
  command: `sshd: /usr/sbin/sshd -D -f ${CFG} -E ${LOG} [listener] 0 of 10-100 startups`,
};

describe('planListenerTakeover', () => {
  it('không có pidfile thì sinh mới', () => {
    expect(planListenerTakeover({ pidFromFile: null, proc: null, sshdConfig: CFG })).toEqual({
      kind: 'spawn',
    });
  });
  it('pid trong pidfile đã chết thì sinh mới', () => {
    expect(planListenerTakeover({ pidFromFile: 500, proc: null, sshdConfig: CFG })).toEqual({
      kind: 'spawn',
    });
  });
  it('listener cũ khớp argv thì thay', () => {
    expect(planListenerTakeover({ pidFromFile: 500, proc: own, sshdConfig: CFG })).toEqual({
      kind: 'replace',
      pid: 500,
    });
  });
  it('listener cũ đã đổi tiêu đề ("sshd: … [listener]") vẫn nhận ra và thay', () => {
    expect(planListenerTakeover({ pidFromFile: 500, proc: ownRetitled, sshdConfig: CFG })).toEqual({
      kind: 'replace',
      pid: 500,
    });
  });
  it('pid bị tái dùng bởi sshd-session thì không bao giờ đụng', () => {
    const sess = { pid: 500, comm: 'sshd-session: u@notty', command: 'sshd-session: u@notty' };
    expect(planListenerTakeover({ pidFromFile: 500, proc: sess, sshdConfig: CFG })).toEqual({
      kind: 'spawn',
    });
  });
  it('sshd-session mang argv giống listener vẫn không đụng', () => {
    const sess = { pid: 500, comm: 'sshd-session', command: `sshd-session: /usr/sbin/sshd -D -f ${CFG}` };
    expect(planListenerTakeover({ pidFromFile: 500, proc: sess, sshdConfig: CFG })).toEqual({
      kind: 'spawn',
    });
  });
  it('pid bị tái dùng bởi process khác thì không đụng', () => {
    const other = { pid: 500, comm: 'node', command: '/opt/homebrew/bin/node x.js' };
    expect(planListenerTakeover({ pidFromFile: 500, proc: other, sshdConfig: CFG })).toEqual({
      kind: 'spawn',
    });
  });
  it('sshd của cấu hình khác (sshd hệ thống) thì không đụng', () => {
    const sys = { pid: 500, comm: 'sshd', command: '/usr/sbin/sshd -i' };
    expect(planListenerTakeover({ pidFromFile: 500, proc: sys, sshdConfig: CFG })).toEqual({ kind: 'spawn' });
  });
  it('cấu hình chỉ trùng tiền tố (sshd_config.bak) thì không đụng', () => {
    const bak = { pid: 500, comm: 'sshd', command: `/usr/sbin/sshd -D -f ${CFG}.bak` };
    expect(planListenerTakeover({ pidFromFile: 500, proc: bak, sshdConfig: CFG })).toEqual({ kind: 'spawn' });
  });
  it('proc của pid khác pidfile thì không đụng', () => {
    expect(planListenerTakeover({ pidFromFile: 501, proc: own, sshdConfig: CFG })).toEqual({ kind: 'spawn' });
  });
});

describe('isCrewSshdListener', () => {
  it('nhận argv gốc và tiêu đề đổi tên, từ chối binary khác', () => {
    expect(isCrewSshdListener(own, CFG)).toBe(true);
    expect(isCrewSshdListener(ownRetitled, CFG)).toBe(true);
    expect(isCrewSshdListener({ comm: 'x', command: `/tmp/sshd -D -f ${CFG}` }, CFG)).toBe(false);
    expect(isCrewSshdListener({ comm: 'sshd', command: `sshd: /usr/sbin/sshd -D -f ${CFG}` }, CFG)).toBe(
      true,
    );
  });
});
