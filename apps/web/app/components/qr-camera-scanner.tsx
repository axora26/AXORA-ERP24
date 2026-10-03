"use client";
import React, { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Modal } from "./ui";

export function QrCameraScanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }): React.ReactElement {
  const video = useRef<HTMLVideoElement>(null);
  const resultCallback = useRef(onResult);
  resultCallback.current = onResult;
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    const element = video.current;
    const stop = () => {
      if (stopped) return;
      stopped = true; controls?.stop();
      const stream = element?.srcObject;
      if (stream && "getTracks" in stream) (stream as MediaStream).getTracks().forEach(track => track.stop());
      if (element) element.srcObject = null;
    };
    async function start(): Promise<void> {
      if (!navigator.mediaDevices?.getUserMedia || !element) { setError("La caméra est indisponible dans ce navigateur. Utilisez un lecteur USB ou saisissez le code de la carte."); return; }
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (!active) return;
        const reader = new BrowserQRCodeReader();
        const started = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, element, result => {
          if (!active || !result) return;
          active = false;
          resultCallback.current(result.getText());
          stop();
        });
        controls = started;
        if (!active) { started.stop(); stop(); return; }
        setReady(true);
      } catch (caught) {
        if (!active) return;
        const name = caught instanceof Error ? caught.name : "";
        setError(name === "NotAllowedError" ? "L’accès à la caméra a été refusé. Autorisez-le dans votre navigateur ou utilisez un lecteur USB." : name === "NotFoundError" ? "Aucune caméra n’a été trouvée. Branchez une caméra ou utilisez un lecteur USB." : "La caméra n’a pas pu démarrer. Fermez les autres applications qui l’utilisent, puis réessayez.");
        stop();
      }
    }
    void start();
    return () => { active = false; stop(); controls?.stop(); };
  }, []);
  return <Modal title="Scanner une carte de service" onClose={onClose}><p className="inline-note">Placez le QR code de la carte devant la caméra. Après lecture, choisissez Entrée ou Sortie pour enregistrer le pointage.</p><div className="qr-camera-frame"><video ref={video} autoPlay playsInline muted aria-label="Aperçu de la caméra" />{!ready && !error && <p role="status"><Camera size={20} aria-hidden="true" />Ouverture de la caméra…</p>}</div>{error && <div className="form-error" role="alert"><CameraOff size={18} aria-hidden="true" />{error}</div>}<button type="button" className="secondary-button" onClick={onClose}>Fermer la caméra</button></Modal>;
}
