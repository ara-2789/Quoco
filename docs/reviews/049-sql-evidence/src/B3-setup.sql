\pset tuples_only on
\pset format unaligned
\echo -- race setup: DC delivery V1 (supplier, incomplete) with document D1; invoice document D2 with no delivery and no link
SELECT t.mk_dc('{D1}', '{V1}', 'SM_B3_dc');
SELECT t.mk_doc('{D2}', 'invoice', 'SM_B3_inv');
