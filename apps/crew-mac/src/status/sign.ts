import { createHmac } from 'node:crypto';

export function signCrewBody(
  body: string,
  secret: string,
  nowSec: number,
): {
  'X-Crew-Timestamp': string;
  'X-Crew-Signature': string;
} {
  const timestamp = String(Math.floor(nowSec));
  const hex = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { 'X-Crew-Timestamp': timestamp, 'X-Crew-Signature': `sha256=${hex}` };
}
