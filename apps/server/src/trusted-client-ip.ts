import { BlockList, isIP } from 'node:net';

function normalize(address: string): string {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export class TrustedProxyPolicy {
  private readonly blocks = new BlockList();

  constructor(cidrs: readonly string[]) {
    for (const cidr of cidrs) {
      const [rawAddress, rawPrefix] = cidr.split('/');
      const address = rawAddress === undefined ? '' : normalize(rawAddress);
      const family = isIP(address);
      const maximum = family === 4 ? 32 : family === 6 ? 128 : 0;
      const prefix = Number.parseInt(rawPrefix ?? String(maximum), 10);
      if (
        maximum === 0 ||
        !Number.isInteger(prefix) ||
        prefix < 0 ||
        prefix > maximum
      ) {
        throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
      }
      this.blocks.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
    }
  }

  isTrusted(address: string): boolean {
    const normalized = normalize(address);
    const family = isIP(normalized);
    return (
      family !== 0 &&
      this.blocks.check(normalized, family === 4 ? 'ipv4' : 'ipv6')
    );
  }

  clientIp(
    remoteAddress: string | undefined,
    forwardedFor: string | readonly string[] | undefined,
  ): string | undefined {
    if (remoteAddress === undefined) return undefined;
    const remote = normalize(remoteAddress);
    if (!this.isTrusted(remote)) return isIP(remote) === 0 ? undefined : remote;
    if (typeof forwardedFor !== 'string' || forwardedFor.includes(',')) {
      return undefined;
    }
    const forwarded = normalize(forwardedFor.trim());
    return isIP(forwarded) === 0 ? undefined : forwarded;
  }
}
