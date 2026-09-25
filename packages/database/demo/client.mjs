/**
 * Client HTTP minimal pour le jeu de donnees DEMO : il passe par l'API
 * REELLE (memes regles metier, RBAC et audit qu'un utilisateur), jamais par
 * des insertions SQL directes.
 */
export function createClient(baseUrl) {
  let cookie = "";

  async function call(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    get: (path) => call("GET", path),
    post: (path, body = {}) => call("POST", path, body),
    patch: (path, body = {}) => call("PATCH", path, body),
    put: (path, body = {}) => call("PUT", path, body),
    hasSession: () => cookie !== "",
  };
}
