// Widgets de código ligados ao shell (manifest `source: "builtin"`): renderizam pelo registro,
// dentro da mesma célula dos versionados. Contrato igual ao dos widgets: componente sem props.
import { createElement, type ComponentType } from "react";
import { CabeBlock } from "./cabe";
import { go } from "./router";
import { VerdictBlock } from "./verdict";

const Veredito = () => createElement(VerdictBlock, { onSettings: () => go("ajustes") });

export const BUILTINS: Record<string, ComponentType> = {
  veredito: Veredito,
  cabe: CabeBlock,
};
