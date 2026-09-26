-- Transactional order, shipping, and refund emails are outside Nomi's scope.
ALTER TABLE "ShopSettings" DROP COLUMN "sendReceiptEmails";
