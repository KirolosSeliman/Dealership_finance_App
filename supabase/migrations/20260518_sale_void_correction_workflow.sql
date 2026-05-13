alter table sales
  add column if not exists status text not null default 'active',
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists void_reason text,
  add column if not exists corrected_by_sale_id uuid references sales(id),
  add column if not exists correction_of_sale_id uuid references sales(id);

alter table company_cash_transactions
  add column if not exists source_sale_id uuid references sales(id);

alter table external_cash_transactions
  add column if not exists source_sale_id uuid references sales(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_status_valid') then
    alter table sales add constraint sales_status_valid check (status in ('active', 'voided', 'corrected'));
  end if;
end $$;

alter table sales drop constraint if exists sales_one_per_vehicle;
drop index if exists sales_one_active_per_vehicle_idx;
create unique index sales_one_active_per_vehicle_idx
  on sales (vehicle_id)
  where voided_at is null and status = 'active';

create index if not exists sales_correction_of_sale_idx on sales (correction_of_sale_id);
create index if not exists sales_corrected_by_sale_idx on sales (corrected_by_sale_id);
create index if not exists company_cash_source_sale_idx on company_cash_transactions (source_sale_id);
create index if not exists external_cash_source_sale_idx on external_cash_transactions (source_sale_id);

create or replace function record_vehicle_sale_atomic(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_sale_date date,
  p_taxable_profit_amount numeric,
  p_real_client_payment numeric,
  p_buyer_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  vehicle_total_cost numeric(12,2);
  paper_sale_price numeric(12,2);
  profit_tax_due numeric(12,2);
  external_commission numeric(12,2);
  buyer_contact_id uuid;
  sale_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  select *
  into vehicle_record
  from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id
  for update;

  if vehicle_record.id is null or vehicle_record.archived_at is not null then
    raise exception 'vehicle not found';
  end if;

  if exists (
    select 1
    from sales
    where vehicle_id = p_vehicle_id
      and organization_id = p_organization_id
      and voided_at is null
      and status = 'active'
  ) then
    raise exception 'this vehicle already has an active sale record';
  end if;

  select round((
    vehicle_record.purchase_price
    + coalesce(sum(
      case
        when category = 'vehicle_purchase_price' and vehicle_record.purchase_price > 0 then tax_amount
        else total_amount
      end
    ), 0)
  )::numeric, 2)
  into vehicle_total_cost
  from vehicle_expenses
  where vehicle_id = p_vehicle_id
    and organization_id = p_organization_id;

  paper_sale_price := round((vehicle_total_cost + coalesce(p_taxable_profit_amount, 0))::numeric, 2);
  profit_tax_due := round((coalesce(p_taxable_profit_amount, 0) * 0.22)::numeric, 2);
  external_commission := round((coalesce(p_real_client_payment, 0) - paper_sale_price)::numeric, 2);

  if external_commission < 0 then
    raise exception 'real client payment cannot be lower than the paper sale price';
  end if;

  if nullif(trim(coalesce(p_buyer_name, '')), '') is not null then
    insert into contacts (
      organization_id, type, full_name, phone, email, address, notes, created_by
    )
    values (
      p_organization_id,
      'buyer',
      trim(p_buyer_name),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_email, '')), ''),
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning id into buyer_contact_id;

    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'contact_created', 'contact', buyer_contact_id, trim(p_buyer_name), auth.uid());
  end if;

  insert into sales (
    organization_id,
    vehicle_id,
    contact_id,
    sale_date,
    vehicle_total_cost,
    taxable_profit_amount,
    profit_tax_due,
    paper_sale_price,
    real_client_payment,
    external_commission,
    notes,
    status,
    created_by
  )
  values (
    p_organization_id,
    p_vehicle_id,
    buyer_contact_id,
    coalesce(p_sale_date, current_date),
    vehicle_total_cost,
    coalesce(p_taxable_profit_amount, 0),
    profit_tax_due,
    paper_sale_price,
    coalesce(p_real_client_payment, 0),
    external_commission,
    nullif(trim(coalesce(p_notes, '')), ''),
    'active',
    auth.uid()
  )
  returning id into sale_id;

  update vehicles
  set status = 'sold',
      updated_at = now()
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  if paper_sale_price > 0 then
    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id,
      'paper_sale_received',
      paper_sale_price,
      coalesce(p_sale_date, current_date),
      'Paper sale received',
      p_vehicle_id,
      sale_id,
      auth.uid()
    );
  end if;

  if external_commission > 0 then
    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id,
      'external_commission_earned',
      external_commission,
      coalesce(p_sale_date, current_date),
      'External commission earned',
      p_vehicle_id,
      sale_id,
      auth.uid()
    );
  end if;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_sold', 'vehicle', p_vehicle_id, 'Sale recorded', auth.uid());

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'cash_transaction_created', 'vehicle', p_vehicle_id, 'Sale cash transactions generated', auth.uid());

  return sale_id;
end;
$$;

