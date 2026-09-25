"use client";

import React, { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CopilotEvidenceView } from "@axora24/contracts";
import { Bot, Check, MessageSquarePlus, Send, ShieldCheck, X } from "lucide-react";
import { MODE_LABEL, SOURCE_TYPE_LABEL, accessSummary, copilotApi } from "../../lib/modules/copilot";
import { formatDateTime } from "../../lib/format";
import { errorMessage, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { DataTable, Empty, Feedback, Loading, PageHeader, Panel, Tabs } from "../../components/ui";

type TabId = "chat" | "audit";

export default function CopilotPage(): React.ReactElement {
  const session = useSession();
  const canAudit = session.can("ai.evidence.read");
  const [tab, setTab] = useState<TabId>("chat");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<CopilotEvidenceView[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const capabilities = useResource(() => copilotApi.capabilities());
  const sessions = useResource(() => copilotApi.sessions());
  const audit = useResource(() => (tab === "audit" && canAudit ? copilotApi.evidence() : Promise.resolve([])), [tab]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [exchanges.length]);

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError("");
    try {
      const result = await copilotApi.ask(trimmed, sessionId ?? undefined);
      setSessionId(result.sessionId);
      setExchanges((current) => [...current, result.evidence]);
      setQuestion("");
      void sessions.reload();
    } catch (caught) {
      setError(errorMessage(caught, "Le copilote n'a pas pu répondre."));
    } finally {
      setPending(false);
    }
  }

  async function open(id: string): Promise<void> {
    try {
      const detail = await copilotApi.session(id);
      setSessionId(detail.id);
      setExchanges(detail.exchangesDetail);
      setTab("chat");
    } catch (caught) {
      setError(errorMessage(caught, "Conversation indisponible."));
    }
  }

  const granted = (capabilities.data ?? []).filter((capability) => capability.granted);

  return (
    <>
      <PageHeader
        breadcrumb="Pilotage / Copilote"
        title="Copilote AXORA"
        subtitle="Réponses composées uniquement à partir des données de l'ERP que vos droits permettent de lire, chaque affirmation citée. Aucun modèle génératif n'est appelé ; chaque échange laisse une preuve inaltérable."
      />
      <Feedback error={error || capabilities.error || sessions.error} />
      {canAudit && (
        <Tabs
          tabs={[
            { id: "chat", label: "Conversation" },
            { id: "audit", label: "Journal des preuves" },
          ]}
          active={tab}
          onChange={setTab}
        />
      )}

      {tab === "chat" && (
        <div className="copilot-layout">
          <aside className="copilot-sessions" aria-label="Conversations">
            <button
              type="button"
              className="copilot-new"
              onClick={() => {
                setSessionId(null);
                setExchanges([]);
              }}
            >
              <MessageSquarePlus size={15} aria-hidden="true" /> Nouvelle conversation
            </button>
            {(sessions.data ?? []).map((row) => (
              <button key={row.id} type="button" className={row.id === sessionId ? "active" : ""} onClick={() => void open(row.id)}>
                <strong>{row.title}</strong>
                <small>
                  {row.exchanges} échange(s) · {formatDateTime(row.lastActivityAt)}
                </small>
              </button>
            ))}
          </aside>

          <section className="copilot-chat">
            <div className="copilot-thread" aria-live="polite">
              {exchanges.length === 0 &&
                (capabilities.loading ? (
                  <Loading label="Chargement de vos accès…" />
                ) : (
                  <div className="copilot-welcome">
                    <Bot size={28} aria-hidden="true" />
                    <h2>Que voulez-vous savoir ?</h2>
                    <p>
                      Vos droits me donnent accès à {granted.length} source(s) de données. Je peux aussi faire une synthèse ou consulter une pièce par sa référence (ex. DA-2026-0007).
                    </p>
                    <div className="copilot-suggestions">
                      {["Fais-moi une synthèse de la situation", ...granted.map((capability) => capability.example)].slice(0, 7).map((example) => (
                        <button key={example} type="button" onClick={() => void send(example)} disabled={pending}>
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              {exchanges.map((exchange) => (
                <Exchange key={exchange.id} exchange={exchange} />
              ))}
              {pending && <Loading label="Consultation des sources autorisées…" />}
              <div ref={endRef} />
            </div>
            <form
              className="copilot-input"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                void send(question);
              }}
            >
              <input aria-label="Votre question" placeholder="Ex. : quelles factures clients sont impayées ?" value={question} maxLength={500} onChange={(event) => setQuestion(event.currentTarget.value)} disabled={pending} />
              <button type="submit" className="primary-inline-button" disabled={pending || !question.trim()}>
                <Send size={15} aria-hidden="true" /> Envoyer
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === "audit" && canAudit && (
        <Panel title="Journal des preuves d'inférence" subtitle="Append-only : question, contrôles d'accès appliqués au demandeur, sources citées et empreinte SHA-256 de la réponse (vérifiée par la base).">
          {audit.loading && !audit.data ? (
            <Loading label="Chargement du journal…" />
          ) : (
            <DataTable
              rows={audit.data ?? []}
              empty={<Empty icon={<ShieldCheck size={22} />} title="Aucune preuve" body="Chaque question posée au copilote apparaîtra ici." />}
              columns={[
                { key: "at", header: "Date", render: (row) => formatDateTime(row.createdAt) },
                {
                  key: "question",
                  header: "Question",
                  render: (row) => (
                    <>
                      <strong>{row.question}</strong>
                      <small>
                        {row.userName} · {MODE_LABEL[row.mode]}
                      </small>
                    </>
                  ),
                },
                { key: "access", header: "Contrôle d'accès", render: (row) => accessSummary(row.permissionChecks) },
                { key: "sources", header: "Sources citées", align: "right", render: (row) => String(row.sources.length) },
                { key: "hash", header: "Empreinte", render: (row) => <code className="copilot-hash">{row.answerSha256.slice(0, 16)}…</code> },
              ]}
            />
          )}
        </Panel>
      )}
    </>
  );
}

function Exchange({ exchange }: { exchange: CopilotEvidenceView }): React.ReactElement {
  const [details, setDetails] = useState(false);
  const byIndex = new Map(exchange.sources.map((source) => [source.index, source]));
  return (
    <article className="copilot-exchange">
      <p className="copilot-question">{exchange.question}</p>
      <div className="copilot-answer">
        {exchange.blocks.map((block, blockIndex) => (
          <section key={blockIndex} className={block.tool === "rbac" ? "copilot-denied" : undefined}>
            <h3>{block.title}</h3>
            <ul>
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {line.text}
                  {line.cites.map((cite) => {
                    const source = byIndex.get(cite);
                    return source?.link ? (
                      <Link key={cite} href={source.link} className="copilot-cite" title={source.label}>
                        [{cite}]
                      </Link>
                    ) : (
                      <span key={cite} className="copilot-cite">
                        [{cite}]
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {exchange.sources.length > 0 && (
          <ol className="copilot-sources" aria-label="Sources">
            {exchange.sources.map((source) => (
              <li key={source.index} value={source.index}>
                {source.link ? <Link href={source.link}>{source.label}</Link> : source.label} <small>{SOURCE_TYPE_LABEL[source.resourceType] ?? source.resourceType}</small>
              </li>
            ))}
          </ol>
        )}
        <footer>
          <button type="button" onClick={() => setDetails((value) => !value)} aria-expanded={details}>
            <ShieldCheck size={14} aria-hidden="true" /> {accessSummary(exchange.permissionChecks)} · preuve {exchange.id.slice(-8)}
          </button>
          <span>
            {MODE_LABEL[exchange.mode]} · {exchange.latencyMs} ms · {formatDateTime(exchange.createdAt)}
          </span>
        </footer>
        {details && (
          <div className="copilot-evidence">
            <p>
              Moteur <code>{exchange.engine}</code> — {exchange.modelProvider ? `modèle ${exchange.modelProvider}` : "aucun modèle génératif appelé"} · empreinte SHA-256 <code>{exchange.answerSha256}</code>
            </p>
            <ul>
              {exchange.permissionChecks.map((check) => (
                <li key={check.tool} className={check.granted ? "ok" : "ko"}>
                  {check.granted ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />} {check.label} — <code>{check.permission}</code> {check.granted ? "accordée" : "refusée"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}
