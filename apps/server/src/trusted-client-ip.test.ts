import { describe, expect, it } from 'vitest';

import { TrustedProxyPolicy } from './trusted-client-ip.js';

describe('M7 trusted proxy boundary', () => {
  const policy = new TrustedProxyPolicy(['10.0.0.0/8', '2001:db8::/32']);

  it('uses only a single overwritten forwarding value from a trusted ingress', () => {
    expect(policy.clientIp('10.0.0.2', '203.0.113.9')).toBe('203.0.113.9');
    expect(
      policy.clientIp('10.0.0.2', '198.51.100.1, 203.0.113.9'),
    ).toBeUndefined();
    expect(policy.clientIp('198.51.100.2', '203.0.113.9')).toBe('198.51.100.2');
  });

  it('rejects malformed CIDRs during startup', () => {
    expect(() => new TrustedProxyPolicy(['0.0.0.0/99'])).toThrow(
      'Invalid trusted proxy CIDR',
    );
  });
});
