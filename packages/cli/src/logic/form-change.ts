/**
 * Form change pure logic -- no I/O, testable
 */

export interface FormChangeAction {
  name: string;
  value: string;
}

/**
 * Build the list of form change actions available for a species.
 * Returns an empty array if the species has no form change rules.
 */
export function getFormChangeActions(
  forms: string[],
  currentVariantId: string | null | undefined,
): FormChangeAction[] {
  if (forms.length === 0) return [];

  const actions: FormChangeAction[] = [];

  for (const formId of forms) {
    if (formId === currentVariantId) continue;
    // Extract a human-readable suffix from the variant ID
    const label = formId.replace(/^[^-]+-/, "");
    actions.push({
      name: label.charAt(0).toUpperCase() + label.slice(1),
      value: formId,
    });
  }

  // If currently in a variant form, offer revert to base
  if (currentVariantId) {
    actions.push({ name: "Revert to base form", value: "__revert__" });
  }

  return actions;
}
