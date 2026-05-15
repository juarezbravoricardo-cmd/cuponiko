/**
 * Categorías oficiales para registro de negocios.
 * El valor guardado en DB (columna `businesses.category`) es el `label` literal.
 */

export type BusinessCategory = {
  value: string;
  label: string;
};

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  { value: 'comida_restaurantes',   label: 'Comida y restaurantes' },
  { value: 'cafeteria',              label: 'Cafetería' },
  { value: 'panaderia_pasteleria',   label: 'Panadería y pastelería' },
  { value: 'drinks_snacks',          label: 'Drinks y snacks' },
  { value: 'bar_antros',             label: 'Bar y antros' },
  { value: 'tienda_abarrotes',       label: 'Tienda de abarrotes' },
  { value: 'tienda_ropa',            label: 'Tienda de ropa' },
  { value: 'joyeria',                label: 'Joyería' },
  { value: 'belleza_estetica',       label: 'Belleza y estética' },
  { value: 'salud_bienestar',        label: 'Salud y bienestar' },
  { value: 'farmacia',               label: 'Farmacia' },
  { value: 'gimnasio_deportes',      label: 'Gimnasio y deportes' },
  { value: 'mascotas',               label: 'Mascotas' },
  { value: 'computo_electronica',    label: 'Cómputo y electrónica' },
  { value: 'automotriz',             label: 'Automotriz' },
  { value: 'educacion',              label: 'Educación' },
  { value: 'servicios_profesionales',label: 'Servicios profesionales' },
  { value: 'otro',                   label: 'Otro' },
];
