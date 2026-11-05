-- The NextRotta's own team: besides the owner there are support users ("atendentes"), who answer the Reports and the Livechat and look at
-- the companies, nothing else. Like the owner they belong to no organization (organization_id is null).

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('platform_owner', 'platform_support', 'admin', 'technician'));

ALTER TABLE users DROP CONSTRAINT users_owner_has_no_organization;
ALTER TABLE users ADD CONSTRAINT users_platform_has_no_organization
  CHECK ((role IN ('platform_owner', 'platform_support')) = (organization_id IS NULL));
