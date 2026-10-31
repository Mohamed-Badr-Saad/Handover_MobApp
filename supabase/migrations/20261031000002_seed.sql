-- Starting data: plant areas and the department roster (same as the shared-folder app).
-- Safe to run again: existing rows are left as they are.

insert into public.areas (id, name, sort) values
  ('WDDM', 'WDDM', 0),
  ('SCA', 'SCA', 1),
  ('SSS', 'SSS', 2),
  ('PHV', 'PHV', 3),
  ('PHVII', 'PHVII', 4),
  ('ROS', 'ROS', 5),
  ('CP1', 'CP1', 6),
  ('P1', 'P1', 7),
  ('P2', 'P2', 8),
  ('GENERAL', 'GENERAL', 9),
  ('T/L', 'T/L', 10),
  ('SCA/SSS', 'SCA/SSS', 11),
  ('ICS', 'ICS', 12),
  ('GMS', 'GMS', 13)
on conflict (id) do nothing;

insert into public.staff (employee_id, name, job_title, department, role, active) values
  ('OPR952', 'Mohamed Reda Hassan', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('OPR969', 'Haytham Fouad Fawaz', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('OPR997', 'Ayman Mohamed Saleh', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('OPR1108', 'Mahmoud Moh. Ghoneim', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('OPR1109', 'Mohamed Abdel Razek', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('OPR1201', 'Ahmed Saleh Gaber', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('OPR1211', 'Mohamed Badr Saad', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('OPR496', 'Ahmed Yousef', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('OPR743', 'Momtaz Ahmed Razk', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('EMC-021', 'Waleed Abd El Monem', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('EMC-184', 'Mohamed Talaat', 'First Eng.', 'Instrument', 'engineer', true),
  ('EMC-430', 'Ali Abdelrahman Abo Elhamd', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('EMC-458', 'Ahmed Saeed Sayed', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('EMC-463', 'Ahmed Salah Abbas', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('EMC-484', 'Mostafa Khaled Mohamed Nabawy', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('EMC-502', 'Anas Mohamed', 'Inst. Eng.', 'Instrument', 'engineer', true),
  ('EMC-011', 'Khaled Radwan', 'Inst. Sup.', 'Instrument', 'supervisor', true),
  ('EMC-179', 'Walid Nazim', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('EMC-180', 'Sayed Hamed', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('EMC-490', 'Mohamed Abdelmohsen Abozeid', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('Epesco (E797)', 'Mohamed Mahmoud', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('Epesco (E1019)', 'Abd El Fatah Zakaraya', 'Inst. Helper', 'Instrument', 'technician', true),
  ('Epesco (E66)', 'Ahmed Shehata Abdo', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('Epesco (E849)', 'Mohamed Awad', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('Epesco (E928)', 'Mahmoud Eid', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('Epesco (E1011)', 'Ayman Kamal', 'Inst. Helper', 'Instrument', 'technician', true),
  ('Epesco (E980)', 'Mohamed EL Sayed Toto', 'Inst. Helper', 'Instrument', 'technician', true),
  ('Epesco (E1053)', 'Hany Mosad Saad', 'Inst. Tech.', 'Instrument', 'technician', true),
  ('Epesco (E992)', 'Mohamed Farouk', 'Inst. Helper', 'Instrument', 'technician', true),
  ('Epesco (E205)', 'Khamis Ibrahim', 'Inst. Helper', 'Instrument', 'technician', true)
on conflict (employee_id) do nothing;
