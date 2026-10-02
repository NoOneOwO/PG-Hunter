import {
  Wifi,
  Utensils,
  WashingMachine,
  Sparkles,
  Snowflake,
  Droplets,
  Zap,
  Cctv,
  ShieldCheck,
  CarFront,
  Dumbbell,
  Tv,
  Refrigerator,
  Table2,
  Archive,
  DoorOpen,
  Bath,
  GlassWater,
  Building2,
  Check,
} from '@lucide/astro';

/**
 * Amenity slug → Lucide icon component.
 * Static named imports keep the client bundle small.
 */
export const amenityIconMap: Record<string, typeof Check> = {
  wifi: Wifi,
  food: Utensils,
  laundry: WashingMachine,
  housekeeping: Sparkles,
  ac: Snowflake,
  geyser: Droplets,
  'power-backup': Zap,
  cctv: Cctv,
  security: ShieldCheck,
  parking: CarFront,
  gym: Dumbbell,
  tv: Tv,
  refrigerator: Refrigerator,
  'study-table': Table2,
  wardrobe: Archive,
  balcony: DoorOpen,
  'attached-bath': Bath,
  'water-filter': GlassWater,
  lift: Building2,
  'washing-machine': WashingMachine,
};

export const amenityIcon = (slug: string): typeof Check =>
  amenityIconMap[slug] ?? Check;