create or replace function void_vehicle_sale_atomic(
  p_organization_id uuid,
  p_sale_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record sales%rowtype;
  vehicle_record vehicles%rowtype;
  company_original_id uuid;
  external_original_id uuid;
  company_reversal_id uuid;
  external_reversal_id uuid;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if clean_reason is null then
    raise exception 'Sale void reason is required.';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

  select *
  into sale_record
  from sales
  where id = p_sale_id
    and organization_id = p_organization_id
  for update;

  if sale_record.id is null then
    raise exception 'sale not found';
  end if;

  if sale_record.voided_at is not null or sale_record.status <> 'active' then
    raise exception 'sale is already voided or corrected';
  end if;

  select *
  into vehicle_record
  from vehicles
  where id = sale_record.vehicle_id
    and organization_id = p_organization_id
  for update;

  if vehicle_record.id is null then
    raise exception 'vehicle not found';
  end if;

  if sale_record.paper_sale_price > 0 then
    if organization_company_cash_balance(p_organization_id) - sale_record.paper_sale_price < 0 then
      raise exception 'Voiding this sale would make company cash negative.';
    end if;

    select id
    into company_original_id
    from company_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and correction_of_transaction_id is null
      and type = 'paper_sale_received'
      and amount = sale_record.paper_sale_price
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    order by created_at asc
    limit 1
    for update;

    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, correction_of_transaction_id, created_by
    )
    values (
      p_organization_id,
      'company_cash_withdrawn',
      sale_record.paper_sale_price,
      current_date,
      'Sale void reversal: ' || clean_reason,
      sale_record.vehicle_id,
      sale_record.id,
      company_original_id,
      auth.uid()
    )
    returning id into company_reversal_id;

    if company_original_id is not null then
      update company_cash_transactions
      set reversed_transaction_id = company_reversal_id,
          voided_at = now(),
          voided_by = auth.uid(),
          void_reason = clean_reason,
          updated_at = now()
      where id = company_original_id;
    end if;
  end if;

  if sale_record.external_commission > 0 then
    select id
    into external_original_id
    from external_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and correction_of_transaction_id is null
      and type = 'external_commission_earned'
      and amount = sale_record.external_commission
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    order by created_at asc
    limit 1
    for update;

    if organization_external_cash_balance(p_organization_id) - sale_record.external_commission < 0 then
      raise exception 'Voiding this sale would make external cash negative.';
    end if;

    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, correction_of_transaction_id, created_by
    )
    values (
      p_organization_id,
      'external_cash_personally_removed',
      sale_record.external_commission,
      current_date,
      'Sale void reversal: ' || clean_reason,
      sale_record.vehicle_id,
      sale_record.id,
      external_original_id,
      auth.uid()
    )
    returning id into external_reversal_id;

    if external_original_id is not null then
      update external_cash_transactions
      set reversed_transaction_id = external_reversal_id,
          voided_at = now(),
          voided_by = auth.uid(),
          void_reason = clean_reason,
          updated_at = now()
      where id = external_original_id;
    end if;
  end if;

  update sales
  set status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = clean_reason,
      updated_at = now()
  where id = sale_record.id;

  update vehicles
  set status = 'listed_for_sale',
      updated_at = now()
  where id = sale_record.vehicle_id
    and organization_id = p_organization_id
    and status = 'sold';

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'sale_voided',
    'sale',
    sale_record.id,
    'Sale voided. Reason: ' || clean_reason,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'sale',
    sale_record.id,
    'Sale cash impacts reversed.',
    auth.uid()
  );

  return sale_record.id;
end;
$$;

create or replace function correct_vehicle_sale_atomic(
  p_organization_id uuid,
  p_sale_id uuid,
  p_sale_date date,
  p_taxable_profit_amount numeric,
  p_real_client_payment numeric,
  p_buyer_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_notes text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  old_sale sales%rowtype;
  new_sale_id uuid;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if clean_reason is null then
    raise exception 'Sale correction reason is required.';
  end if;

  select *
  into old_sale
  from sales
  where id = p_sale_id
    and organization_id = p_organization_id
  for update;

  if old_sale.id is null then
    raise exception 'sale not found';
  end if;

  perform void_vehicle_sale_atomic(p_organization_id, p_sale_id, 'Corrected sale: ' || clean_reason);

  new_sale_id := record_vehicle_sale_atomic(
    p_organization_id,
    old_sale.vehicle_id,
    p_sale_date,
    p_taxable_profit_amount,
    p_real_client_payment,
    p_buyer_name,
    p_phone,
    p_email,
    p_address,
    p_notes
  );

  update sales
  set status = 'corrected',
      corrected_by_sale_id = new_sale_id
  where id = old_sale.id;

  update sales
  set correction_of_sale_id = old_sale.id
  where id = new_sale_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'sale_corrected',
    'sale',
    new_sale_id,
    'Sale correction created from ' || old_sale.id || '. Reason: ' || clean_reason,
    auth.uid()
  );

  return new_sale_id;
end;
$$;

revoke execute on function void_vehicle_sale_atomic(uuid, uuid, text) from public;
revoke execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) from public;
grant execute on function void_vehicle_sale_atomic(uuid, uuid, text) to authenticated;
grant execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) to authenticated;
