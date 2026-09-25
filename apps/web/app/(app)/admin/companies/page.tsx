"use client";

import React, { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { adminApi } from "../../../lib/modules/admin";
import { formatDate } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { Button, DataTable, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, TextField } from "../../../components/ui";

export default function CompaniesPage(): React.ReactElement {
  const companies = useResource(() => adminApi.companies());
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");

  return (
    <>
      <PageHeader
        breadcrumb="Administration / Entreprises"
        title="Entreprises"
        subtitle="Sociétés, filiales et agences de l'organisation. Chaque donnée métier appartient à une entreprise."
        onRefresh={() => void companies.reload()}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" /> Nouvelle entreprise
          </Button>
        }
      />
      <Feedback error={companies.error || mutation.error} notice={mutation.notice} />
      {companies.loading && !companies.data ? (
        <Loading label="Chargement des entreprises…" />
      ) : (
        <Panel title="Entreprises de l'organisation">
          <DataTable
            rows={companies.data ?? []}
            empty={<Empty icon={<Building2 size={22} />} title="Aucune entreprise" />}
            columns={[
              {
                key: "name",
                header: "Entreprise",
                render: (company) => (
                  <>
                    <strong>{company.name}</strong>
                    {company.legalName && <small>{company.legalName}</small>}
                  </>
                ),
              },
              { key: "members", header: "Membres", render: (company) => company.memberCount, align: "right" },
              { key: "created", header: "Créée le", render: (company) => formatDate(company.createdAt) },
            ]}
          />
        </Panel>
      )}
      {creating && (
        <Modal title="Nouvelle entreprise" onClose={() => setCreating(false)}>
          <Feedback error={mutation.error} />
          <Form
            columns={1}
            submitLabel="Créer l'entreprise"
            saving={mutation.saving}
            onSubmit={async () => {
              const created = await mutation.run(
                () => adminApi.createCompany({ name, legalName: legalName || undefined }),
                `Entreprise « ${name} » créée. Vous en êtes membre.`,
              );
              if (created) {
                setCreating(false);
                setName("");
                setLegalName("");
                await companies.reload();
              }
            }}
          >
            <TextField label="Nom" value={name} onChange={setName} required />
            <TextField label="Raison sociale" value={legalName} onChange={setLegalName} />
          </Form>
        </Modal>
      )}
    </>
  );
}
