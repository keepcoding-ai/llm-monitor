// Nome de ícone (lista fechada ICON_NAMES do contrato) → componente Phosphor.
import { ArrowsClockwise, ChartBar, Clock, Coins, Folder, Gauge, GearSix, House, Lifebuoy, Lightning, Star, Warning, type Icon } from "@phosphor-icons/react";
import type { ICON_NAMES } from "../shared/snapshot";

export const ICONS: Record<(typeof ICON_NAMES)[number], Icon> = { House, ArrowsClockwise, Lifebuoy, GearSix, Warning, ChartBar, Gauge, Lightning, Folder, Star, Clock, Coins };

/** Nome desconhecido (layout mais novo que o front) cai numa estrela em vez de quebrar o menu. */
export const iconFor = (name: string): Icon => (ICONS as Record<string, Icon>)[name] ?? Star;
