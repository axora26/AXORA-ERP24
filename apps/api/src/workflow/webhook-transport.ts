import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(address, prefix, "ipv4");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blockedV6.addSubnet(address, prefix, "ipv6");

export function isPublicWebhookAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
  return false;
}

export interface WebhookAddress { address: string; family: number }
export type WebhookResolver = (hostname: string) => Promise<WebhookAddress[]>;
const resolve: WebhookResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export async function resolveWebhookAddress(
  hostname: string, allowPrivateTargets: boolean, resolver: WebhookResolver = resolve,
): Promise<WebhookAddress> {
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await resolver(hostname);
  if (!addresses.length || addresses.some(({ address, family }) =>
    isIP(address) !== family || (!allowPrivateTargets && !isPublicWebhookAddress(address)))) {
    throw new Error("Cible refusée : résolution DNS non publique");
  }
  return addresses[0]!;
}

/** Resolves once and pins the validated IP; TLS still authenticates the original hostname. */
export async function postWebhook(
  rawUrl: string, body: string, headers: Record<string, string>,
  options: { allowPrivateTargets: boolean; timeoutMs: number; resolver?: WebhookResolver },
): Promise<{ status: number }> {
  const url = new URL(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.username || url.password ||
    (url.protocol !== "https:" && !(options.allowPrivateTargets && url.protocol === "http:"))) {
    throw new Error("Cible refusée : HTTPS obligatoire et identifiants interdits");
  }
  const controller = new AbortController();
  const timeout = new Error("Webhook timeout");
  timeout.name = "TimeoutError";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(timeout); reject(timeout); }, options.timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const target = await resolveWebhookAddress(hostname, options.allowPrivateTargets, options.resolver);
      if (controller.signal.aborted) throw timeout;
      return await new Promise<{ status: number }>((accept, reject) => {
        const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: "POST", headers, agent: false, family: target.family,
          signal: controller.signal,
          lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
        }, (response) => {
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > 65_536) response.destroy(new Error("Réponse webhook trop volumineuse"));
          });
          response.on("error", reject);
          response.on("end", () => accept({ status: response.statusCode ?? 0 }));
        });
        request.on("error", reject);
        request.end(body);
      });
    })()]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
