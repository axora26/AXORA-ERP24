-- Preserve grants while following the three-part permission naming convention.
DO $$
DECLARE old_id text; new_id text;
BEGIN
  SELECT id INTO old_id FROM permissions WHERE key = 'hr.payroll.policy.manage';
  SELECT id INTO new_id FROM permissions WHERE key = 'hr.payrollpolicy.manage';
  IF old_id IS NOT NULL AND new_id IS NULL THEN
    UPDATE permissions SET key = 'hr.payrollpolicy.manage' WHERE id = old_id;
  ELSIF old_id IS NOT NULL AND new_id IS NOT NULL THEN
    INSERT INTO role_permissions (id, "roleId", "permissionId")
      SELECT 'perm-migrate-' || gen_random_uuid()::text, "roleId", new_id
      FROM role_permissions WHERE "permissionId" = old_id
      ON CONFLICT ("roleId", "permissionId") DO NOTHING;
    DELETE FROM permissions WHERE id = old_id;
  END IF;
END $$;
