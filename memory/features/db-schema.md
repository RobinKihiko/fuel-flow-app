---
name: Database schema
description: Core tables for fuel station management including multi-branch, pumps, and tank inventory
type: feature
---
Tables:
- profiles: user_id, full_name, phone, id_number
- user_roles: user_id, role (admin/manager/attendant)
- fuel_types: name, price_per_litre, stock_level (legacy, pre-branch)
- branches: name, location, mpesa_*, is_active, audit
- branch_fuel_types: branch_id, name, price_per_litre, stock_level, audit
- branch_attendants: branch_id, user_id (many-to-many)
- sales: fuel_type_id, litres, total_amount, payment_method, attendant_id, branch_id
- mpesa_transactions: phone, amount, sale_id, mpesa_code, status
- expenses: date, description, amount, category, created_by, audit
- fuel_topups: branch_fuel_type_id, fuel_type_id, branch_id, litres, notes, created_by

Pump Management:
- pumps: branch_id, code, label, status (active/idle/error/offline), assigned_attendant_id, notes, audit
- pump_nozzles: pump_id, branch_fuel_type_id, code (per-grade nozzle on a pump)
- drive_off_incidents: branch_id, pump_id, attendant_id, vehicle_plate, estimated_litres, estimated_amount, notes, reported_by

Tank Inventory:
- tanks: branch_id, fuel_name, capacity_litres, current_level_litres, low_stock_threshold, notes, audit
- tank_dips: tank_id, dip_litres, notes, recorded_by — trigger sets tank.current_level_litres = dip_litres
- fuel_deliveries: tank_id, supplier, expected_litres, delivered_litres, cost_per_litre, delivery_date, notes — trigger increments tank.current_level_litres
