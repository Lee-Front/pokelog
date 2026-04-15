import { inputFrame, passwordFrame, selectFrame } from "./screen.js";

interface SelectChoice<T> {
  name: string;
  value: T;
  disabled?: boolean;
}

interface SeparatorItem {
  separator: string;
}

export type SelectItem<T> = SelectChoice<T> | SeparatorItem;

export function separator(text: string): SeparatorItem {
  return { separator: text };
}

export async function selectAction<T extends string>(
  message: string,
  choices: { name: string; value: T }[],
): Promise<T> {
  const result = await selectFrame(message, choices);
  return (result ?? "__back__") as T;
}

export async function inputPrompt(message: string): Promise<string> {
  return (await inputFrame(message + " ")) ?? "";
}

export async function passwordPrompt(message: string): Promise<string> {
  return (await passwordFrame(message + " ")) ?? "";
}

export async function numberPrompt(message: string): Promise<number> {
  const val = await inputFrame(message + " ");
  return parseInt(val ?? "", 10) || 0;
}
