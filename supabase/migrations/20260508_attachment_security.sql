create or replace function assert_attachment_org_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  related_org uuid;
begin
  if new.vehicle_id is not null then
    select organization_id into related_org from vehicles where id = new.vehicle_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment vehicle organization mismatch';
    end if;
  end if;

  if new.expense_id is not null then
    select organization_id into related_org from vehicle_expenses where id = new.expense_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment expense organization mismatch';
    end if;
  end if;

  if new.sale_id is not null then
    select organization_id into related_org from sales where id = new.sale_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment sale organization mismatch';
    end if;
  end if;

  if new.contact_id is not null then
    select organization_id into related_org from contacts where id = new.contact_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment contact organization mismatch';
    end if;
  end if;

  if new.company_cash_transaction_id is not null then
    select organization_id into related_org from company_cash_transactions where id = new.company_cash_transaction_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment company cash organization mismatch';
    end if;
  end if;

  if new.external_cash_transaction_id is not null then
    select organization_id into related_org from external_cash_transactions where id = new.external_cash_transaction_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment external cash organization mismatch';
    end if;
  end if;

  if new.type in ('file', 'photo') and new.url_or_path not like ('organizations/' || new.organization_id::text || '/%') then
    raise exception 'private file path must be scoped to the organization';
  end if;

  if new.type = 'link' and new.url_or_path !~* '^https?://' then
    raise exception 'links must use http or https';
  end if;

  return new;
end;
$$;

drop trigger if exists attachments_org_match on attachments;
create trigger attachments_org_match
before insert or update on attachments
for each row execute function assert_attachment_org_match();

