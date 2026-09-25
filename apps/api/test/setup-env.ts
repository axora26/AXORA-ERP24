import "../src/config/load-env.js";

// Moteur d'automatisation : traitement explicite (POST /workflow/run) pour des
// assertions deterministes ; cibles webhook locales admises (recepteur de test).
process.env.AUTOMATION_AUTORUN ??= "false";
process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS ??= "true";
