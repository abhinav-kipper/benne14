// The SQL files in supabase/migrations, in order. They are pasted into the Supabase SQL editor by
// hand; from 0004 on each one records itself in the schema_migrations table, and /api/health lists
// any that haven't been run. A unit test keeps this list in step with the folder.
export const MIGRATIONS = [
  '0001_orders',
  '0002_plain_tokens',
  '0003_owner_dashboard',
  '0004_menu_edit_and_migration_log',
  '0005_discount_codes_and_phone',
  '0006_order_integrity',
  '0007_gateway_payments',
  '0008_given_ticks',
];
