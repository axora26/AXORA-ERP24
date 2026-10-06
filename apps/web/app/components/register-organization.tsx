"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useRegistrationState } from "../lib/registration";
import { Brand } from "./brand";
import { TextField } from "./ui";

export function RegisterOrganization() {
  const router = useRouter();
  const [values, setValues] = useState({ organizationName: "", organizationSlug: "", companyName: "", ownerFullName: "", ownerEmail: "", ownerPassword: "", confirmation: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const registration = useRegistrationState();
  const set = (key: keyof typeof values) => (value: string) => setValues(current => ({ ...current, [key]: value }));
  useEffect(() => { if (error || Object.keys(errors).length) summary.current?.focus(); }, [error, errors]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; setError("");
    const invalid: Record<string, string> = {};
    for (const key of ["organizationName", "companyName", "ownerFullName"] as const) if (values[key].trim().length < 2) invalid[key] = "Saisissez au moins 2 caractères.";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.organizationSlug) || values.organizationSlug.length < 3 || values.organizationSlug.length > 60) invalid.organizationSlug = "Utilisez 3 à 60 lettres minuscules, chiffres ou tirets.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.ownerEmail.trim())) invalid.ownerEmail = "Saisissez une adresse e-mail valide.";
    if (values.ownerPassword.length < 12 || values.ownerPassword.length > 256) invalid.ownerPassword = "Le mot de passe doit contenir entre 12 et 256 caractères.";
    if (values.confirmation !== values.ownerPassword) invalid.confirmation = "Les mots de passe ne correspondent pas.";
    setErrors(invalid); if (Object.keys(invalid).length) return;
    setSaving(true);
    try {
      await api.post("/auth/register-organization", { organizationName: values.organizationName.trim(), organizationSlug: values.organizationSlug, companyName: values.companyName.trim(), ownerFullName: values.ownerFullName.trim(), ownerEmail: values.ownerEmail.trim(), ownerPassword: values.ownerPassword });
      router.replace("/");
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 429 ? "La limite de création d’espaces est atteinte. Réessayez dans quelques minutes." : reason instanceof ApiError && reason.status === 403 ? "La création d’espaces est fermée sur cette instance. Demandez un accès à votre administrateur." : reason instanceof ApiError ? reason.message : "La création de votre espace a échoué. Réessayez.");
    } finally { setSaving(false); }
  }

  return <main className="login-page"><section className="login-story" aria-label="Votre nouvel espace AXORA"><Brand/><div className="story-content"><span className="eyebrow light"><Building2 size={16}/>Votre espace commence ici</span><h1>Construisez une base commune pour votre équipe.</h1><p>Créez votre organisation et sa première entreprise. Vous pourrez ensuite ajouter vos collaborateurs et commencer à piloter vos opérations.</p><div className="trust-row"><span><ShieldCheck size={18}/>Des accès propres à votre organisation</span></div></div><p className="story-foot">AXORA GROUP · Gestion d’entreprise</p></section><section className="login-panel register-panel"><div className="mobile-brand"><Brand/></div><div className="login-card register-card"><span className="eyebrow">Nouvelle organisation</span><h2>Créer votre espace</h2>{registration === "closed" ? <><div className="form-error" role="status"><strong>Création d’espaces fermée</strong><p>Cette instance est privée. Demandez à votre administrateur de vous créer un accès depuis l’administration.</p></div><p className="registration-login"><Link href="/login">Retour à la connexion</Link></p></> : <><p className="login-intro">Vous serez le premier administrateur de cet espace.</p><form noValidate onSubmit={event => void submit(event)} className="registration-form">{(error || Object.keys(errors).length > 0) && <div className="form-error" role="alert" tabIndex={-1} ref={summary}><strong>Vérifiez les informations</strong>{error && <p>{error}</p>}<ul>{Object.entries(errors).map(([key, message]) => <li key={key}><a href={`#${key}`}>{message}</a></li>)}</ul></div>}<TextField id="organizationName" label="Nom de l’organisation" value={values.organizationName} onChange={value => { setValues(current => ({ ...current, organizationName: value, ...(!slugEdited ? { organizationSlug: value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") } : {}) })); }} required error={errors.organizationName} autoComplete="organization" maxLength={120}/><TextField id="organizationSlug" label="Identifiant de l’espace" value={values.organizationSlug} onChange={value => { setSlugEdited(true); set("organizationSlug")(value); }} required hint="Exemple : axora-construction. Conservez cet identifiant pour vos connexions." error={errors.organizationSlug} maxLength={60}/><TextField id="companyName" label="Première entreprise" value={values.companyName} onChange={set("companyName")} required error={errors.companyName} maxLength={120}/><TextField id="ownerFullName" label="Votre nom complet" value={values.ownerFullName} onChange={set("ownerFullName")} required error={errors.ownerFullName} autoComplete="name" maxLength={120}/><TextField id="ownerEmail" label="Adresse e-mail professionnelle" type="email" value={values.ownerEmail} onChange={set("ownerEmail")} required error={errors.ownerEmail} autoComplete="username"/><TextField id="ownerPassword" label="Mot de passe" type="password" value={values.ownerPassword} onChange={set("ownerPassword")} required error={errors.ownerPassword} minLength={12} maxLength={256} autoComplete="new-password" hint="12 caractères minimum. Les phrases de passe sont acceptées."/><TextField id="confirmation" label="Confirmer le mot de passe" type="password" value={values.confirmation} onChange={set("confirmation")} required error={errors.confirmation} autoComplete="new-password" maxLength={256}/><button className="primary-button" type="submit" disabled={saving}>{saving ? "Création de votre espace…" : <>Créer mon organisation<ArrowRight size={18}/></>}</button></form><p className="registration-login">Vous avez déjà un espace ? <Link href="/login">Se connecter</Link></p></>}</div></section></main>;
}
