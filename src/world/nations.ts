/**
 * The flags of the Caribbean. Colours are for the flag cloth on ships and the HUD; an
 * enemy's nation says who it sails for (reputation and factions come with slice 5e).
 */
export interface Nation {
  id: string;
  /** Turkish adjective shown in the HUD ("İspanyol Schooner"). */
  name: string;
  /** Flag colour, 0xRRGGBB. */
  flag: number;
}

export const NATIONS: readonly Nation[] = [
  { id: 'free', name: 'Serbest', flag: 0xf3ead2 },
  { id: 'english', name: 'İngiliz', flag: 0xc0392b },
  { id: 'french', name: 'Fransız', flag: 0x2e5fa8 },
  { id: 'spanish', name: 'İspanyol', flag: 0xe0b01a },
  { id: 'dutch', name: 'Hollandalı', flag: 0xe8672c },
  { id: 'pirate', name: 'Korsan', flag: 0x151515 },
];

export function getNation(id: string): Nation {
  return NATIONS.find((n) => n.id === id) ?? (NATIONS[0] as Nation);
}
