// Network utilities — LAN IP detection for LAN_AUTH_BYPASS.
// v2.6.0: skips login throttle + JWT requirement for requests from local network.

const PRIVATE_V4_PATTERNS = [
  /^127\./,                    // loopback
  /^10\./,                     // RFC1918
  /^192\.168\./,               // RFC1918
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // RFC1918
  /^169\.254\./,               // link-local
  /^0\.0\.0\.0$/,              // all interfaces
];

const PRIVATE_V6_PATTERNS = [
  /^::1$/,                     // loopback
  /^fe80:/i,                   // link-local
  /^fc[0-9a-f]{2}:/i,          // unique local
  /^fd[0-9a-f]{2}:/i,          // unique local
];

export function isLanIp(ip: string): boolean {
  if (!ip) return false;
  // Strip IPv4-mapped IPv6 prefix
  const cleaned = ip.replace(/^::ffff:/i, "");
  return (
    PRIVATE_V4_PATTERNS.some((p) => p.test(cleaned)) ||
    PRIVATE_V6_PATTERNS.some((p) => p.test(cleaned))
  );
}

export function isLoopbackIp(ip: string): boolean {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
