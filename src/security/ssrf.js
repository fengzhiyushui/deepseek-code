import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

export async function resolveFetchTarget(rawUrl, { lookup = dnsLookup } = {}) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${url.protocol}`);
  }
  validateHostname(url.hostname);

  if (isBareIPv4(url.hostname)) {
    return { url, address: url.hostname };
  }
  if (url.hostname.includes(":")) {
    // validateHostname 已拒绝 IPv6;保留 fail-closed 防御。
    throw new Error(`IPv6 addresses are blocked for web_fetch: ${url.hostname}`);
  }

  const resolved = await lookup(url.hostname, { family: 4, all: true });
  const addresses = normalizeLookupResults(resolved);
  if (addresses.length === 0) throw new Error(`DNS returned no IPv4 address: ${url.hostname}`);
  for (const address of addresses) validateResolvedAddress(address, url.hostname);
  // 网络层必须直连这个已验证地址,避免 fetch 再次 DNS 解析产生 rebinding/TOCTOU。
  return { url, address: addresses[0] };
}

export async function validateFetchUrl(rawUrl, options = {}) {
  return (await resolveFetchTarget(rawUrl, options)).url;
}

export function validateHostname(hostname) {
  const normalized = stripBrackets(hostname.toLowerCase());
  validateResolvedAddress(normalized, hostname);
}

export function validateResolvedAddress(address, label = address) {
  const normalized = stripBrackets(String(address).toLowerCase());
  if (normalized === "localhost") throw new Error(`blocked internal hostname: ${label}`);
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (isBlockedAddress(mapped)) {
      throw new Error(`blocked internal IPv4-mapped IPv6 address: ${label}`);
    }
  }
  if (normalized.includes(":")) {
    throw new Error(`IPv6 addresses are blocked for web_fetch: ${label}`);
  }
  if (isPrivateIPv4(normalized)) throw new Error(`blocked private network: ${label}`);
  if (isReservedIPv4(normalized)) throw new Error(`blocked reserved network: ${label}`);
}

function normalizeLookupResults(resolved) {
  const entries = Array.isArray(resolved) ? resolved : [resolved];
  return [...new Set(entries
    .map((item) => typeof item === "string" ? item : item?.address)
    .filter((address) => net.isIP(address) === 4))];
}

function isBlockedAddress(normalized) {
  return normalized === "localhost" || isPrivateIPv4(normalized) || isReservedIPv4(normalized);
}

export function isPrivateIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const nums = ip.split(".").map(Number);
  if (nums[0] === 10) return true;
  if (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) return true;
  if (nums[0] === 192 && nums[1] === 168) return true;
  return false;
}

export function isReservedIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b, c, d] = ip.split(".").map(Number);
  if (a === 0) return true;                            // current network / software
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT 100.64/10
  if (a === 127) return true;                          // loopback
  if (a === 169 && b === 254) return true;             // link-local
  if (a === 192 && b === 0 && c === 0) return true;   // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true;   // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast(deprecated)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18/15
  if (a === 198 && b === 51 && c === 100) return true;  // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;   // TEST-NET-3
  if (a >= 224) return true;                           // multicast / reserved / broadcast
  return a === 255 && b === 255 && c === 255 && d === 255;
}

function isBareIPv4(hostname) {
  return net.isIP(hostname) === 4;
}

function stripBrackets(value) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}
