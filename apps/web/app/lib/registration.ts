"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export type RegistrationState = "loading" | "open" | "closed";

/**
 * Politique publique de creation d'espaces (GET /auth/registration).
 * En cas d'erreur, l'etat reste "open" : le serveur reste l'autorite et
 * refusera de toute facon une inscription fermee (403).
 */
export function useRegistrationState(): RegistrationState {
  const [state, setState] = useState<RegistrationState>("loading");
  useEffect(() => {
    let active = true;
    api
      .get<{ open: boolean }>("/auth/registration")
      .then((result) => {
        if (active) setState(result.open ? "open" : "closed");
      })
      .catch(() => {
        if (active) setState("open");
      });
    return () => {
      active = false;
    };
  }, []);
  return state;
}
