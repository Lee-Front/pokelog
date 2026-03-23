import { select, input, confirm, password } from "@inquirer/prompts";

export async function selectAction<T extends string>(
  message: string,
  choices: { name: string; value: T }[]
): Promise<T> {
  return select({ message, choices });
}

export async function inputPrompt(message: string): Promise<string> {
  return input({ message });
}

export async function passwordPrompt(message: string): Promise<string> {
  return password({ message });
}

export async function confirmPrompt(message: string): Promise<boolean> {
  return confirm({ message });
}

export async function numberPrompt(message: string): Promise<number> {
  const val = await input({ message });
  return parseInt(val, 10);
}
