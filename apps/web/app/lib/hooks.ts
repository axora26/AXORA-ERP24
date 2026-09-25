"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export function errorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return `Accès refusé : ${caught.message}`;
    return caught.message;
  }
  return fallback;
}

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

/**
 * Chargement d'une ressource API avec etats loading / erreur explicites.
 * `deps` relance le chargement (ex. changement d'identifiant selectionne).
 */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      const result = await loaderRef.current();
      setData(result);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught, "Chargement impossible."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, deps);

  return { data, loading, error, reload };
}

export interface Mutation {
  saving: boolean;
  error: string;
  notice: string;
  run: <T>(action: () => Promise<T>, success?: string, fallback?: string) => Promise<T | undefined>;
  clear: () => void;
  setError: (message: string) => void;
}

/** Execution d'une mutation avec retour utilisateur explicite (succes / erreur). */
export function useMutation(): Mutation {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string, fallback = "Opération impossible.") => {
      setSaving(true);
      setError("");
      setNotice("");
      try {
        const result = await action();
        if (success) setNotice(success);
        return result;
      } catch (caught) {
        setError(errorMessage(caught, fallback));
        return undefined;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setError("");
    setNotice("");
  }, []);

  return { saving, error, notice, run, clear, setError };
}

/** Etat de formulaire simple a champs texte. */
export function useForm<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = useCallback(
    (field: keyof T) => (value: string) => setValues((current) => ({ ...current, [field]: value })),
    [],
  );
  const reset = useCallback(() => setValues(initial), [initial]);
  return { values, set, reset, setValues };
}
