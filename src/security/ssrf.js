import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

export async function validateFetchUrl(rawUrl, { lookup = dnsLookup } = {}) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  validateHostname(parsed.hostname);
  if (!isBareIPv4(parsed.hostname) && !parsed.hostname.includes(":")) {
    const resolved = await lookup(parsed.hostname, { family: 4 });
    validateResolvedAddress(resolved.address, parsed.hostname);
  }
  return parsed;
}

export function validateHostname(hostname) {
  const normalized = stripBrackets(hostname.toLowerCase());
  validateResolvedAddress(normalized, hostname);
}

export function validateResolvedAddress(address, label = address) {
  const normalized = stripBrackets(String(address).toLowerCase());
  if (normalized === "localhost") throw new Error(`blocked internal hostname: ${label}`);
  if (normalized === "0.0.0.0") throw new Error(`blocked internal address: ${label}`);
  if (normalized.startsWith("127.")) throw new Error(`blocked loopback address: ${label}`);
  if (normalized.startsWith("169.254.")) throw new Error(`blocked link-local address: ${label}`);
  if (isPrivateIPv4(normalized)) throw new Error(`blocked private network: ${label}`);
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (isBlockedAddress(mapped)) {
      throw new Error(`blocked internal IPv4-mapped IPv6 address: ${label}`);
    }
  }
  if (normalized.includes(":")) {
    throw new Error(`IPv6 addresses are blocked for web_fetch: ${label}`);
  }
}

function isBlockedAddress(normalized) {
  if (normalized === "localhost" || normalized === "0.0.0.0") return true;
  if (normalized.startsWith("127.")) return true;
  if (normalized.startsWith("169.254.")) return true;
  if (isPrivateIPv4(normalized)) return true;
  return false;
}

export function isPrivateIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const nums = ip.split(".").map(Number);
  if (nums[0] === 10) return true;
  if (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) return true;
  if (nums[0] === 192 && nums[1] === 168) return true;
  return false;
}

function isBareIPv4(hostname) {
  return net.isIP(hostname) === 4;
}

function stripBrackets(value) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}
