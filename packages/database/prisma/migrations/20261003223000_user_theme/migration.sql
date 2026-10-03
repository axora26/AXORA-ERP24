ALTER TABLE "users" ADD COLUMN "themePreference" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "users" ADD CONSTRAINT "user_theme_preference_valid"
  CHECK ("themePreference" IN ('light', 'dark', 'system'));
