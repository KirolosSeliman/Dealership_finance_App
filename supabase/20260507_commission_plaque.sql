alter type expense_category add value if not exists 'commission_plaque' after 'vehicle_purchase_price';

alter table organizations
  add column if not exists default_plate_commission_amount numeric(12,2) not null default 250;

update organizations
set default_plate_commission_amount = 250
where default_plate_commission_amount is null;
