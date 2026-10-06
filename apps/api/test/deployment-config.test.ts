import { describe, expect, it } from "vitest";
import { registrationAllowed, registrationMode } from "../src/auth/registration-policy.js";
import { trustProxySetting } from "../src/config/trust-proxy.js";

describe("Politique d'inscription (REGISTRATION_MODE)", () => {
  it("reste ouverte par defaut, comme avant", () => {
    expect(registrationMode({})).toBe("open");
    expect(registrationMode({ REGISTRATION_MODE: "" })).toBe("open");
  });

  it("accepte les trois modes, sans tenir compte de la casse ni des espaces", () => {
    expect(registrationMode({ REGISTRATION_MODE: "open" })).toBe("open");
    expect(registrationMode({ REGISTRATION_MODE: " First-Organization " })).toBe("first-organization");
    expect(registrationMode({ REGISTRATION_MODE: "CLOSED" })).toBe("closed");
  });

  it("une valeur inconnue ferme l'inscription (fail-closed)", () => {
    expect(registrationMode({ REGISTRATION_MODE: "yes" })).toBe("closed");
    expect(registrationMode({ REGISTRATION_MODE: "true" })).toBe("closed");
  });

  it("first-organization n'autorise que la toute premiere organisation", () => {
    expect(registrationAllowed("open", 12)).toBe(true);
    expect(registrationAllowed("first-organization", 0)).toBe(true);
    expect(registrationAllowed("first-organization", 1)).toBe(false);
    expect(registrationAllowed("closed", 0)).toBe(false);
  });
});

describe("Proxy de confiance (TRUST_PROXY)", () => {
  it("ne fait confiance a aucun proxy par defaut", () => {
    expect(trustProxySetting({})).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: "" })).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: "false" })).toBe(false);
  });

  it("accepte un nombre de sauts", () => {
    expect(trustProxySetting({ TRUST_PROXY: "2" })).toBe(2);
  });

  it("transmet une liste de sous-reseaux ou de mots-cles Express", () => {
    expect(trustProxySetting({ TRUST_PROXY: "loopback, uniquelocal" })).toEqual(["loopback", "uniquelocal"]);
    expect(trustProxySetting({ TRUST_PROXY: "172.16.0.0/12" })).toEqual(["172.16.0.0/12"]);
  });

  it("refuse la confiance aveugle (true), qui permettrait d'usurper l'adresse IP", () => {
    expect(() => trustProxySetting({ TRUST_PROXY: "true" })).toThrow(/TRUST_PROXY/);
  });
});
