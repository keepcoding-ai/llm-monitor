// Nome de ícone (lista fechada ICON_NAMES do contrato) → componente Phosphor.
import { ArrowsClockwise, ChartBar, Clock, Coins, Folder, Gauge, GearSix, House, Lifebuoy, Lightning, Star, Warning, type Icon } from "@phosphor-icons/react";
import type { ICON_NAMES } from "../shared/snapshot";

export const ICONS: Record<(typeof ICON_NAMES)[number], Icon> = { House, ArrowsClockwise, Lifebuoy, GearSix, Warning, ChartBar, Gauge, Lightning, Folder, Star, Clock, Coins };

/** Nome desconhecido (layout mais novo que o front) cai numa estrela em vez de quebrar o menu. */
export const iconFor = (name: string): Icon => (ICONS as Record<string, Icon>)[name] ?? Star;

/** Rótulo em português de cada ícone, para o seletor. */
export const ICON_LABELS: Record<(typeof ICON_NAMES)[number], string> = {
  House: "Casa", ArrowsClockwise: "Ciclo", Lifebuoy: "Boia", GearSix: "Engrenagem", Warning: "Aviso", ChartBar: "Gráfico",
  Gauge: "Medidor", Lightning: "Raio", Folder: "Pasta", Star: "Estrela", Clock: "Relógio", Coins: "Moedas",
};
export const iconLabel = (name: string): string => (ICON_LABELS as Record<string, string>)[name] ?? name;
