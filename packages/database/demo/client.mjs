/**
 * Client HTTP minimal pour le jeu de donnees DEMO : il passe par l'API
 * REELLE (memes regles metier, RBAC et audit qu'un utilisateur), jamais par
 * des insertions SQL directes.
 */
export function createClient(baseUrl) {
  let cookie = "";

  async function call(method, path, body) {
    const multipart = body instanceof FormData;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(multipart ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
      const error = new Error(`${method} ${path} -> ${response.status} ${message ?? text}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  return {
    baseUrl,
    get: (path) => call("GET", path),
    post: (path, body = {}) => call("POST", path, body),
    patch: (path, body = {}) => call("PATCH", path, body),
    put: (path, body = {}) => call("PUT", path, body),
    delete: (path) => call("DELETE", path),
    /** Televersement multipart reel (meme chemin que le navigateur). */
    upload: (content, filename, contentType = "application/octet-stream") => {
      const form = new FormData();
      form.append("file", new Blob([content], { type: contentType }), filename);
      return call("POST", "/files", form);
    },
    hasSession: () => cookie !== "",
  };
}

/** Client machine d'une passerelle GTB (jeton porteur) : meme API que les passerelles de terrain. */
export function createGatewayClient(baseUrl, token) {
  async function call(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${data?.message ?? ""}`);
    return data;
  }
  return {
    readings: (readings) => call("POST", "/smart/gateway/readings", { readings }),
    setpoints: () => call("GET", "/smart/gateway/setpoints"),
    ack: (id, body) => call("POST", `/smart/gateway/setpoints/${id}/ack`, body),
  };
}
