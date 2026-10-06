export interface PlistSpec {
  label: string;
  programArguments: readonly string[];
  keepAlive: boolean;
  startIntervalSec?: number;
  aquaOnly: boolean;
  processType: 'Interactive' | 'Background';
  stdoutPath?: string;
  stderrPath?: string;
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderPlist(spec: PlistSpec): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${esc(spec.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...spec.programArguments.map((arg) => `    <string>${esc(arg)}</string>`),
    '  </array>',
  ];
  if (spec.aquaOnly) lines.push('  <key>LimitLoadToSessionType</key><string>Aqua</string>');
  lines.push(`  <key>ProcessType</key><string>${spec.processType}</string>`);
  lines.push('  <key>RunAtLoad</key><true/>');
  if (spec.keepAlive) lines.push('  <key>KeepAlive</key><true/>');
  if (spec.startIntervalSec !== undefined) {
    lines.push(`  <key>StartInterval</key><integer>${spec.startIntervalSec}</integer>`);
  }
  if (spec.stdoutPath) lines.push(`  <key>StandardOutPath</key><string>${esc(spec.stdoutPath)}</string>`);
  if (spec.stderrPath) lines.push(`  <key>StandardErrorPath</key><string>${esc(spec.stderrPath)}</string>`);
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}
