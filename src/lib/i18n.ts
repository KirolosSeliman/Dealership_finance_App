import en from "../../locales/en.json";
import fr from "../../locales/fr.json";
import type { Language } from "@/types/domain";

const dictionaries = { en, fr };

export type Dictionary = typeof en;

export function getDictionary(language: Language) {
  return dictionaries[language];
}
