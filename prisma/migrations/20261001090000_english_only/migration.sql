-- Emails are English only for now (2026-10-01): reset any other saved language.
UPDATE "ShopSettings" SET "language" = 'en' WHERE "language" <> 'en';
