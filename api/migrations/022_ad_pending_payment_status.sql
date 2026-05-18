-- Corrección 26A: agregar 'pending_payment' a anuncios_pagados y 'draft' a coupons
-- Se ejecuta solo si los constraints existen; si no, los crea.

ALTER TABLE anuncios_pagados DROP CONSTRAINT IF EXISTS anuncios_pagados_status_check;
ALTER TABLE anuncios_pagados ADD CONSTRAINT anuncios_pagados_status_check
  CHECK (status IN ('active', 'paused', 'expired', 'pending_payment'));

ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_status_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_status_check
  CHECK (status IN ('active', 'paused', 'expired', 'redeemed', 'draft'));
