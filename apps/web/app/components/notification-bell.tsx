"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NotificationView } from "@axora24/contracts";
import { Bell, CheckCheck } from "lucide-react";
import { notificationsApi } from "../lib/modules/workflow";
import { formatDateTime } from "../lib/format";

const POLL_MS = 60_000;

/** Cloche de la barre superieure : notifications personnelles (workflows), relevees chaque minute et au retour sur l'onglet. */
export function NotificationBell(): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ unread: number; items: NotificationView[] }>({ unread: 0, items: [] });
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setState(await notificationsApi.mine());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent): void {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openItem(item: NotificationView): Promise<void> {
    setOpen(false);
    if (!item.readAt) setState(await notificationsApi.read(item.id).catch(() => state));
    if (item.link) router.push(item.link);
  }

  return (
    <div className="notification-bell" ref={panelRef}>
      <button
        className="icon-button"
        aria-label={state.unread > 0 ? `Notifications (${state.unread} non lues)` : "Notifications"}
        aria-expanded={open}
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load();
        }}
      >
        <Bell size={19} />
        {state.unread > 0 && <span className="notification-count">{state.unread > 99 ? "99+" : state.unread}</span>}
      </button>
      {open && (
        <div className="notification-panel" role="dialog" aria-label="Notifications">
          <header>
            <strong>Notifications</strong>
            {state.unread > 0 && (
              <button type="button" onClick={() => void notificationsApi.readAll().then(setState).catch(() => undefined)}>
                <CheckCheck size={14} aria-hidden="true" /> Tout marquer comme lu
              </button>
            )}
          </header>
          {failed && <p className="notification-empty">Notifications momentanément indisponibles.</p>}
          {!failed && state.items.length === 0 && <p className="notification-empty">Aucune notification.</p>}
          <ul>
            {state.items.map((item) => (
              <li key={item.id}>
                <button type="button" className={item.readAt ? "" : "unread"} onClick={() => void openItem(item)}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                  <small>{formatDateTime(item.createdAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
