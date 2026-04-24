/**
 * Unified API response shape for server routes.
 *
 * This type is the *target* shape for future route migrations.
 * Most existing routes currently use ad-hoc shapes such as:
 *   - `res.json({ error: "..." })` on failure
 *   - `res.json({ ...payload })` on success
 *
 * New routes SHOULD prefer `ApiResponse<T>` so clients can discriminate
 * success/failure with a single `ok` check. Do not migrate existing
 * routes wholesale — doing so breaks the CLI client contract.
 *
 * Example:
 * ```ts
 * const resp: ApiResponse<{ party: OwnedPokemon[] }> =
 *   user ? { ok: true, data: { party } }
 *        : { ok: false, error: "사용자를 찾을 수 없습니다" };
 * res.json(resp);
 * ```
 */
export type ApiResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
