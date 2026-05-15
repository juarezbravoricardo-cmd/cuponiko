/**
 * Categorías oficiales para registro de negocios.
 * El valor guardado en DB (columna `businesses.category`) es el `label` literal.
 *
 * Orden hardcodeado: alfabético por `label`, con "Otro" SIEMPRE al final.
 * No usar `.sort()` dinámico porque (1) impide la excepción de "Otro" y
 * (2) el orden alfabético en español depende del locale del JS engine, lo
 * que puede variar entre dispositivos. Hardcoded == determinista.
 */

export type BusinessCategory = {
  value: string;
  label: string;
};

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  { value: 'automotriz',              label: 'Automotriz' },
  { value: 'bar_antros',              label: 'Bar y antros' },
  { value: 'belleza_estetica',        label: 'Belleza y estética' },
  { value: 'cafeteria',               label: 'Cafetería' },
  { value: 'comida_restaurantes',     label: 'Comida y restaurantes' },
  { value: 'computo_electronica',     label: 'Cómputo y electrónica' },
  { value: 'drinks_snacks',           label: 'Drinks y snacks' },
  { value: 'educacion',               label: 'Educación' },
  { value: 'farmacia',                label: 'Farmacia' },
  { value: 'gimnasio_deportes',       label: 'Gimnasio y deportes' },
  { value: 'joyeria',                 label: 'Joyería' },
  { value: 'mascotas',                label: 'Mascotas' },
  { value: 'panaderia_pasteleria',    label: 'Panadería y pastelería' },
  { value: 'salud_bienestar',         label: 'Salud y bienestar' },
  { value: 'servicios_profesionales', label: 'Servicios profesionales' },
  { value: 'tienda_abarrotes',        label: 'Tienda de abarrotes' },
  { value: 'tienda_ropa',             label: 'Tienda de ropa' },
  { value: 'otro',                    label: 'Otro' }, // ← SIEMPRE al final
];
