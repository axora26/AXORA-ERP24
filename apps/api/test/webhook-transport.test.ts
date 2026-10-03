import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { isPublicWebhookAddress, postWebhook, resolveWebhookAddress } from "../src/workflow/webhook-transport.js";
import { signWebhook, verifyWebhook, webhookTargetRefusal } from "../src/workflow/engine.js";

async function receiver(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://hooks.example.com:${port}/events`, close: async () => {
    server.closeAllConnections();
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  } };
}
const localResolver = async () => [{ address: "127.0.0.1", family: 4 }];

describe("Outgoing webhook transport", () => {
  it("accepts public IPv4 and global IPv6 and rejects private, mapped and reserved addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPublicWebhookAddress(address), address).toBe(true);
    }
    for (const address of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254",
      "172.31.1.2", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
      "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8",
      "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2001::1", "2002:7f00:1::1", "3fff::1", "invalid"]) {
      expect(isPublicWebhookAddress(address), address).toBe(false);
    }
    expect(webhookTargetRefusal("https://fc-public.example.com/events", false)).toBeNull();
    expect(webhookTargetRefusal("https://[2001:db8::1]/events", false)).not.toBeNull();
  });

  it("rejects DNS private resolution, mixed answers, invalid families and empty answers", async () => {
    for (const addresses of [[], [{ address: "127.0.0.1", family: 4 }],
      [{ address: "8.8.8.8", family: 4 }, { address: "::1", family: 6 }],
      [{ address: "::ffff:127.0.0.1", family: 6 }], [{ address: "8.8.8.8", family: 6 }]]) {
      await expect(resolveWebhookAddress("hooks.example.com", false, async () => addresses)).rejects.toThrow("DNS non publique");
    }
  });

  it("pins the resolved IP, preserves the original Host and delivers the signed body once", async () => {
    let resolutions = 0;
    let requests = 0;
    let received = "";
    let host = "";
    let verified = false;
    const body = JSON.stringify({ type: "crm.lead.created", amount: "152.41" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = "test-only-secret";
    const hook = await receiver((request, response) => {
      requests += 1; host = request.headers.host ?? "";
      request.on("data", (chunk: Buffer) => { received += chunk.toString(); });
      request.on("end", () => {
        verified = verifyWebhook(secret, String(request.headers["x-axora-timestamp"]), received, String(request.headers["x-axora-signature"]));
        response.writeHead(204); response.end();
      });
    });
    try {
      const response = await postWebhook(hook.url, body, {
        "x-axora-timestamp": timestamp, "x-axora-signature": signWebhook(secret, timestamp, body),
      }, { allowPrivateTargets: true, timeoutMs: 2000, resolver: async () => {
        resolutions += 1;
        return [{ address: resolutions === 1 ? "127.0.0.1" : "10.0.0.1", family: 4 }];
      } });
      expect(response.status).toBe(204);
      expect({ resolutions, requests, received, verified, host }).toEqual({ resolutions: 1, requests: 1, received: body, verified: true, host: new URL(hook.url).host });
    } finally { await hook.close(); }
  });

  it("does not follow redirects", async () => {
    let requests = 0;
    const hook = await receiver((_request, response) => {
      requests += 1; response.writeHead(302, { location: "/another-event" }); response.end();
    });
    try {
      expect((await postWebhook(hook.url, "{}", {}, { allowPrivateTargets: true, timeoutMs: 2000, resolver: localResolver })).status).toBe(302);
      expect(requests).toBe(1);
    } finally { await hook.close(); }
  });

  it("bounds the response body", async () => {
    const hook = await receiver((_request, response) => { response.end(Buffer.alloc(70_000)); });
    try {
      await expect(postWebhook(hook.url, "{}", {}, { allowPrivateTargets: true, timeoutMs: 2000, resolver: localResolver })).rejects.toThrow("trop volumineuse");
    } finally { await hook.close(); }
  });

  it("bounds both DNS resolution and a stalled receiver", async () => {
    await expect(postWebhook("https://hooks.example.com/events", "{}", {}, {
      allowPrivateTargets: false, timeoutMs: 30, resolver: () => new Promise(() => undefined),
    })).rejects.toMatchObject({ name: "TimeoutError" });
    const hook = await receiver(() => undefined);
    try {
      await expect(postWebhook(hook.url, "{}", {}, { allowPrivateTargets: true, timeoutMs: 30, resolver: localResolver })).rejects.toMatchObject({ name: "TimeoutError" });
    } finally { await hook.close(); }
  });

  it("never contacts a private DNS target without the explicit local policy", async () => {
    let requests = 0;
    const hook = await receiver((_request, response) => { requests += 1; response.end(); });
    try {
      await expect(postWebhook(hook.url.replace("http:", "https:"), "{}", {}, {
        allowPrivateTargets: false, timeoutMs: 2000, resolver: localResolver,
      })).rejects.toThrow("DNS non publique");
      expect(requests).toBe(0);
    } finally { await hook.close(); }
  });
});
