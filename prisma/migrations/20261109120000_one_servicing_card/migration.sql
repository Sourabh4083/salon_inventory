-- One Calls card per customer for servicing and replacement (it turns into a replacement card
-- when the replacement date comes), instead of a servicing card and a replacement card side by side.
BEGIN;

-- Drop the separate replacement card where the same purchase still has an open servicing card,
-- unless the staff already called it.
DELETE FROM "Enquiry" r
WHERE r.kind = 'REPLACE'
  AND r.status IN ('NEW', 'NO_ANSWER', 'CALL_BACK', 'COMING')
  AND NOT EXISTS (SELECT 1 FROM "EnquiryCall" c WHERE c."enquiryId" = r.id)
  AND EXISTS (
    SELECT 1 FROM "Enquiry" s
    WHERE s.kind = 'SERVICE' AND s."sourceBillId" = r."sourceBillId" AND s.status IN ('NEW', 'NO_ANSWER', 'CALL_BACK', 'COMING')
  );

-- A replacement card the staff already called stays; then the uncalled servicing card goes.
DELETE FROM "Enquiry" s
WHERE s.kind = 'SERVICE'
  AND s.status IN ('NEW', 'NO_ANSWER', 'CALL_BACK', 'COMING')
  AND NOT EXISTS (SELECT 1 FROM "EnquiryCall" c WHERE c."enquiryId" = s.id)
  AND EXISTS (
    SELECT 1 FROM "Enquiry" r
    WHERE r.kind = 'REPLACE' AND r."sourceBillId" = s."sourceBillId" AND r.status IN ('NEW', 'NO_ANSWER', 'CALL_BACK', 'COMING')
  );

COMMIT;
