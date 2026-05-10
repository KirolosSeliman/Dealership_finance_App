create or replace function assert_final_owner_preserved()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  remaining_owner_count integer;
begin
  if tg_op = 'UPDATE' and old.role <> 'owner' then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  select count(*) into remaining_owner_count
  from organization_memberships
  where organization_id = old.organization_id
    and role = 'owner'
    and id <> old.id;

  if remaining_owner_count = 0 then
    raise exception 'an organization must keep at least one owner';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists organization_memberships_final_owner on organization_memberships;
create trigger organization_memberships_final_owner
before update or delete on organization_memberships
for each row execute function assert_final_owner_preserved();

drop policy if exists "read attachments" on attachments;
create policy "read attachments"
on attachments
for select
using (
  (
    is_sensitive = false
    and is_org_member(organization_id)
  )
  or has_org_role(organization_id, array['owner','admin','member']::app_role[])
);

drop policy if exists "members read private organization files" on storage.objects;
create policy "operational roles read private organization files"
on storage.objects for select
using (
  bucket_id = 'dealer-flow-private'
  and (storage.foldername(name))[1] = 'organizations'
  and has_org_role(((storage.foldername(name))[2])::uuid, array['owner','admin','member']::app_role[])
);

create or replace function create_vehicle_with_defaults(
  p_organization_id uuid,
  p_vin text,
  p_year integer,
  p_make text,
  p_model text,
  p_trim text,
  p_color text,
  p_mileage integer,
  p_purchase_price numeric,
  p_purchase_date date,
  p_purchase_source purchase_source,
  p_status vehicle_status,
  p_listed_price numeric,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_vehicle_id uuid;
  purchase_tax numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1 from organizations where id = p_organization_id;
  if not found then
    raise exception 'organization not found';
  end if;

  insert into vehicles (
    organization_id,
    vin,
    year,
    make,
    model,
    trim,
    color,
    mileage,
    purchase_price,
    purchase_date,
    purchase_source,
    status,
    listed_price,
    notes,
    created_by
  )
  values (
    p_organization_id,
    upper(trim(coalesce(p_vin, ''))),
    p_year,
    nullif(trim(coalesce(p_make, '')), ''),
    nullif(trim(coalesce(p_model, '')), ''),
    nullif(trim(coalesce(p_trim, '')), ''),
    nullif(trim(coalesce(p_color, '')), ''),
    p_mileage,
    coalesce(p_purchase_price, 0),
    coalesce(p_purchase_date, current_date),
    coalesce(p_purchase_source, 'other'::purchase_source),
    coalesce(p_status, 'purchased'::vehicle_status),
    p_listed_price,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into new_vehicle_id;

  if coalesce(p_purchase_price, 0) > 0 then
    purchase_tax := round((p_purchase_price * 0.05)::numeric, 2);
    insert into vehicle_expenses (
      organization_id,
      vehicle_id,
      category,
      amount_before_tax,
      tax_rate,
      tax_amount,
      total_amount,
      date,
      note,
      created_by
    )
    values (
      p_organization_id,
      new_vehicle_id,
      'vehicle_purchase_price',
      p_purchase_price,
      0.05,
      purchase_tax,
      round((p_purchase_price + purchase_tax)::numeric, 2),
      coalesce(p_purchase_date, current_date),
      'Automatic 5% purchase tax',
      auth.uid()
    );
  end if;


  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_created', 'vehicle', new_vehicle_id, 'Vehicle created', auth.uid());

  if coalesce(p_purchase_price, 0) > 0 then
    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'expense_added', 'vehicle', new_vehicle_id, 'Automatic 5% purchase tax', auth.uid());
  end if;


  return new_vehicle_id;
end;
$$;

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

  if vehicle_record.id is null then
    raise exception 'vehicle not found';
  end if;

  if exists (select 1 from sales where vehicle_id = p_vehicle_id) then
    raise exception 'this vehicle already has a sale record';
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
      organization_id,
      type,
      full_name,
      phone,
      email,
      address,
      notes,
      created_by
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
      organization_id,
      type,
      amount,
      date,
      note,
      source_vehicle_id,
      created_by
    )
    values (
      p_organization_id,
      'paper_sale_received',
      paper_sale_price,
      coalesce(p_sale_date, current_date),
      'Paper sale received',
      p_vehicle_id,
      auth.uid()
    );
  end if;

  if external_commission > 0 then
    insert into external_cash_transactions (
      organization_id,
      type,
      amount,
      date,
      note,
      source_vehicle_id,
      created_by
    )
    values (
      p_organization_id,
      'external_commission_earned',
      external_commission,
      coalesce(p_sale_date, current_date),
      'External commission earned',
      p_vehicle_id,
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


