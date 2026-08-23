alter table external_cash_transactions
  drop constraint if exists external_cash_type_valid,
  add constraint external_cash_type_valid
    check (
      type in (
        'external_cash_added',
        'external_commission_earned',
        'external_cash_transferred_to_company',
        'external_cash_personally_removed',
        'external_vehicle_expense_paid'
      )
    );
