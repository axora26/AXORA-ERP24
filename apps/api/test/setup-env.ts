// Valeurs de test fixees AVANT le chargement du .env du monorepo : le .env de
// developpement active le planificateur (AUTOMATION_AUTORUN=true), ce qui
// rendait les tests du moteur de workflow dependants du timing. Une variable
// reellement definie dans l'environnement (CI) reste prioritaire.
//  - AUTOMATION_AUTORUN=false : traitement explicite (POST /workflow/run).
//  - WEBHOOK_ALLOW_PRIVATE_TARGETS=true : recepteurs HTTP locaux des tests.
process.env.AUTOMATION_AUTORUN ??= "false";
process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS ??= "true";
await import("../src/config/load-env.js");
